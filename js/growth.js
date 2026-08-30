var PM = PM || {};

// Гибридный рост: общий клеточный фронт со score-функцией + агенты-кончики для гиф.
// Все архетипы — один кернел с разными весами (см. 02 - Research, разделы 8-11).
PM.growth = (function () {
  var TAU = Math.PI * 2;

  // Веса score-функции: S = wN*N + wD*D + wP*P + wR*R - wC*C - wI*I - wB*B + eta
  // layer: solid — своя территория; veil — полупрозрачный слой поверх всего
  // hollow: рисуется только кайма, тело остаётся прозрачным (кольцо-призрак)
  var ARCH = {
    // компактный бархатистый круг: держится за своих, край гладкий
    velvet:   { wN: 1.6, wD: 0.15, wP: 2.2, wR: 0.30, wC: 0.7, wI: 2.4, wB: 1.6,
                thr: 1.35, noiseScale: 9,  useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 148, noiseMul: 0.35, size: 1.2, ringAmp: 26, lobeMin: 3,  lobeMax: 7 },

    // цепочки пузырей: рост через кончики, которые раздувают кольца
    bubble:   { wN: 1.3, wD: 0.20, wP: 0.9, wR: 0.20, wC: 1.1, wI: 2.6, wB: 1.8,
                thr: 1.65, noiseScale: 6,  useFrontier: 0.25, useTips: 1, bubbles: 1,
                dens: 96,  noiseMul: 1.00, size: 1.2, ringAmp: 18, lobeMin: 3,  lobeMax: 7 },

    // тонкое ветвящееся кружево, фронта почти нет
    hyphal:   { wN: 1.1, wD: 0.10, wP: 0.4, wR: 0.10, wC: 1.6, wI: 2.2, wB: 1.4,
                thr: 1.9,  noiseScale: 5,  useFrontier: 0.1,  useTips: 1, bubbles: 0,
                dens: 168, noiseMul: 1.00, size: 1.4, ringAmp: 12, lobeMin: 3,  lobeMax: 7 },

    // лопастная колония с радиальными секторами
    lobed:    { wN: 1.4, wD: 1.50, wP: 1.1, wR: 0.55, wC: 0.8, wI: 2.2, wB: 1.5,
                thr: 1.30, noiseScale: 13, useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 142, noiseMul: 0.70, size: 1.3, ringAmp: 30, lobeMin: 4,  lobeMax: 9 },

    // концентрические кольца спороношения — «луковица» с рефа
    rings:    { wN: 1.5, wD: 0.20, wP: 2.0, wR: 1.10, wC: 0.7, wI: 2.3, wB: 1.5,
                thr: 1.30, noiseScale: 11, useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 128, noiseMul: 0.40, size: 1.5, ringAmp: 62, lobeMin: 3,  lobeMax: 6 },

    // лучистая розетка: много тонких радиальных лучей, зубчатый край
    rosette:  { wN: 1.5, wD: 2.60, wP: 0.6, wR: 0.35, wC: 0.9, wI: 2.2, wB: 1.5,
                thr: 1.55, noiseScale: 7,  useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 158, noiseMul: 0.50, size: 1.3, ringAmp: 22, lobeMin: 12, lobeMax: 28 },

    // дендрит: голодный режим, экранирование — ветвится и не заплывает
    dendrite: { wN: 2.4, wD: 0.25, wP: 0.15, wR: 0.15, wC: 2.4, wI: 2.0, wB: 1.3,
                thr: 1.95, noiseScale: 4,  useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 178, noiseMul: 1.40, size: 1.5, ringAmp: 10, lobeMin: 3,  lobeMax: 8 },

    // полупрозрачная плёнка: быстрая, рыхлая, территорию не отбирает
    film:     { wN: 0.8, wD: 0.25, wP: 1.3, wR: 0.15, wC: 0.2, wI: 0.6, wB: 1.2,
                thr: 1.05, noiseScale: 9,  useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 74,  noiseMul: 1.20, size: 1.4, ringAmp: 0,  lobeMin: 3,  lobeMax: 6,
                layer: 'veil' },

    // диффузное облако: большое мягкое пятно поверх остальных
    halo:     { wN: 0.7, wD: 0.40, wP: 1.5, wR: 0.45, wC: 0.2, wI: 0.5, wB: 1.1,
                thr: 1.00, noiseScale: 12, useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 62,  noiseMul: 0.90, size: 1.6, ringAmp: 34, lobeMin: 3,  lobeMax: 6,
                layer: 'veil' },

    // кольцо-призрак: фронт ушёл, центр лизировался — видна только кайма
    crater:   { wN: 1.8, wD: 0.30, wP: 1.8, wR: 0.25, wC: 0.6, wI: 1.8, wB: 1.5,
                thr: 1.15, noiseScale: 12, useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 130, noiseMul: 0.45, size: 1.2, ringAmp: 0,  lobeMin: 3,  lobeMax: 6,
                hollow: true }
  };

  var WEIGHTS = [['velvet', 16], ['bubble', 18], ['hyphal', 12], ['lobed', 12],
                 ['rings', 12], ['rosette', 10], ['dendrite', 8],
                 ['film', 4], ['halo', 5], ['crater', 5]];
  var TOTAL_W = 102;

  var OFF8 = null;   // смещения соседей, зависят от ширины поля

  function buildOffsets(W) {
    OFF8 = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
  }

  function pickArchetype(rnd, forced) {
    if (forced && ARCH[forced]) return forced;
    var r = rnd() * TOTAL_W, acc = 0;
    for (var i = 0; i < WEIGHTS.length; i++) {
      acc += WEIGHTS[i][1];
      if (r < acc) return WEIGHTS[i][0];
    }
    return 'velvet';
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function makeColony(id, x, y, rnd, seed, forcedArch, scale) {
    var name = pickArchetype(rnd, forcedArch);
    var a = ARCH[name];
    var sc = scale || 1;                       // всё пиксельное тянется за разрешением
    return {
      id: id, archetype: name, a: a,
      x: x, y: y,
      seed: (seed ^ (id * 2654435761)) >>> 0,
      growthRate: lerp(0.45, 1.25, rnd()),
      branchChance: lerp(0.004, 0.030, rnd()),
      persistence: lerp(0.20, 0.92, rnd()),
      lobeNoise: lerp(0.15, 0.85, rnd()),
      ringPeriod: (name === 'rings' ? lerp(5, 13, rnd()) : lerp(8, 26, rnd())) * sc,
      haloWidth: lerp(1, 4, rnd()),
      satelliteChance: lerp(0, 0.018, rnd()),
      inhibition: lerp(0.2, 1.0, rnd()),
      decayAge: lerp(900, 3000, rnd()),
      collisionMode: rnd() < 0.08 ? 'overgrow' : (rnd() < 0.5 ? 'stop' : 'avoid'),
      lobes: a.lobeMin + ((rnd() * (a.lobeMax - a.lobeMin + 1)) | 0),
      dirAngle: rnd() * TAU,
      bubbleSpacing: Math.round((16 + rnd() * 22) * sc),
      bubbleR: lerp(3.0, 9.0, rnd()) * sc,
      maxCells: Math.round(lerp(90, 1300, Math.pow(rnd(), 2.0)) * a.size * sc * sc),
      sc: sc,
      noiseScale: a.noiseScale * sc,
      tipLife: Math.round((110 + rnd() * 200) * sc),
      // споры прорастают не разом — часть отстаёт и остаётся мелкой
      delay: Math.round(Math.pow(rnd(), 1.7) * 1400),
      // анизотропия: одна сторона колонии растёт охотнее — форма уходит от круга
      drift: rnd() * TAU,
      wDrift: Math.pow(rnd(), 1.6) * 0.55,
      frontier: [], tips: [], cells: 0, alive: true, stalled: 0
    };
  }

  function isVeil(c) { return c.a.layer === 'veil'; }
  function occArray(c, f) { return isVeil(c) ? f.film : f.owner; }

  // Занять клетку
  function occupy(c, f, j, dens) {
    if (isVeil(c)) {
      var jx = j % f.W, jy = (j / f.W) | 0;
      var soft = 0.30 + 1.15 * PM.rng.fbm(jx / 5.5, jy / 5.5, c.seed + 51, 3);
      // накопительно: несколько прозрачных колоний наслаиваются друг на друга
      var v = f.film[j] + dens * soft;
      f.film[j] = v > 255 ? 255 : v;
    } else {
      f.owner[j] = c.id;
      f.birth[j] = f.tick;
      f.density[j] = dens;
    }
    f.nutrient[j] *= 0.22;
    f.inhibitor[j] += 0.16;
    c.frontier.push(j);
    c.cells++;
  }

  // Клетка выбывает из фронта, если вокруг не осталось свободного места
  function maybeRetire(c, F, k, occ, f) {
    var i = F[k], free = 0;
    for (var q = 0; q < 8; q++) {
      var m = i + OFF8[q];
      if (m < 0 || m >= f.n) continue;
      if (f.mask[m] && !occ[m]) { free = 1; break; }
    }
    if (!free) { F[k] = F[F.length - 1]; F.pop(); }
  }

  // Штраф у стенки чашки: 0 в центре, 1 вплотную к ободу
  function wallPenalty(f, x, y) {
    var cx = f.W * 0.5, cy = f.H * 0.5;
    var R = 0.436 * f.W * 0.9;
    var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / R;
    return d > 0.86 ? (d - 0.86) / 0.14 : 0;
  }

  // --- фронтальный рост по score-функции ---
  function growFrontier(c, f, rnd, budget) {
    var F = c.frontier;
    if (!F.length || budget <= 0) return;

    var W = f.W, mask = f.mask, occ = occArray(c, f);
    var nut = f.nutrient, inh = f.inhibitor, own = f.owner;
    var a = c.a, id = c.id, isFilm = isVeil(c);
    var placed = 0, guard = budget * 14;

    while (placed < budget && guard-- > 0 && F.length) {
      var k = (rnd() * F.length) | 0;
      var i = F[k];

      var j = i + OFF8[(rnd() * 8) | 0];
      if (j < 0 || j >= f.n || !mask[j]) { maybeRetire(c, F, k, occ, f); continue; }
      if (occ[j]) { maybeRetire(c, F, k, occ, f); continue; }
      // чужая территория: плёнка проходит поверх, остальные — нет
      if (!isFilm && own[j] && own[j] !== id) {
        if (c.collisionMode !== 'overgrow') continue;
        if (rnd() > 0.25) continue;          // перерастает медленно
      }

      var jx = j % W, jy = (j / W) | 0;
      var dx = jx - c.x, dy = jy - c.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 0.001;

      // --- члены score ---
      var N = nut[j];
      var th = Math.atan2(dy, dx);
      var D = 0.5 + 0.5 * Math.cos(c.lobes * th + c.dirAngle);
      var A = 0.5 + 0.5 * Math.cos(th - c.drift);          // снос в одну сторону
      var sup = 0, crowd = 0;
      for (var q = 0; q < 8; q++) {
        var m = j + OFF8[q];
        if (m < 0 || m >= f.n) continue;
        // поддержка — только свои клетки, теснота — только чужие
        if (isFilm ? occ[m] : occ[m] === id) sup++;
        else if (own[m] && own[m] !== id) crowd++;
      }
      var P = sup / 8;
      var C = crowd / 8;
      var R = 0.5 + 0.5 * Math.sin(dist / c.ringPeriod * TAU);
      var I = inh[j] * c.inhibition;
      var B = wallPenalty(f, jx, jy);
      var eta = (PM.rng.fbm(jx / c.noiseScale, jy / c.noiseScale, c.seed, 3) - 0.5)
                * 2 * c.lobeNoise * a.noiseMul;

      var S = a.wN * N + a.wD * D + a.wP * P + a.wR * R + c.wDrift * A
            - a.wC * C - a.wI * I - a.wB * B + eta;

      var p = 1 / (1 + Math.exp(-(S - a.thr) * 4.5));
      if (rnd() < p) {
        var dens = (a.dens + (rnd() - 0.5) * 40) | 0;
        if (dens < 30) dens = 30;
        if (dens > 250) dens = 250;
        occupy(c, f, j, dens);
        placed++;
      }
    }
  }

  // Куда вкуснее: сравниваем питание слева и справа по курсу
  function nutrientPull(f, x, y, ang) {
    var W = f.W, d = 4 * (f.scale || 1);
    var la = ang - 0.7, ra = ang + 0.7;
    var lx = Math.round(x + Math.cos(la) * d), ly = Math.round(y + Math.sin(la) * d);
    var rx = Math.round(x + Math.cos(ra) * d), ry = Math.round(y + Math.sin(ra) * d);
    var li = ly * W + lx, ri = ry * W + rx;
    var lv = (li >= 0 && li < f.n) ? f.nutrient[li] : 0;
    var rv = (ri >= 0 && ri < f.n) ? f.nutrient[ri] : 0;
    return (rv - lv) * 0.7;
  }

  // Пузырь: яркий контур + чуть более тёмное нутро, как на референсе
  function stampBubble(c, f, cx, cy, r) {
    var W = f.W, H = f.H, ri = Math.round(r);
    if (ri < 1) return;
    var r2 = r * r, rin2 = (r - 1.2) * (r - 1.2);
    for (var y = cy - ri - 1; y <= cy + ri + 1; y++) {
      if (y < 0 || y >= H) continue;
      for (var x = cx - ri - 1; x <= cx + ri + 1; x++) {
        if (x < 0 || x >= W) continue;
        var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
        if (d2 > r2 + r) continue;
        var i = y * W + x;
        if (!f.mask[i]) continue;
        var isRing = d2 >= rin2;
        if (f.owner[i] && f.owner[i] !== c.id) {
          // поверх чужой массы рисуем только светлый контур — это и даёт наслоения
          if (isRing && f.film[i] < 190) f.film[i] = 190;
          continue;
        }
        if (!f.owner[i]) occupy(c, f, i, isRing ? 232 : 78);
        else if (isRing) f.density[i] = 232;
      }
    }
  }

  // --- агенты-кончики: гифы и цепочки пузырей ---
  function growTips(c, f, rnd, speed) {
    if (rnd() > 0.045 * speed * c.sc) return;
    var W = f.W, H = f.H, mask = f.mask;
    var tips = c.tips;
    var born = [];

    for (var t = 0; t < tips.length; t++) {
      var tip = tips[t];
      if (tip.life <= 0) continue;

      // поворот: инерция + шум + подтягивание к питанию
      var wob = PM.rng.fbm(tip.x / 7, tip.y / 7, c.seed + 77, 2) - 0.5;
      tip.ang += wob * (1 - c.persistence) * 2.2;
      tip.ang += nutrientPull(f, tip.x, tip.y, tip.ang) * 0.35;

      tip.x += Math.cos(tip.ang);
      tip.y += Math.sin(tip.ang);
      var ix = Math.round(tip.x), iy = Math.round(tip.y);
      if (ix < 1 || iy < 1 || ix >= W - 1 || iy >= H - 1) { tip.life = 0; continue; }
      var i = iy * W + ix;
      if (!mask[i]) { tip.life = 0; continue; }

      // анастомоз: упёрлись в чужую нить — сливаемся и гаснем
      if (f.owner[i] && f.owner[i] !== c.id) { tip.life = 0; continue; }

      if (f.nutrient[i] < 0.14) { tip.life = 0; continue; }

      if (!f.owner[i]) occupy(c, f, i, c.a.dens);
      else if (f.density[i] < c.a.dens) f.density[i] = c.a.dens;

      tip.life--;

      // раздуть пузырь
      if (c.a.bubbles) {
        tip.since++;
        if (tip.since >= tip.spacing) {
          tip.since = 0;
          tip.spacing = c.bubbleSpacing + ((rnd() * 14) | 0);
          var r = c.bubbleR * Math.exp((rnd() - 0.5) * 1.1);   // логнормальный разброс
          stampBubble(c, f, ix, iy, r);
        }
      }

      // ветвление
      if (rnd() < c.branchChance * 2.5 && born.length + tips.length < 10) {
        born.push({
          x: tip.x, y: tip.y,
          ang: tip.ang + (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 0.6),
          life: (tip.life * (0.5 + rnd() * 0.4)) | 0,
          since: 0, spacing: c.bubbleSpacing
        });
      }
    }

    var alive = [];
    for (var q = 0; q < tips.length; q++) if (tips[q].life > 0) alive.push(tips[q]);
    c.tips = alive.concat(born);
  }

  // --- посев ---
  function inoculate(c, f, rnd) {
    var i = Math.round(c.y) * f.W + Math.round(c.x);
    if (!f.mask[i]) return;
    occupy(c, f, i, c.a.dens);
    if (c.a.useTips) {
      var k = 2 + ((rnd() * 2) | 0);
      for (var t = 0; t < k; t++) {
        c.tips.push({
          x: c.x, y: c.y,
          ang: rnd() * TAU,
          life: c.tipLife,
          since: 0, spacing: c.bubbleSpacing
        });
      }
    }
  }

  function stochasticRound(v, rnd) {
    var i = Math.floor(v);
    return i + (rnd() < v - i ? 1 : 0);
  }

  // --- один тик симуляции ---
  function tick(f, colonies, rnd, speed) {
    if (!OFF8 || OFF8[3] !== f.W) buildOffsets(f.W);

    for (var k = 0; k < colonies.length; k++) {
      var c = colonies[k];
      if (!c.alive) continue;
      if (f.tick < c.delay) continue;          // спора ещё не проросла
      var before = c.cells;

      var budget = 0;
      if (c.a.useFrontier > 0) {
        budget = stochasticRound(c.growthRate * speed * 0.5 * c.sc * c.sc * c.a.useFrontier, rnd);
        growFrontier(c, f, rnd, budget);
      }
      if (c.a.useTips) growTips(c, f, rnd, speed);

      // сателлит — дочерний пузырь в стороне от материнской колонии
      if (c.a.bubbles && rnd() < c.satelliteChance && c.cells > 40) {
        var ang = rnd() * TAU, dd = 8 + rnd() * 26;
        var sx = Math.round(c.x + Math.cos(ang) * dd);
        var sy = Math.round(c.y + Math.sin(ang) * dd);
        if (sx > 1 && sy > 1 && sx < f.W - 1 && sy < f.H - 1 && f.mask[sy * f.W + sx]) {
          stampBubble(c, f, sx, sy, c.bubbleR * (0.5 + rnd()));
        }
      }

      if (c.cells >= c.maxCells) { c.alive = false; c.tips.length = 0; continue; }

      if (c.cells === before) {
        if (budget > 0 || c.tips.length) c.stalled++;
        // колония мертва, когда некуда расти: фронт пуст и кончиков нет
        if (!c.frontier.length && !c.tips.length) c.alive = false;
        else if (c.stalled > 600) c.alive = false;
      } else c.stalled = 0;
    }

    if (f.tick % 3 === 0) {
      PM.fields.diffuse(f.nutrient, f, 0.16, 0.9995);
      PM.fields.diffuse(f.inhibitor, f, 0.42, 0.992);
    }
    f.tick++;
  }

  function anyAlive(colonies) {
    for (var i = 0; i < colonies.length; i++) if (colonies[i].alive) return true;
    return false;
  }

  return {
    ARCH: ARCH,
    makeColony: makeColony,
    inoculate: inoculate,
    tick: tick,
    anyAlive: anyAlive,
    names: function () { return WEIGHTS.map(function (w) { return w[0]; }); }
  };
})();
