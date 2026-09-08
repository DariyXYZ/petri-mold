var PM = PM || {};

// Выжигание чашки. CLEAN не стирает картинку разом: по агару снизу вверх идёт
// фронт огня, за ним остаётся сажа, которая потом выветривается до чистого
// агара. Огонь бежит по топливу — там, где над фронтом плесень, он ускоряется,
// по голому агару еле тянется. Отсюда живая неровная кромка.
//
// Пламя не рисуется языками, а считается как поле температуры:
//
//   1. Поле скоростей — curl-noise (Bridson, Hourihan, Nordenstam, SIGGRAPH
//      2007). В 2D бездивергентное поле это ротор скалярного потенциала:
//        u =  dpsi/dy,   v = -dpsi/dx
//      Центральными разностями по сетке шага CG. Дивергенции нет, поэтому
//      поток не надувается и не схлопывается, а закручивается — именно
//      этого не хватало прямым языкам вверх. Потенциал гасится у кромки
//      агара (ramp у границы из той же работы), и огонь идёт вдоль стекла.
//
//   2. Подъёмная сила: горячий газ тянет вверх, v -= BUOY * T.
//
//   3. Перенос полулагранжев: смотрим, откуда газ пришёл, и берём там
//      температуру билинейно. Один шаг, безусловно устойчиво.
//
//   4. Горение и остывание:
//        T  = max(T, T_burn)          пока в клетке есть топливо
//        rho = rho * (1 - BURN)       топливо выгорает
//        T -= COOLQ*T^4 + COOLL*T     излучение плюс линейный слив
//
// Скорости считаются на грубой сетке (CG px) и интерполируются: полный
// curl-noise на каждый пиксель каждого кадра в JS не влезает в 60 fps.
PM.burn = (function () {
  var f = null, W = 0, H = 0, n = 0, sc = 1, seed = 0;
  var front = null;            // y фронта по столбцам, ползёт вверх
  var heat = null, fuel = null, tmp = null;
  var soot = null, lit8 = null;
  var psi = null, vu = null, vv = null, gw = 0, gh = 0;
  var active = false, phase = '', t = 0, after = 0, done = null;
  var topY = 0, botY = 0, bandTop = 0, bandBot = 0;
  var dcx = 0, dcy = 0, rAgar = 0;
  var lit = 0, litX = 0;
  var V = [0, 0];

  var CG    = 4;      // шаг сетки скоростей, px
  var AMP   = 30;     // сила завихрений
  var BUOY  = 2.8;    // подъём горячего газа, px за кадр при T=1
  var L1    = 27;     // крупные вихри, px
  var L2    = 11;     // мелкая рябь, px
  var COOLQ = 0.30;   // излучение ~T^4
  var COOLL = 0.13;   // линейный слив
  var TCAP  = 1.15;   // потолок температуры: без него T^4 уводит слив в минус
  var BURN  = 0.20;   // доля топлива, сгорающая за кадр
  var PLUME = 21;     // полоса расчёта над фронтом, 192-масштаб
  var EMBER = 14;     // и под ним
  var COOLF = 34;     // кадров догорания после прохода фронта

  // --- запуск ---

  // Границы агара по вертикали: обод и стекло не горят.
  function agarBand() {
    topY = H; botY = 0;
    for (var y = 0; y < H; y++) {
      var row = y * W;
      for (var x = 0; x < W; x++) {
        if (!f.mask[row + x]) continue;
        if (y < topY) topY = y;
        if (y > botY) botY = y;
        break;
      }
    }
  }

  function start(fields, s, onDone) {
    f = fields; W = f.W; H = f.H; n = f.n; sc = f.scale || 1;
    seed = ((s | 0) ^ 0x5f37) >>> 0;

    var G = PM.dish.GEO;
    dcx = G.cx * W; dcy = G.cy * H;
    rAgar = G.rAgar * G.rOuter * W;

    front = new Float32Array(W);
    gw = ((W / CG) | 0) + 2;
    gh = ((H / CG) | 0) + 2;

    if (!heat || heat.length !== n) {
      heat = new Float32Array(n); fuel = new Float32Array(n);
      tmp = new Float32Array(n);  soot = new Float32Array(n);
      lit8 = new Uint8Array(n);
    } else {
      heat.fill(0); fuel.fill(0); tmp.fill(0); soot.fill(0); lit8.fill(0);
    }
    if (!psi || psi.length !== gw * gh) {
      psi = new Float32Array(gw * gh);
      vu = new Float32Array(gw * gh);
      vv = new Float32Array(gw * gh);
    } else { psi.fill(0); vu.fill(0); vv.fill(0); }

    agarBand();
    for (var x = 0; x < W; x++) {
      // фронт заходит снизу неровной кромкой, а не ровной линейкой
      front[x] = botY + 3 + PM.rng.fbm(x / (11 * sc), 0.5, seed, 2) * 6 * sc;
    }

    bandTop = Math.max(topY, botY - Math.round(PLUME * sc));
    bandBot = botY;
    t = 0; after = 0; lit = 0; phase = 'sweep';
    active = true; done = onDone || null;
  }

  function reset() { active = false; done = null; f = null; }

  // --- поле скоростей ---

  function velocity() {
    var y0 = Math.max(1, ((bandTop / CG) | 0) - 1);
    var y1 = Math.min(gh - 2, ((bandBot / CG) | 0) + 1);

    for (var gy = y0 - 1; gy <= y1 + 1; gy++) {
      if (gy < 0 || gy >= gh) continue;
      var py = gy * CG;
      for (var gx = 0; gx < gw; gx++) {
        var px = gx * CG;
        // Два слоя, ползущие с разной скоростью: чистый сдвиг одного слоя
        // читается как ровно едущая картинка, а не как живой поток.
        var p = PM.rng.fbm(px / L1, (py - t * 1.7) / L1, seed + 9, 2)
              + 0.6 * PM.rng.fbm(px / L2 + t * 0.035, (py - t * 3.1) / L2,
                                 seed + 4423, 2);
        // Стенка чашки: у кромки агара потенциал гасится, поток идёт вдоль
        // стекла, а не сквозь него.
        var dx = px - dcx, dy = py - dcy;
        var d = rAgar - Math.sqrt(dx * dx + dy * dy);
        if (d < 8) p *= d <= 0 ? 0 : d * 0.125;
        psi[gy * gw + gx] = p;
      }
    }

    var k = AMP / (2 * CG);
    for (var gy2 = y0; gy2 <= y1; gy2++) {
      var row = gy2 * gw;
      for (var gx2 = 1; gx2 < gw - 1; gx2++) {
        var i = row + gx2;
        vu[i] = (psi[i + gw] - psi[i - gw]) * k;
        vv[i] = -(psi[i + 1] - psi[i - 1]) * k;
      }
    }
  }

  function sampleV(x, y) {
    var gx = x / CG, gy = y / CG;
    var ix = gx | 0, iy = gy | 0;
    if (ix < 0) ix = 0; else if (ix > gw - 2) ix = gw - 2;
    if (iy < 0) iy = 0; else if (iy > gh - 2) iy = gh - 2;
    var fx = gx - ix, fy = gy - iy;
    var a = iy * gw + ix;
    var w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy),
        w2 = (1 - fx) * fy, w3 = fx * fy;
    V[0] = vu[a] * w0 + vu[a + 1] * w1 + vu[a + gw] * w2 + vu[a + gw + 1] * w3;
    V[1] = vv[a] * w0 + vv[a + 1] * w1 + vv[a + gw] * w2 + vv[a + gw + 1] * w3;
  }

  function sampleHeat(x, y) {
    if (x < 1) x = 1; else if (x > W - 2) x = W - 2;
    if (y < 1) y = 1; else if (y > H - 2) y = H - 2;
    var ix = x | 0, iy = y | 0;
    var fx = x - ix, fy = y - iy;
    var a = iy * W + ix;
    return heat[a] * (1 - fx) * (1 - fy) + heat[a + 1] * fx * (1 - fy)
         + heat[a + W] * (1 - fx) * fy + heat[a + W + 1] * fx * fy;
  }

  // --- перенос, горение, остывание ---

  function advect() {
    for (var y = bandTop; y <= bandBot; y++) {
      var row = y * W;
      for (var x = 0; x < W; x++) {
        var i = row + x;
        if (!f.mask[i]) { tmp[i] = 0; continue; }

        var h0 = heat[i], fu = fuel[i];
        if (!h0 && !fu) { tmp[i] = 0; continue; }

        sampleV(x, y);
        var h = sampleHeat(x - V[0], y - (V[1] - BUOY * h0));

        if (fu > 0.02) {
          fuel[i] = fu - fu * BURN;
          // Температура горения гуляет в двух масштабах: мелкое зерно даёт
          // рябь, крупные пятна — вспышки и провалы. Ровная заливка не
          // читается как огонь.
          var flick = PM.rng.fbm(x / (2.6 * sc), y / (2.6 * sc) - t * 0.9,
                                 seed + 77, 2);
          var patch = PM.rng.fbm(x / (13 * sc), y / (13 * sc) - t * 0.22,
                                 seed + 5501, 2);
          // Пока топлива вдоволь, горит на полную; к концу запаса пламя
          // само садится — поэтому язык не обрывается, а угасает.
          var left = fu * 2.2; if (left > 1) left = 1;
          var tb = left * (0.55 + 0.65 * flick) * (0.45 + 1.05 * patch);
          if (h < tb) h = tb;
        }

        // Турбулентное перемешивание: без него шлейф над кромкой выходит
        // гладким серым облаком, а не трепещущим языком.
        h *= 0.90 + 0.20 * PM.rng.value2d(x / (3.1 * sc),
                                          y / (3.1 * sc) - t * 0.8, seed + 331);

        if (h > TCAP) h = TCAP;
        h -= COOLQ * h * h * h * h + COOLL * h;
        tmp[i] = h > 0.0025 ? h : 0;
      }
    }

    for (var y2 = bandTop; y2 <= bandBot; y2++) {
      var r2 = y2 * W;
      for (var x2 = 0; x2 < W; x2++) heat[r2 + x2] = tmp[r2 + x2];
    }
  }

  // --- шаг ---

  function step() {
    if (!active || !f) return;
    t++;

    var prevBot = bandBot;

    if (phase === 'sweep') {
      var edge = topY - 3;
      var lowest = -1e9, highest = 1e9;

      for (var x = 0; x < W; x++) {
        var y0 = front[x];
        if (y0 < edge) { if (y0 < highest) highest = y0; continue; }

        // топливо в четырёх пикселях над фронтом
        var fu = 0, iy = Math.round(y0);
        for (var d = 1; d <= 4; d++) {
          var yy = iy - d;
          if (yy < 0) break;
          var j = yy * W + x;
          if (!f.mask[j]) continue;
          if (f.owner[j]) fu += 1;
          else if (f.film[j] > 40) fu += 0.5;
        }

        // Два масштаба ряби: длинная волна гнёт кромку целыми участками,
        // короткая рвёт её на зубцы. Одной ровной линейки быть не должно.
        var wob = 1.20 * PM.rng.fbm(x / (14 * sc), t / 26, seed + 71, 2)
                + 0.55 * PM.rng.fbm(x / (4.5 * sc), t / 11, seed + 907, 2);
        front[x] = y0 - (0.55 + wob + 0.22 * fu) * sc * 0.80;

        burnColumn(x, y0, front[x]);
        if (front[x] > lowest) lowest = front[x];
        if (front[x] < highest) highest = front[x];
      }

      if (lit) { PM.sound.event('crackle', null, (litX / W - 0.5) * 1.7); lit = 0; }

      if (lowest < edge) {
        phase = 'cool'; after = 0;
        bandTop = topY; bandBot = botY;
      } else {
        bandTop = Math.max(topY, Math.round(highest - PLUME * sc));
        bandBot = Math.min(botY, Math.round(lowest + EMBER * sc));
      }
    } else {
      after++;
      bandTop = topY; bandBot = botY;
    }

    // Строки, вышедшие из полосы, гасим явно: иначе под фронтом остаётся
    // навсегда замерший ряд углей.
    if (bandBot < prevBot) {
      for (var yy2 = bandBot + 1; yy2 <= prevBot; yy2++) {
        var r3 = yy2 * W;
        for (var x3 = 0; x3 < W; x3++) { heat[r3 + x3] = 0; fuel[r3 + x3] = 0; }
      }
    }

    velocity();
    advect();
    sootDecay();

    if (phase === 'cool' && after > COOLF) {
      active = false;
      var cb = done;
      done = null; f = null;
      if (cb) cb();
    }
  }

  // Поджечь пиксели, через которые фронт прошёл за этот кадр.
  function burnColumn(x, y0, y1) {
    var a = Math.floor(y1), b = Math.ceil(y0);
    if (a < 0) a = 0;
    if (b > H - 1) b = H - 1;

    for (var y = a; y <= b; y++) {
      var i = y * W + x;
      if (!f.mask[i] || lit8[i]) continue;
      lit8[i] = 1;

      var mold = f.owner[i] ? (0.55 + f.density[i] / 460)
                            : (f.film[i] > 40 ? 0.5 : 0);
      // Топливо есть и у чистого агара: он тоже подсыхает и тлеет, просто
      // слабее. Иначе над свободным полем фронт идёт вообще без пламени.
      var fu = 0.18 + 0.82 * mold;
      fuel[i] = fu > 1 ? 1 : fu;
      // Вспышка пропорциональна топливу: над колонией огонь бьёт столбом,
      // над чистым агаром по кромке идёт только тлеющая полоска. Плюс
      // крупные пятна разгона: кромка загорается не целиком, между языками
      // остаётся тёмный агар — сплошная светящаяся линия читается как шов.
      var flare = 0.42 + 1.35 * PM.rng.fbm(x / (16 * sc), y / (16 * sc),
                                           seed + 5501, 2);
      if (flare > 1) flare = 1;
      heat[i] = (0.60 + 0.50 * mold) * flare * (0.85 + Math.random() * 0.3);

      // сажа: по плесени остаётся тёмное пятно, по чистому агару — почти ничего
      var ash = 0.14 + 0.58 * mold
              + (PM.rng.fbm(x / (5 * sc), y / (5 * sc), seed + 213, 2) - 0.5) * 0.3;
      if (ash < 0) ash = 0; else if (ash > 0.95) ash = 0.95;
      if (ash > soot[i]) soot[i] = ash;

      // выгорело: биомассы в этой клетке больше нет
      f.owner[i] = 0; f.density[i] = 0; f.film[i] = 0; f.texSet[i] = 0;

      // треск на кадр один, столбец выбирается из сгоревших равновероятно
      if (mold) { lit++; if (Math.random() * lit < 1) litX = x; }
    }
  }

  // Сажа держится, пока идёт фронт, и выветривается после — так за огнём
  // читается выгоревший след, а в итоге остаётся чистый агар.
  function sootDecay() {
    var ck = phase === 'cool' ? 0.915 : 0.9955;
    for (var y = topY; y <= botY; y++) {
      var row = y * W;
      for (var x = 0; x < W; x++) {
        var i = row + x, s = soot[i];
        if (s) soot[i] = s > 0.003 ? s * ck : 0;
      }
    }
  }

  // --- отрисовка поверх готового кадра ---

  function paint(lum) {
    if (!active || !f) return;

    for (var y = topY; y <= botY; y++) {
      var row = y * W;
      for (var x = 0; x < W; x++) {
        var i = row + x;
        var s = soot[i], h = heat[i];
        if (!s && !h) continue;

        var l = lum[i];
        if (s) l = l * (1 - s) + 5 * s;                  // выгоревший агар
        if (h > 0.004) {
          if (h > 1) h = 1;
          // Кривая крутая: раскалённое основание выбито в белый, а к вершине
          // язык гаснет быстро. Плавная линейная шкала давала серую дымку
          // вместо огня. Зерно тем же шумом, что гоняет поток.
          var g = PM.rng.fbm(x / (3.6 * sc), y / (3.6 * sc) - t * 0.55,
                             seed + 17, 2);
          l += (h * h * 220 + h * 140) * (0.82 + 0.36 * g);
        }
        lum[i] = l > 255 ? 255 : l;
      }
    }
  }

  return {
    start: start,
    step: step,
    paint: paint,
    reset: reset,
    isActive: function () { return active; }
  };
})();
