var PM = PM || {};

// Гибридный рост: общий клеточный фронт со score-функцией + агенты-кончики для гиф.
// Все архетипы — один кернел с разными весами (см. 02 - Research, разделы 8-11).
PM.growth = (function () {
  var TAU = Math.PI * 2;

  // Веса score-функции: S = wN*N + wD*D + wP*P + wR*R + drift - wC*C - wI*I - wB*B + eta
  //
  // layer   : solid — своя территория; veil — полупрозрачный слой поверх всего
  // hollow  : рисуется только кайма, тело прозрачное (кольцо-призрак)
  // texture : чем заполнена внутренность — именно она отличает виды на глаз
  //           smooth | zones | grooves | groove | speckle | crackle | fuzz
  // blob    : чем штампуют кончики — ring (контур) или dome (капля с бликом)
  // haloB   : яркость пушистой опушки по краю колонии
  var ARCH = {
    // Базовый вид: то, что вырастает на хлебе. Почти правильный круг,
    // белая кайма стерильного мицелия по краю, тёмный споровый центр,
    // слабая радиальная бороздчатость. Растёт точечно и не заплывает.
    colony:   { latin: 'Penicillium chrysogenum',
                desc: 'round velvety colony, white rim, dark spore centre',
                wN: 0.85, wD: 0.06, wP: 3.6, wR: 0.15, wC: 0.9, wI: 2.7, wB: 1.7,
                thr: 1.30, noiseScale: 16, useFrontier: 1, useTips: 0, bubbles: 0,
                dens: 198, noiseMul: 0.06, size: 0.30, ringAmp: 0,
                lobeMin: 9, lobeMax: 18,
                texture: 'sulcate', haloB: 48, sporeDark: 84,
                haloAgeMul: 2.2, broodSpread: 2.6,
                driftMul: 0.08, edgeFade: 190 },


    // мишень: резкие концентрические зоны и широкая светлая опушка.
    // Главный мотив реальной заплесневелой чашки.
    target:   { latin: 'Trichoderma harzianum', desc: 'concentric sporulation zones',
                wN: 1.5, wD: 0.20, wP: 2.1, wR: 0.40, wC: 0.7, wI: 2.3, wB: 1.5,
                thr: 1.32, noiseScale: 11, useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 112, noiseMul: 0.32, size: 1.4, ringAmp: 62, lobeMin: 3,  lobeMax: 5,
                texture: 'zones', haloB: 88 },



    // длинные тонкие иглы от центра
    starburst:{ latin: 'Streptomyces griseus', desc: 'long radial spokes',
                wN: 1.5, wD: 3.20, wP: 0.45, wR: 0.20, wC: 0.9, wI: 2.2, wB: 1.5,
                thr: 1.70, noiseScale: 7,  useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 196, noiseMul: 0.35, size: 1.4, ringAmp: 0,  lobeMin: 14, lobeMax: 30,
                texture: 'smooth', haloB: 26 },

    // голодный режим с экранированием: ветвится и не заплывает
    dendrite: { latin: 'Bacillus subtilis', desc: 'branching, nutrient-starved',
                wN: 2.4, wD: 0.25, wP: 0.15, wR: 0.15, wC: 2.4, wI: 2.0, wB: 1.3,
                thr: 1.95, noiseScale: 4,  useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 202, noiseMul: 1.40, size: 1.5, ringAmp: 0,  lobeMin: 3,  lobeMax: 8,
                texture: 'smooth', haloB: 0 },

    // светлая масса с тёмным крапом спороносцев
    speckle:  { latin: 'Aspergillus flavus', desc: 'pale mat flecked with spores',
                wN: 1.5, wD: 0.30, wP: 1.7, wR: 0.20, wC: 0.8, wI: 2.2, wB: 1.5,
                thr: 1.36, noiseScale: 10, useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 206, noiseMul: 0.45, size: 1.3, ringAmp: 0,  lobeMin: 3,  lobeMax: 6,
                texture: 'speckle', haloB: 30 },

    // сплошное поле, разбитое сеткой трещин
    crackle:  { latin: 'Alternaria alternata', desc: 'dark mat split by cracks',
                wN: 1.5, wD: 0.25, wP: 2.0, wR: 0.20, wC: 0.7, wI: 2.1, wB: 1.4,
                thr: 1.28, noiseScale: 14, useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 116, noiseMul: 0.40, size: 1.6, ringAmp: 0,  lobeMin: 3,  lobeMax: 6,
                texture: 'crackle', haloB: 22 },


    // цепочки пузырей: кончики раздувают светлые кольца
    bubble:   { latin: 'Saccharomyces cerevisiae', desc: 'chains of budding rings',
                wN: 1.3, wD: 0.20, wP: 0.9, wR: 0.20, wC: 1.1, wI: 2.6, wB: 1.8,
                thr: 1.65, noiseScale: 6,  useFrontier: 0.25, useTips: 1, bubbles: 1,
                dens: 96,  noiseMul: 1.00, size: 1.0, ringAmp: 0,  lobeMin: 3,  lobeMax: 7,
                texture: 'smooth', haloB: 0, blob: 'ring',
                blobR: [3.0, 7.0], blobGap: [30, 64] },

    // икра: плотная гроздь одинаковых мелких капель
    roe:      { latin: 'Micrococcus luteus', desc: 'tight cluster of tiny domes',
                wN: 1.4, wD: 0.20, wP: 1.2, wR: 0.20, wC: 1.0, wI: 2.4, wB: 1.7,
                thr: 1.55, noiseScale: 6,  useFrontier: 0.3,  useTips: 1, bubbles: 1,
                dens: 104, noiseMul: 0.80, size: 1.0, ringAmp: 0,  lobeMin: 3,  lobeMax: 7,
                texture: 'smooth', haloB: 0, blob: 'dome',
                blobR: [1.6, 3.2], blobGap: [3, 6] },


    // тонкое ветвящееся кружево
    hyphal:   { latin: 'Neurospora crassa', desc: 'fine branching lace',
                wN: 1.1, wD: 0.10, wP: 0.4, wR: 0.10, wC: 1.6, wI: 2.2, wB: 1.4,
                thr: 1.9,  noiseScale: 5,  useFrontier: 0.1,  useTips: 1, bubbles: 0,
                dens: 168, noiseMul: 1.00, size: 1.4, ringAmp: 0,  lobeMin: 3,  lobeMax: 7,
                texture: 'smooth', haloB: 0 },

    // кольцо-призрак: фронт ушёл, центр лизировался
    crater:   { latin: 'Proteus mirabilis', desc: 'swarming ring, hollow centre',
                wN: 1.8, wD: 0.30, wP: 1.8, wR: 0.25, wC: 0.6, wI: 1.8, wB: 1.5,
                thr: 1.15, noiseScale: 12, useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 130, noiseMul: 0.45, size: 1.2, ringAmp: 0,  lobeMin: 3,  lobeMax: 6,
                texture: 'smooth', haloB: 0, hollow: true },

    // полупрозрачная плёнка поверх остальных
    film:     { latin: 'Pseudomonas aeruginosa', desc: 'translucent biofilm over others',
                wN: 0.8, wD: 0.25, wP: 1.3, wR: 0.15, wC: 0.2, wI: 0.6, wB: 1.2,
                thr: 1.05, noiseScale: 9,  useFrontier: 1,    useTips: 0, bubbles: 0,
                dens: 74,  noiseMul: 1.20, size: 1.5, ringAmp: 0,  lobeMin: 3,  lobeMax: 6,
                texture: 'smooth', haloB: 0, layer: 'veil' }
  };

  var WEIGHTS = [
    ['colony', 20], ['target', 12], ['starburst', 10], ['crackle', 9],
    ['speckle', 9], ['bubble', 10], ['roe', 8], ['dendrite', 8],
    ['hyphal', 7], ['crater', 6], ['film', 5]
  ];
  var TOTAL_W = 104;

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
    var rot = 0.3 + rnd() * 2.4;               // угол поворота текстурных координат
    return {
      id: id, archetype: name, a: a,
      x: x, y: y,
      seed: (seed ^ (id * 2654435761)) >>> 0,
      growthRate: lerp(0.45, 1.25, rnd()),
      branchChance: lerp(0.004, 0.030, rnd()),
      persistence: lerp(0.20, 0.92, rnd()),
      lobeNoise: lerp(0.15, 0.85, rnd()),
      ringPeriod: (name === 'target' ? lerp(7, 17, rnd()) : lerp(8, 26, rnd())) * sc,
      haloWidth: lerp(1, 4, rnd()),
      satelliteChance: lerp(0, 0.018, rnd()),
      inhibition: lerp(0.2, 1.0, rnd()),
      decayAge: lerp(900, 3000, rnd()),
      collisionMode: rnd() < 0.08 ? 'overgrow' : (rnd() < 0.5 ? 'stop' : 'avoid'),
      lobes: a.lobeMin + ((rnd() * (a.lobeMax - a.lobeMin + 1)) | 0),
      dirAngle: rnd() * TAU,
      bubbleSpacing: Math.round(lerp(a.blobGap ? a.blobGap[0] : 16,
                                     a.blobGap ? a.blobGap[1] : 38, rnd()) * sc),
      bubbleR: lerp(a.blobR ? a.blobR[0] : 3, a.blobR ? a.blobR[1] : 9, rnd()) * sc,
      // не жёсткий потолок, а «жадность»: насколько охотно колония берёт площадь
      greed: lerp(0.55, 1.0, Math.pow(rnd(), 0.7)) * a.size,
      maxCells: Math.round(lerp(260, 2100, Math.pow(rnd(), 1.6))
                           * a.size * sc * sc * (a.layer === 'veil' ? 0.6 : 1)),
      // сколько поколений дочерних очагов ещё может дать этот штамм
      brood: a.layer === 'veil' ? 0 : 1,
      sporeChance: lerp(0.004, 0.030, rnd()),
      tone: lerp(0.62, 1.34, rnd()),
      sc: sc,
      noiseScale: a.noiseScale * sc,
      tipLife: Math.round((110 + rnd() * 200) * sc),
      haloAge: Math.round((70 + rnd() * 220) * (a.haloAgeMul || 1)),
      lastGrow: 0,
      // споры прорастают не разом — часть отстаёт и остаётся мелкой
      delay: Math.round(Math.pow(rnd(), 1.7) * 1400),
      // анизотропия: одна сторона колонии растёт охотнее — форма уходит от круга
      drift: rnd() * TAU,
      swirl: (rnd() - 0.5) * 0.09,      // закрутка борозд, чтобы не были спицами
      rotC: Math.cos(rot), rotS: Math.sin(rot),   // поворот координат текстуры (см. scene)
      wDrift: Math.pow(rnd(), 1.6) * 0.55 * (a.driftMul === undefined ? 1 : a.driftMul),
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
    return d > 0.94 ? (d - 0.94) / 0.06 : 0;
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
        var dens = (a.dens * c.tone + (rnd() - 0.5) * 26) | 0;
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

  // Пузырь/капля заводится как объект и раздувается за десятки тиков.
  // Мгновенный штамп выглядел как подброшенная фигура, а не как рост.
  function spawnBlob(c, f, cx, cy, rMax, rnd) {
    if (!c.blobs) c.blobs = [];
    if (c.blobs.length > 48 || rMax < 1) return;
    c.blobs.push({
      x: cx, y: cy, r: 0.5, rMax: rMax,
      sp: rMax / (40 + rnd() * 110)          // полное раздувание за 40-150 тиков
    });
  }

  function growBlobs(c, f) {
    var B = c.blobs;
    if (!B || !B.length) return;
    var dome = c.a.blob === 'dome';
    for (var k = B.length - 1; k >= 0; k--) {
      var b = B[k];
      var prev = b.r;
      b.r += b.sp;
      if (b.r > b.rMax) b.r = b.rMax;
      paintBand(c, f, b, prev, b.r, dome);
      if (b.r >= b.rMax) B.splice(k, 1);
    }
  }

  // Рисуем только кольцевую полосу [r0, r1] — то, что приросло за тик.
  function paintBand(c, f, b, r0, r1, dome) {
    var W = f.W, H = f.H;
    var cx = b.x, cy = b.y;
    var ri = Math.ceil(r1) + 1;
    var outer = r1 * r1;
    var inner = r0 > 1.2 ? (r0 - 1.2) * (r0 - 1.2) : 0;
    var lipIn = (r1 - 1.3) * (r1 - 1.3);

    for (var y = cy - ri; y <= cy + ri; y++) {
      if (y < 1 || y >= H - 1) continue;
      for (var x = cx - ri; x <= cx + ri; x++) {
        if (x < 1 || x >= W - 1) continue;
        var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
        if (d2 > outer || d2 < inner) continue;
        var i = y * W + x;
        if (!f.mask[i]) continue;

        var onLip = d2 >= lipIn;
        var val;
        if (dome) {
          // Купол считается от финального радиуса: по мере роста капля
          // дорисовывается наружу, а блик остаётся на месте. Гладкую параболу
          // слегка рвём шумом, иначе дизер выстраивает по ней ровные кольца.
          var t = Math.sqrt(d2) / b.rMax;
          val = 238 - 150 * t * t
                + (PM.rng.fbm(x / 2.6, y / 2.6, c.seed + 311, 2) - 0.5) * 26;
          if (onLip && r1 >= b.rMax) val = 66;
        } else {
          val = onLip ? 232 : 78;
        }

        if (f.owner[i] && f.owner[i] !== c.id) {
          if (onLip && !dome && f.film[i] < 190) f.film[i] = 190;
          continue;
        }
        if (!f.owner[i]) occupy(c, f, i, val);
        else f.density[i] = val;      // своя клетка перерисовывается свободно
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

      var td = c.a.dens * c.tone;
      if (!f.owner[i]) occupy(c, f, i, td);
      else if (f.density[i] < td) f.density[i] = td;

      tip.life--;

      // раздуть пузырь
      if (c.a.bubbles) {
        tip.since++;
        if (tip.since >= tip.spacing) {
          tip.since = 0;
          tip.spacing = c.bubbleSpacing + ((rnd() * 14) | 0);
          var r = c.bubbleR * Math.exp((rnd() - 0.5) * 1.1);   // логнормальный разброс
          spawnBlob(c, f, ix, iy, r, rnd);
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
    occupy(c, f, i, c.a.dens * c.tone);
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
      if (c.cells >= c.maxCells) {
        c.alive = false; c.tips.length = 0;
        sporulate(c, f, rnd, colonies);
        continue;
      }
      var before = c.cells;

      var budget = 0;
      if (c.a.useFrontier > 0) {
        budget = stochasticRound(c.growthRate * c.greed * speed * 0.7 * c.sc * c.sc * c.a.useFrontier, rnd);
        growFrontier(c, f, rnd, budget);
      }
      if (c.a.useTips) growTips(c, f, rnd, speed);
      if (c.blobs && c.blobs.length) growBlobs(c, f);

      // сателлит — дочерний пузырь в стороне от материнской колонии
      if (c.a.bubbles && rnd() < c.satelliteChance && c.cells > 40) {
        var ang = rnd() * TAU, dd = 8 + rnd() * 26;
        var sx = Math.round(c.x + Math.cos(ang) * dd);
        var sy = Math.round(c.y + Math.sin(ang) * dd);
        if (sx > 1 && sy > 1 && sx < f.W - 1 && sy < f.H - 1 && f.mask[sy * f.W + sx]) {
          spawnBlob(c, f, sx, sy, c.bubbleR * (0.5 + rnd()), rnd);
        }
      }

      if (c.cells === before) {
        if (budget > 0 || c.tips.length) c.stalled++;
        // фронт встал — колония переходит к вторичному росту внутрь себя
        if (c.stalled > 40 && rnd() < 0.010) secondaryWave(c, f, rnd);
        // колония мертва, когда некуда расти: фронт пуст и кончиков нет
        if (!c.frontier.length && !c.tips.length &&
            !(c.blobs && c.blobs.length)) c.alive = false;
        else if (c.stalled > 600) c.alive = false;
      } else { c.stalled = 0; c.lastGrow = f.tick; }
    }

    if (f.tick % 3 === 0) {
      PM.fields.diffuse(f.nutrient, f, 0.16, 0.9995);
      PM.fields.diffuse(f.inhibitor, f, 0.42, 0.992);
    }
    f.tick++;
  }

  // Вторичный очаг внутри уже занятой территории: плотное пятно с обнулённым
  // возрастом — кольца спороношения идут по нему заново. Так выглядит зрелая
  // чашка: базовый газон и наросты поверх него.
  function secondaryWave(c, f, rnd) {
    var F = c.frontier;
    var pool = F.length ? F : null;
    var i;
    if (pool) i = pool[(rnd() * pool.length) | 0];
    else i = Math.round(c.y) * f.W + Math.round(c.x);

    var W = f.W, H = f.H;
    var cx = i % W, cy = (i / W) | 0;
    // сместиться вглубь территории, а не сидеть на кайме
    var ang = rnd() * TAU, off = rnd() * 26 * c.sc;
    cx = Math.round(cx + Math.cos(ang) * off);
    cy = Math.round(cy + Math.sin(ang) * off);

    var r = (2 + rnd() * 6) * c.sc, ri = Math.ceil(r * 1.35);
    var boost = 14 + rnd() * 22;
    var cap = c.a.dens * c.tone + 62;                   // очаг не должен выбеливаться в пятно
    var wob = rnd() * 1000;
    for (var y = cy - ri; y <= cy + ri; y++) {
      if (y < 1 || y >= H - 1) continue;
      for (var x = cx - ri; x <= cx + ri; x++) {
        if (x < 1 || x >= W - 1) continue;
        var dx = x - cx, dy = y - cy;
        var dd = Math.sqrt(dx * dx + dy * dy);
        // край очага рваный, а не циркульный
        var rr = r * (0.72 + 0.56 * PM.rng.fbm(
          Math.cos(Math.atan2(dy, dx)) * 2.2 + wob,
          Math.sin(Math.atan2(dy, dx)) * 2.2, c.seed + townHash(cx, cy), 2));
        if (dd > rr) continue;
        var j = y * W + x;
        if (f.owner[j] !== c.id) continue;
        if (f.tick - f.birth[j] < c.ringPeriod * 2) continue;   // только зрелый газон
        var d = f.density[j] + boost;
        f.density[j] = d > cap ? cap : d;
        // возраст сбрасывается не в ноль, а вразнобой: кольца по очагу
        // пойдут заново, но не сойдутся в правильный медальон
        f.birth[j] = f.tick - ((rnd() * c.ringPeriod * 2.2) | 0);
      }
    }
  }

  function townHash(a, b) {
    var h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263);
    return (h ^ (h >>> 13)) >>> 0;
  }

  var MAX_COLONIES = 30;

  function sporulate(c, f, rnd, colonies) {
    if (c.brood <= 0 || colonies.length >= MAX_COLONIES) return;
    c.brood = 0;                       // сама больше не сеет, потомки — могут

    var kids = 1 + ((rnd() * 3) | 0);
    for (var k = 0; k < kids; k++) {
      if (colonies.length >= MAX_COLONIES) return;
      if (rnd() > 0.85) continue;

      // дочерний очаг садится на границе материнской территории
      var x = 0, y = 0, j = -1;
      var base = Math.sqrt(c.cells / Math.PI);
      for (var t = 0; t < 14; t++) {
        var ang = rnd() * TAU;
        var rad = base * (0.9 + rnd() * 1.4) * (c.a.broodSpread || 1);
        x = Math.round(c.x + Math.cos(ang) * rad);
        y = Math.round(c.y + Math.sin(ang) * rad);
        if (x < 2 || y < 2 || x >= f.W - 2 || y >= f.H - 2) continue;
        var q = y * f.W + x;
        if (f.mask[q] && !f.owner[q]) { j = q; break; }
      }
      if (j < 0) continue;

      // тот же штамм, но мельче и позже — изредка мутирует в соседний вид
      // Дочерний очаг — того же штамма. Иначе выбранный вид растворялся
      // в случайных, и смысл выбирать штамм пропадал.
      var kid = makeColony(colonies.length + 1, x, y,
                           rnd, f.seedBase | 0, c.archetype, c.sc);
      kid.id = nextFreeId(colonies);
      kid.maxCells = Math.round(c.maxCells * (0.5 + rnd() * 0.75));
      kid.delay = f.tick + Math.round(rnd() * 260);
      kid.brood = 1;
      inoculate(kid, f, rnd);
      colonies.push(kid);
    }
  }

  function nextFreeId(colonies) {
    var m = 0;
    for (var i = 0; i < colonies.length; i++) if (colonies[i].id > m) m = colonies[i].id;
    return m + 1;
  }

  function anyAlive(colonies) {
    for (var i = 0; i < colonies.length; i++) if (colonies[i].alive) return true;
    return false;
  }

  return {
    ARCH: ARCH,
    latin: function (n) { return ARCH[n] ? ARCH[n].latin : n; },
    desc: function (n) { return ARCH[n] ? ARCH[n].desc : ''; },
    makeColony: makeColony,
    inoculate: inoculate,
    tick: tick,
    anyAlive: anyAlive,
    names: function () { return WEIGHTS.map(function (w) { return w[0]; }); }
  };
})();
