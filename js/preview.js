var PM = PM || {};

// Превью штаммов для палитры кистей. Каждый квадратик — не рисунок, а честный
// прогон той же симуляции на маленьком поле, поэтому он показывает ровно то,
// что вырастет в чашке.
PM.preview = (function () {
  var SIZE = 64;
  var TICKS = 1100;
  var cache = {};

  // lit: 0 — покой, 1 — наведение (серое кольцо), 2 — выбран (белое кольцо).
  // Кольцо рисуется в том же буфере и идёт через тот же дизер, а не
  // CSS-обводкой поверх — чашка «загорается» сама.
  var RING = [0, 128, 235];
  function build(name, lit) {
    lit = lit | 0;
    var key = name + '/' + lit;
    if (cache[key]) return cache[key];

    var S = SIZE;
    var f = PM.fields.create(S, S, 20260831, PM.dish.GEO);
    f.scale = 1;                      // текстуры в «родном» масштабе, не в масштабе чашки
    f.seedBase = 20260831;

    var rnd = PM.rng.mulberry32(PM.rng.hashSeed(name));
    var c = PM.growth.makeColony(1, S / 2, S / 2, rnd, 20260831, name, 1);
    c.delay = 0;
    c.greed = 1.15;
    c.maxCells = Math.round(Math.PI * 25 * 25 * 0.62);
    c.brood = 0;                      // в превью дочерних очагов не надо
    c.wDrift = 0;                     // и сноса тоже — образец должен быть по центру
    PM.growth.inoculate(c, f, rnd);

    for (var t = 0; t < TICKS; t++) PM.growth.tick(f, [c], rnd, 8);

    var lum = new Float32Array(S * S);
    var cx = S / 2, cy = S / 2, rr = S * 0.5 - 3;   // запас под кольцо подсветки
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        lum[y * S + x] = (dx * dx + dy * dy) <= rr * rr ? 54 : 0;
      }
    }
    PM.scene.overlay(lum, f, [c]);
    if (lit) ring(lum, S, cx, cy, rr + 1.2, rr + 2.6, RING[lit]);

    var cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(S, S);
    PM.render.blit(lum, S, S, img);
    ctx.putImageData(img, 0, 0);

    cache[key] = cv;
    return cv;
  }

  // Кольцо подсветки: пиксель буфера в белый, чашка «загорается» по контуру.
  function ring(lum, S, cx, cy, r0, r1, v) {
    var a = r0 * r0, b = r1 * r1;
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy, d2 = dx * dx + dy * dy;
        if (d2 >= a && d2 < b) lum[y * S + x] = v;
      }
    }
  }

  // Плитка «случайный штамм»: не шрифтовой знак, а маленький «?», выросший
  // как пятно плесени. Глиф рисуется мелко и растягивается со сглаживанием —
  // это и есть размытие без ctx.filter; дальше край слегка искривляется шумом
  // и всё уходит в тот же дизер, что у чашки. Размер тот же, что был у знака.
  var RS = 88;
  function random(lit) {
    lit = lit | 0;
    var key = '?/' + lit;
    if (cache[key]) return cache[key];
    var S = RS, ss = PM.rng.smoothstep;

    var small = document.createElement('canvas');
    // Глиф центрируется по фактической рамке, а не по базовой линии: у «?»
    // крюк тяжелее точки, «middle» сажает его вкривь.
    var SM = 22;
    small.width = small.height = SM;
    var sx = small.getContext('2d');
    sx.fillStyle = '#000'; sx.fillRect(0, 0, SM, SM);
    sx.fillStyle = '#fff';
    sx.font = 'bold 22px Georgia, "Times New Roman", serif';
    sx.textAlign = 'left'; sx.textBaseline = 'alphabetic';
    var mt = sx.measureText('?');
    var gw = (mt.actualBoundingBoxLeft || 0) + (mt.actualBoundingBoxRight || mt.width);
    var asc = mt.actualBoundingBoxAscent || 15, desc = mt.actualBoundingBoxDescent || 0;
    sx.fillText('?', (SM - gw) / 2 + (mt.actualBoundingBoxLeft || 0),
                (SM - asc - desc) / 2 + asc);

    var big = document.createElement('canvas');
    big.width = big.height = S;
    var bx = big.getContext('2d', { willReadFrequently: true });
    bx.imageSmoothingEnabled = true;
    bx.imageSmoothingQuality = 'high';
    bx.drawImage(small, 0, 0, S, S);
    var px = bx.getImageData(0, 0, S, S).data;

    // Пятно как базовая колония: бархатное тело, светлая кайма стерильного
    // мицелия по краю, темнее к середине, снаружи чуть пуха. Размытый глиф
    // g заодно служит расстоянием до края: 1 в глубине, ~0.5 на контуре.
    var lum = new Float32Array(S * S);
    var gain = [1, 1.2, 1.5][lit];       // покой / наведение / выбран
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var i = y * S + x;
        var g = px[i * 4] / 255;
        if (g <= 0.01) continue;
        var m = PM.rng.fbm(x / 7, y / 7, 777, 2);
        var body = ss(0.32, 0.72, g + (m - 0.5) * 0.14);
        var rim = ss(0.36, 0.62, g) * (1 - ss(0.62, 0.95, g));   // кайма
        var core = ss(0.72, 1.0, g);                            // споровый центр
        var fur = ss(0.14, 0.34, g) * (1 - body);              // пух снаружи
        var l = body * (100 * (0.9 + 0.2 * m) + 95 * rim - 42 * core * (0.6 + 0.4 * m))
              + fur * 55 * m;
        lum[i] = l * gain;
      }
    }

    var cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(S, S);
    PM.render.blit(lum, S, S, img);
    ctx.putImageData(img, 0, 0);

    cache[key] = cv;
    return cv;
  }

  return { build: build, random: random, SIZE: SIZE };
})();
