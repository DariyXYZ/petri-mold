var PM = PM || {};

// Выжигание чашки. BURN не стирает картинку разом: по агару снизу вверх идёт
// кромка огня, плесень за ней выгорает, сажа потом выветривается до чистого
// агара.
//
// Пламя — не жидкость. Решатель Навье-Стокса (перенос + проекция) честно
// даёт клубы и «грибы», но клубы это ДЫМ: масса, которая растёт во все
// стороны. Нужен тихий угловатый гребень, у которого есть силуэт, поэтому
// модель другая — поле высоты:
//
//   1. Профиль высоты по столбцам, H(x). Складывается из ridged-шума:
//        R = (1 - |2n - 1|) ^ sharp
//      У обычного fbm вершины круглые, а ridged даёт складку с изломом —
//      именно она читается как язык пламени. Две частоты: длинная ставит
//      языки, короткая рвёт их на зубцы.
//
//   2. Пиксель на высоте d над кромкой лежит внутри пламени, если
//        m = H(x - lean*d) - d  >  0
//      Язык сам сужается к вершине: чем выше d, тем меньше столбцов
//      удовлетворяет H > d. Отсюда треугольная форма, которой не давал
//      ни столбик-занавес, ни клуб.
//
//   3. lean — сдвиг с высотой, свой у каждого языка. Пламя чуть заваливает,
//      но не уносит: гребень остаётся гребнем.
//
//   4. Светится СИЛУЭТ, а не тело языка, и тем ярче, чем выше. Заливка от
//      кромки до вершины превращает гребень в белую плиту, а цоколь у самой
//      кромки — в ровную белую обводку. Поэтому яркость гасится и вниз
//      (в толщу языка), и по высоте (к подножию), а к кончику наоборот
//      выбивается в белый. Вдобавок крупа по силуэту: единый уровень по
//      всему краю читается обводкой, а не горящей кромкой.
PM.burn = (function () {
  var f = null, W = 0, H = 0, sc = 1, seed = 0;
  var front = null, hProf = null, shProf = null, moldCol = null;
  var soot = null, lit = null;
  var active = false, done = null, after = 0, t = 0;
  var baseFront = 0, topY = 0, botY = 0, minFront = 0;

  // Все длины — в пикселях 192-масштаба, внутри домножаются на sc.
  var P = {
    speed: 0.85,      // ход средней линии кромки за кадр
    wob: 3.0,         // волнистость самой кромки
    hBase: 2.5,       // высота языка в провалах
    hMain: 27.0,      // высота основных языков
    hTeeth: 4.5,      // мелкая рябь поверх
    // Плесень МНОЖИТ высоту языка, а не поднимает ленту полкой. Слагаемым
    // она задирала всю кромку разом, и вместо гребня выходила ровная плита.
    hMoldMul: 0.35,
    // Масштаб волн. Короткий шаг с сильным заострением давал частокол
    // мелких игл; широкий шаг и мягкая складка — редкие покатые языки.
    lMain: 22.0,      // шаг основных языков
    lTeeth: 6.0,      // шаг рябы
    lLean: 34.0,      // шаг завала: длиннее шага языков, чтобы соседние
                      // валило в разные стороны, но силуэт не размывало
    sharp: 1.70,      // заострение основной складки
    sharpT: 2.40,     // заострение рябы
    lean: 0.30,       // сила завала на пиксель высоты
    // Сдвиг обязан быть МЕНЬШЕ шага языков. Если он их перекрывает, выборка
    // профиля на большой высоте попадает в соседний язык, промежутки
    // заполняются и вместо гребня выходит плита с зубцами.
    leanMax: 9.0,
    warp: 2.4,        // доменный варп силуэта: язык гуляет, а не едет по столбцу
    teeth: 2.0,       // рванина силуэта
    edge: 1.8,        // мягкость края, чтобы дизер его разбил
    glow: 11.0,       // толщина свечения ВНИЗ от силуэта
    // Гашение двойное, и оба множителя нужны. По доле высоты СВОЕГО языка
    // (rel) — иначе низкие языки пропадают целиком и гребень рассыпается на
    // клочки. По абсолютной высоте (abs) — иначе кончик есть у каждого
    // языка, кромка светит ровно по всей длине и читается обводкой.
    relLo: 0.12, relHi: 0.65,
    absLo: 5.0, absHi: 32.0,
    liftFloor: 0.20,  // сколько остаётся у самого подножия
    grit: 0.60,       // мелкая крупа по силуэту
    gritL: 0.90,      // и крупная: гасит кромку целыми участками
    halo: 4.2,        // дымка над силуэтом
    tMain: 0.011,     // как быстро переставляются языки
    tTeeth: 0.045,
    tLean: 0.020,
    baseL: 120,       // уровень свечения у подножия языка
    coreL: 252,       // и на его кончике
    haloL: 46,        // дымка
    spark: 26.0,      // как далеко разлетаются искры
    sparkP: 0.030,    // плотность искр у силуэта
    sparkRise: 0.9,   // скорость их подъёма, пикселей за кадр
    sparkL: 210,      // яркость крошки
    sootBase: 0.34,   // сажа на чистом агаре
    sootMold: 0.50,   // и добавка там, где была биомасса
    sootHold: 0.9955, // пока кромка идёт, след держится
    sootFade: 0.905,  // после — выветривается
    coolFrames: 34
  };

  // --- запуск ---

  function start(fields, s, onDone) {
    f = fields; W = f.W; H = f.H; sc = f.scale || 1;
    seed = ((s | 0) ^ 0x5f37) >>> 0;

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

    front = new Float32Array(W);
    hProf = new Float32Array(W);
    shProf = new Float32Array(W);
    moldCol = new Float32Array(W);
    if (!soot || soot.length !== f.n) {
      soot = new Float32Array(f.n);
      lit = new Uint8Array(f.n);
    } else { soot.fill(0); lit.fill(0); }

    baseFront = botY + 2;
    for (var q = 0; q < W; q++) front[q] = baseFront;
    minFront = baseFront;
    t = 0; after = 0; active = true; done = onDone || null;
  }

  function reset() { active = false; done = null; f = null; }

  // Белый шум по целым координатам: искра либо есть, либо нет, сглаживать
  // тут нечего.
  function hash2(x, y, s) {
    var h = s ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // --- ridged-шум ---

  // У обычного fbm вершины круглые. Складка 1 - |2n - 1| даёт излом,
  // степень его заостряет — так получается угловатый язык.
  function ridge(x, y, s, sharp) {
    var n = PM.rng.fbm(x, y, s, 2);
    var r = 1 - Math.abs(2 * n - 1);
    return Math.pow(r < 0 ? 0 : r, sharp);
  }

  // --- шаг ---

  function step() {
    if (!active) return;
    t++;

    var burning = baseFront >= topY - 2;
    var burnt = 0;
    var x, y, i;

    if (burning) {
      baseFront -= P.speed * sc;

      // Кромка. Зубцы задаются СМЕЩЕНИЕМ столбца, а не его скоростью:
      // модуляция скорости интегрируется и заваливает фронт по диагонали.
      for (x = 0; x < W; x++) {
        var wob = PM.rng.fbm(x / (16 * sc), t / 42, seed + 71, 2)
                + 0.5 * PM.rng.fbm(x / (5 * sc), t / 19, seed + 907, 2);
        var y0 = front[x];
        var y1 = baseFront + (wob - 0.75) * P.wob * sc;
        front[x] = y1;

        var a = Math.max(0, Math.floor(Math.min(y0, y1)));
        var b = Math.min(H - 1, Math.ceil(Math.max(y0, y1)));
        for (y = a; y <= b; y++) {
          i = y * W + x;
          if (!f.mask[i] || lit[i]) continue;
          lit[i] = 1;

          var mold = f.owner[i] ? Math.min(1, f.density[i] / 210)
                                : (f.film[i] > 40 ? 0.45 : 0);
          if (mold) burnt++;
          var ash = P.sootBase + P.sootMold * mold
                  + (PM.rng.fbm(x / (5 * sc), y / (5 * sc), seed + 213, 2) - 0.5) * 0.24;
          if (ash > 0.92) ash = 0.92; else if (ash < 0) ash = 0;
          if (ash > soot[i]) soot[i] = ash;
        }
      }
    }

    // Всё, что кромка прошла, сгорело — биомассы там больше нет.
    minFront = 1e9;
    for (x = 0; x < W; x++) {
      var fy = front[x];
      if (fy < minFront) minFront = fy;
      for (y = Math.max(0, Math.floor(fy)); y <= botY; y++) {
        i = y * W + x;
        if (!f.mask[i] || (!f.owner[i] && !f.film[i])) continue;
        f.owner[i] = 0; f.density[i] = 0; f.film[i] = 0; f.texSet[i] = 0;
      }
    }

    if (burning) updateProfile();
    else for (var k = 0; k < W; k++) hProf[k] = 0;

    // сажа: держится, пока идёт кромка, потом выветривается
    var hold = burning ? P.sootHold : P.sootFade;
    for (y = Math.max(0, Math.floor(minFront)); y <= botY; y++) {
      var row2 = y * W;
      for (x = 0; x < W; x++) {
        var s2 = soot[row2 + x];
        if (s2) soot[row2 + x] = s2 > 0.004 ? s2 * hold : 0;
      }
    }

    // треск на кадр один, панорама вразброс
    if (burnt) PM.sound.event('crackle', null, (Math.random() - 0.5) * 1.4);

    if (!burning) {
      after++;
      if (after > P.coolFrames) {
        active = false;
        var cb = done;
        done = null; f = null;
        if (cb) cb();
      }
    }
  }

  // Профиль высоты и завала на этот кадр: по два шума на столбец, а не на
  // пиксель — дальше пламя читается из профиля одной выборкой.
  function updateProfile() {
    for (var x = 0; x < W; x++) {
      // топливо прямо над кромкой: над колонией язык выше
      var m = 0, by = Math.round(front[x]);
      for (var d = 1; d <= 6; d++) {
        var yy = by - d;
        if (yy < 0) break;
        var i = yy * W + x;
        if (!f.mask[i]) continue;
        if (f.owner[i]) m += Math.min(1, f.density[i] / 210);
        else if (f.film[i] > 40) m += 0.45;
      }
      moldCol[x] = moldCol[x] * 0.82 + (m / 6) * 0.18;   // без рывков по кадрам

      var tongue = P.hMain * ridge(x / (P.lMain * sc), t * P.tMain,
                                   seed + 31, P.sharp)
                 + P.hTeeth * ridge(x / (P.lTeeth * sc), t * P.tTeeth,
                                    seed + 907, P.sharpT);
      hProf[x] = (P.hBase + tongue * (1 + P.hMoldMul * moldCol[x])) * sc;

      shProf[x] = (PM.rng.fbm(x / (P.lLean * sc), t * P.tLean, seed + 55, 2) - 0.5) * 2;
    }
  }

  function profAt(xs) {
    if (xs <= 0) return hProf[0];
    if (xs >= W - 1) return hProf[W - 1];
    var i = xs | 0, fr = xs - i;
    return hProf[i] + (hProf[i + 1] - hProf[i]) * fr;
  }

  // --- отрисовка поверх готового кадра ---

  function paint(lum) {
    if (!active || !f) return;

    // 1. выжженный след
    for (var y = Math.max(0, Math.floor(minFront)); y <= botY; y++) {
      var row = y * W;
      for (var x = 0; x < W; x++) {
        var s = soot[row + x];
        if (s > 0.004) lum[row + x] = lum[row + x] * (1 - s) + 4 * s;
      }
    }

    // 2. пламя по столбцам
    var ss = PM.rng.smoothstep;
    var edgeW = P.edge * sc, glowW = P.glow * sc, haloW = P.halo * sc;
    var absLo = P.absLo * sc, absHi = P.absHi * sc;
    var teeth = P.teeth * sc, lean = P.lean, ns = 2.4 * sc;
    var warpA = P.warp * sc, sparkW = P.spark * sc, leanMax = P.leanMax * sc;
    var rise = (t * P.sparkRise) | 0;

    for (var cx = 0; cx < W; cx++) {
      var hx = hProf[cx];
      if (hx <= 0) continue;
      var by = Math.round(front[cx]);
      var sh = shProf[cx];
      // выше силуэта надо пройти ещё и вынос искр, иначе они обрезаются
      var dMax = Math.ceil(hx + sparkW) + 2;

      for (var d = 0; d <= dMax; d++) {
        var yy = by - d;
        if (yy < topY) break;
        var i = yy * W + cx;
        if (!f.mask[i]) continue;

        // Завал плюс доменный варп: язык не едет ровно по столбцу, а
        // гуляет. Без варпа гребень выходит расчёсанным в одну сторону.
        var wp = (PM.rng.fbm(cx / (4 * sc), yy / (7 * sc) - t * 0.14,
                             seed + 431, 2) - 0.5) * warpA;
        var shift = lean * sh * d;
        if (shift > leanMax) shift = leanMax;
        else if (shift < -leanMax) shift = -leanMax;
        var hs = profAt(cx - shift + wp);
        var m = hs - d;
        // рванина силуэта: без неё край выходит выглаженной кривой
        m += (PM.rng.value2d(cx / ns, yy / ns - t * 0.5, seed + 77) - 0.5) * teeth;
        if (m <= -sparkW) continue;

        var l = lum[i];

        // Доля высоты своего языка: 0 у кромки, 1 на кончике. Пламя гаснет
        // и к подножию языка, и к низу кадра — белой полосы внизу быть
        // не должно, а низкие языки должны быть тусклее высоких.
        var rel = hs > 1 ? d / hs : 1;
        if (rel > 1) rel = 1;
        var lift = P.liftFloor + (1 - P.liftFloor)
                 * ss(P.relLo, P.relHi, rel) * ss(absLo, absHi, d);

        if (m > 0) {
          // Свечение живёт у СИЛУЭТА и гаснет вниз, в толщу языка.
          var edge = ss(0, edgeW, m) * (1 - ss(edgeW, glowW, m));
          if (edge > 0.004) {
            // Кончик белый, подножие серое. Один уровень по всему силуэту
            // читается ровной обводкой, а не горящим краем; крупа его рвёт.
            var grit = (1 - P.grit * 0.5
                     + P.grit * PM.rng.fbm(cx / (5 * sc), yy / (5 * sc) - t * 0.4,
                                           seed + 601, 2))
                     * (1 - P.gritL * 0.5
                     + P.gritL * PM.rng.fbm(cx / (24 * sc), t * 0.05,
                                            seed + 1301, 2));
            var k = edge * lift * grit;
            if (k > 1) k = 1;
            var level = P.baseL + (P.coreL - P.baseL) * ss(0.35, 0.95, rel);
            l = l * (1 - k) + level * k;
          }
        } else if (m > -haloW) {
          l += P.haloL * (1 + m / haloW) * lift;
        }

        // Искры. Хеш сдвигается по времени, поэтому крошки летят вверх, а не
        // мигают на месте. Плотность падает к выносу квадратом.
        if (m < 0) {
          var up = -m / sparkW;
          var fall = 1 - up; fall *= fall;
          var hh = hash2(cx, yy + rise, seed + 991);
          if (hh > 1 - P.sparkP * fall) {
            var lv = P.sparkL * (0.55 + 0.45 * hash2(cx + 7, yy - rise, seed + 13));
            if (lv > l) l = lv;
          }
        }
        if (l === lum[i]) continue;
        lum[i] = l > 255 ? 255 : l;
      }
    }
  }

  return {
    P: P,
    start: start,
    step: step,
    paint: paint,
    reset: reset,
    isActive: function () { return active; }
  };
})();
