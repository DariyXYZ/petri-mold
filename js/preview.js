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
  //
  // Симуляция гоняется один раз на штамм (base), варианты с кольцом —
  // копия буфера плюс кольцо. Раньше каждый вариант растил колонию заново,
  // и первое наведение подвисало на сотню миллисекунд.
  var RING = [0, 128, 235];
  var base = {};
  var RR = SIZE * 0.5 - 1.5;         // радиус агара; кольцо ложится на его край
  function build(name, lit) {
    lit = lit | 0;
    var key = name + '/' + lit;
    if (cache[key]) return cache[key];
    var S = SIZE;
    if (!base[name]) base[name] = grow(name);
    var lum = new Float32Array(base[name]);
    if (lit) ring(lum, S, S / 2, S / 2, RR - 0.4, 1.5, RING[lit]);
    cache[key] = toCanvas(lum, S);
    return cache[key];
  }

  function grow(name) {
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
    var cx = S / 2, cy = S / 2, rr = RR;
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        lum[y * S + x] = (dx * dx + dy * dy) <= rr * rr ? 54 : 0;
      }
    }
    PM.scene.overlay(lum, f, [c]);
    return lum;
  }

  // Буфер яркости → холст. Фон (яркость 0) прозрачный: у плитки нет чёрной
  // подложки, чашка лежит прямо на панели.
  function toCanvas(lum, S) {
    var cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(S, S);
    PM.render.blit(lum, S, S, img);
    for (var i = 0; i < S * S; i++) if (lum[i] <= 1) img.data[i * 4 + 3] = 0;
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // Кольцо подсветки вокруг чашки. Профиль треугольный с мягкими склонами:
  // дизер раскладывает полутона в россыпь пикселей, и кольцо читается
  // размытым, а не ступенчатым.
  function ring(lum, S, cx, cy, rc, w, v) {
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        var t = 1 - Math.abs(Math.sqrt(dx * dx + dy * dy) - rc) / w;
        if (t <= 0) continue;
        var i = y * S + x;
        lum[i] = lum[i] + (v - lum[i]) * t;
      }
    }
  }

  // Плитка «случайный штамм»: не шрифтовой знак, а маленький «?», выросший
  // как пятно плесени. Глиф рисуется мелко и растягивается со сглаживанием —
  // это и есть размытие без ctx.filter; дальше край слегка искривляется шумом
  // и всё уходит в тот же дизер, что у чашки. Размер тот же, что был у знака.
  var RS = 88;
  var qBase = null, qHalo = null;
  function random(lit) {
    lit = lit | 0;
    var key = '?/' + lit;
    if (cache[key]) return cache[key];
    var S = RS;
    if (!qBase) glyph();
    var lum = new Float32Array(qBase);
    if (lit) {
      // окантовка как у чашек: серая при наведении, белая при выборе
      var v = RING[lit];
      for (var i = 0; i < S * S; i++) {
        if (qHalo[i] > 0) lum[i] = Math.max(lum[i], v * qHalo[i]);
      }
    }
    cache[key] = toCanvas(lum, S);
    return cache[key];
  }

  // Знак как пятно плесени: размытый глиф, фестончатый край (крупная волна
  // даёт лопасти, мелкая — зазубрины), бархат внутри, темнее к середине,
  // без крапа. Отдельно — маска окантовки: полоса мицелия сразу за краем,
  // рваная на волокна и с редкими нитями наружу; сама по себе не рисуется,
  // её зажигает наведение или выбор.
  function glyph() {
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

    // Второе, вдвое более размытое поле — для ореола: у обычного размытие
    // кончается в четырёх пикселях от края, а ореолу нужно расти дальше.
    var tiny = document.createElement('canvas');
    tiny.width = tiny.height = SM / 2;
    var tx = tiny.getContext('2d');
    tx.imageSmoothingEnabled = true; tx.imageSmoothingQuality = 'high';
    tx.drawImage(small, 0, 0, SM / 2, SM / 2);
    bx.clearRect(0, 0, S, S);
    bx.drawImage(tiny, 0, 0, S, S);
    var px2 = bx.getImageData(0, 0, S, S).data;

    qBase = new Float32Array(S * S);
    qHalo = new Float32Array(S * S);
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var i = y * S + x;
        var g = px[i * 4] / 255;                         // размытый глиф: 1 внутри
        var g2 = px2[i * 4] / 255;                       // то же, шире размытое
        if (g2 <= 0.003) continue;
        var m = PM.rng.fbm(x / 9, y / 9, 777, 2);        // лопасти
        var n = PM.rng.fbm(x / 2.6, y / 2.6, 313, 2);    // зазубрины
        var e = g + (m - 0.5) * 0.36 + (n - 0.5) * 0.14; // искажённое расстояние
        var body = ss(0.36, 0.6, e);
        var core = ss(0.75, 1.0, g);
        qBase[i] = body * (128 * (0.92 + 0.16 * m) - 40 * core * (0.6 + 0.4 * m));

        // Ореол: широкая плавная полоса мицелия за краем, белая у тела и
        // сходящая на нет вдали. Волнуется только крупным шумом — без
        // зазубрин, чтобы читалась мягко.
        var e2 = g2 + (m - 0.5) * 0.16;
        var halo = ss(0.02, 0.3, e2) * (1 - body);
        qHalo[i] = Math.min(1, halo * (0.85 + 0.15 * m));
      }
    }
  }

  return { build: build, random: random, SIZE: SIZE };
})();
