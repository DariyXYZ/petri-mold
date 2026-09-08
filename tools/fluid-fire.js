'use strict';

// Офлайновая модель огня. В реальном времени такое не считается, но анимацию
// можно запечь заранее — и тогда можно позволить себе честный решатель:
//
//   Stable Fluids (Stam, SIGGRAPH 1999)
//     полулагранжев перенос + проекция на бездивергентное поле.
//     Именно проекция даёт настоящие вихри и «грибы»: скорость больше не
//     может просто копиться вверх, воздух вынужден расходиться в стороны и
//     заворачиваться. Шумовое завихрение (curl-noise) это подделывает,
//     но выглядит одинаково по всему кадру.
//
//   Buoyancy
//     v -= dt * BUOY * T                 горячее всплывает
//
//   Vorticity confinement (Fedkiw, Stam, Jensen, SIGGRAPH 2001)
//     w = dv/dx - du/dy                  завихренность (в 2D скаляр)
//     N = grad|w| / |grad|w||
//     f = EPS * h * (N_y * w, -N_x * w)
//     Возвращает мелкие завитки, которые съедает численная диффузия
//     переноса. Без него пламя быстро становится гладким.
//
//   Горение и остывание
//     burn = FUEL * BURN;  FUEL -= burn;  T += burn * TBURN
//     T -= dt * (COOLQ * T^4 + COOLL * T)     излучение плюс слив
//
// Сетка симуляции вдвое грубее кадра: пламя мягкое, а проекция на грубой
// сетке сходится куда быстрее. Наверх отдаётся поле температуры.

function makeSim(opt) {
  var W = opt.W, H = opt.H;                  // размер сетки симуляции
  var n = W * H;

  var S = {
    W: W, H: H, n: n,
    u: new Float32Array(n), v: new Float32Array(n),
    u0: new Float32Array(n), v0: new Float32Array(n),
    T: new Float32Array(n), T0: new Float32Array(n),
    F: new Float32Array(n), F0: new Float32Array(n),
    p: new Float32Array(n), p0: new Float32Array(n),
    div: new Float32Array(n), curl: new Float32Array(n),
    solid: new Uint8Array(n),                // 1 = стенка (вне агара)
    front: new Float32Array(W),              // y кромки поджига по столбцам
    lit: new Uint8Array(n),
    soot: new Float32Array(n),
    frame: 0,
    o: opt
  };

  // круг агара в координатах сетки
  var cx = W * 0.5, cy = H * 0.5, R = opt.radius;
  var top = H, bot = 0;
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      var inside = dx * dx + dy * dy <= R * R;
      S.solid[y * W + x] = inside ? 0 : 1;
      if (inside) { if (y < top) top = y; if (y > bot) bot = y; }
    }
  }
  S.topY = top; S.botY = bot;

  for (var i = 0; i < W; i++) {
    S.front[i] = bot + 1 + noise2(i / 9, 0.5, opt.seed) * 3;
  }
  return S;
}

// --- дешёвый value-шум, тот же принцип, что в js/rng.js ---

function ihash(x, y, seed) {
  var h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2(x, y, seed) {
  var xi = Math.floor(x), yi = Math.floor(y);
  var tx = x - xi, ty = y - yi;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  var a = ihash(xi, yi, seed), b = ihash(xi + 1, yi, seed);
  var c = ihash(xi, yi + 1, seed), d = ihash(xi + 1, yi + 1, seed);
  var ab = a + (b - a) * tx, cd = c + (d - c) * tx;
  return ab + (cd - ab) * ty;
}

function fbm2(x, y, seed, oct) {
  var s = 0, amp = 1, norm = 0, f = 1;
  for (var i = 0; i < oct; i++) {
    s += amp * noise2(x * f, y * f, seed + i * 7919);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

// --- перенос ---

function advect(S, dst, src, dt) {
  var W = S.W, H = S.H, u = S.u, v = S.v, solid = S.solid;
  for (var y = 1; y < H - 1; y++) {
    var row = y * W;
    for (var x = 1; x < W - 1; x++) {
      var i = row + x;
      if (solid[i]) { dst[i] = 0; continue; }
      var px = x - dt * u[i], py = y - dt * v[i];
      if (px < 0.5) px = 0.5; else if (px > W - 1.5) px = W - 1.5;
      if (py < 0.5) py = 0.5; else if (py > H - 1.5) py = H - 1.5;
      var ix = px | 0, iy = py | 0;
      var fx = px - ix, fy = py - iy;
      var a = iy * W + ix;
      dst[i] = src[a] * (1 - fx) * (1 - fy) + src[a + 1] * fx * (1 - fy)
             + src[a + W] * (1 - fx) * fy + src[a + W + 1] * fx * fy;
    }
  }
}

// --- проекция: решаем лапласиан для давления и вычитаем градиент ---

function project(S, iters) {
  var W = S.W, H = S.H, u = S.u, v = S.v;
  var solid = S.solid, div = S.div, p = S.p, p0 = S.p0;
  var x, y, i;

  for (y = 1; y < H - 1; y++) {
    for (x = 1; x < W - 1; x++) {
      i = y * W + x;
      if (solid[i]) { div[i] = 0; p[i] = 0; continue; }
      div[i] = 0.5 * ((u[i + 1] - u[i - 1]) + (v[i + W] - v[i - W]));
    }
  }

  // Якоби: у стенки берём центральное значение, что и даёт условие
  // Неймана dp/dn = 0 — поток не проходит сквозь стекло.
  for (var k = 0; k < iters; k++) {
    for (y = 1; y < H - 1; y++) {
      for (x = 1; x < W - 1; x++) {
        i = y * W + x;
        if (solid[i]) { p0[i] = 0; continue; }
        var l = solid[i - 1] ? p[i] : p[i - 1];
        var r = solid[i + 1] ? p[i] : p[i + 1];
        var t = solid[i - W] ? p[i] : p[i - W];
        var b = solid[i + W] ? p[i] : p[i + W];
        p0[i] = (l + r + t + b - div[i]) * 0.25;
      }
    }
    var sw = S.p; S.p = p = S.p0; S.p0 = p0 = sw;
  }

  for (y = 1; y < H - 1; y++) {
    for (x = 1; x < W - 1; x++) {
      i = y * W + x;
      if (solid[i]) { u[i] = 0; v[i] = 0; continue; }
      var pl = solid[i - 1] ? p[i] : p[i - 1];
      var pr = solid[i + 1] ? p[i] : p[i + 1];
      var pt = solid[i - W] ? p[i] : p[i - W];
      var pb = solid[i + W] ? p[i] : p[i + W];
      u[i] -= 0.5 * (pr - pl);
      v[i] -= 0.5 * (pb - pt);
    }
  }
}

// --- завихренность: вернуть мелкие завитки ---

function confine(S, dt, eps) {
  var W = S.W, H = S.H, u = S.u, v = S.v, solid = S.solid, curl = S.curl;
  var x, y, i;

  for (y = 1; y < H - 1; y++) {
    for (x = 1; x < W - 1; x++) {
      i = y * W + x;
      curl[i] = solid[i] ? 0
        : 0.5 * ((v[i + 1] - v[i - 1]) - (u[i + W] - u[i - W]));
    }
  }

  for (y = 2; y < H - 2; y++) {
    for (x = 2; x < W - 2; x++) {
      i = y * W + x;
      if (solid[i]) continue;
      var gx = 0.5 * (Math.abs(curl[i + 1]) - Math.abs(curl[i - 1]));
      var gy = 0.5 * (Math.abs(curl[i + W]) - Math.abs(curl[i - W]));
      var len = Math.sqrt(gx * gx + gy * gy) + 1e-6;
      gx /= len; gy /= len;
      var w = curl[i];
      u[i] += dt * eps * (gy * w);
      v[i] += dt * eps * (-gx * w);
    }
  }
}

// --- один шаг ---

function stepSim(S) {
  var o = S.o, W = S.W, H = S.H;
  var dt = o.dt;
  S.frame++;

  // 1. кромка поджига идёт снизу вверх, по топливу быстрее
  var edge = S.topY - 2;
  var burning = false;
  for (var x = 0; x < W; x++) {
    var y0 = S.front[x];
    if (y0 < edge) continue;
    burning = true;

    var wob = 1.15 * fbm2(x / 13, S.frame / 24, o.seed + 71, 2)
            + 0.55 * fbm2(x / 4.2, S.frame / 10, o.seed + 907, 2);
    var y1 = y0 - (o.frontBase + wob * o.frontWob);
    S.front[x] = y1;

    var a = Math.max(0, Math.floor(y1)), b = Math.min(H - 1, Math.ceil(y0));
    for (var y = a; y <= b; y++) {
      var i = y * W + x;
      if (S.solid[i] || S.lit[i]) continue;
      S.lit[i] = 1;

      // Топливо неровное: крупные пятна дают вспышки и провалы, сплошная
      // светящаяся линия читается как шов, а не как огонь.
      var patch = fbm2(x / o.patchScale, y / o.patchScale, o.seed + 5501, 2);
      var fu = o.fuelBase + o.fuelSwing * patch;
      if (fu < 0) fu = 0; else if (fu > 1) fu = 1;
      S.F[i] = fu;
      S.T[i] = fu * o.ignite;
      S.soot[i] = Math.min(0.95, o.sootBase + o.sootSwing * patch);
    }
  }
  S.burning = burning;

  // 2. подъёмная сила
  for (var j = 0; j < S.n; j++) {
    if (S.solid[j]) continue;
    S.v[j] -= dt * o.buoy * S.T[j];
  }

  // 3. завихренность, 4. проекция, 5. перенос скорости, снова проекция
  confine(S, dt, o.vort);
  project(S, o.iters);

  S.u0.set(S.u); S.v0.set(S.v);
  advect(S, S.u0, S.u, dt); advect(S, S.v0, S.v, dt);
  S.u.set(S.u0); S.v.set(S.v0);
  project(S, o.iters);

  // 6. перенос температуры и топлива
  advect(S, S.T0, S.T, dt);
  advect(S, S.F0, S.F, dt);
  S.T.set(S.T0); S.F.set(S.F0);

  // 7-8. горение и остывание
  for (var q = 0; q < S.n; q++) {
    if (S.solid[q]) { S.T[q] = 0; continue; }
    var f = S.F[q];
    if (f > 0.01) {
      var burn = f * o.burn;
      S.F[q] = f - burn;
      S.T[q] += burn * o.tburn;
    } else if (f) S.F[q] = 0;

    var T = S.T[q];
    if (T > o.tcap) T = o.tcap;
    T -= dt * (o.coolQ * T * T * T * T + o.coolL * T);
    S.T[q] = T > 0.002 ? T : 0;

    var s = S.soot[q];
    if (s) S.soot[q] = s > 0.004 ? s * (burning ? o.sootHold : o.sootFade) : 0;
  }
}

module.exports = { makeSim: makeSim, stepSim: stepSim, fbm2: fbm2, noise2: noise2 };
