var PM = PM || {};

// Превью штаммов для палитры кистей. Каждый квадратик — не рисунок, а честный
// прогон той же симуляции на маленьком поле, поэтому он показывает ровно то,
// что вырастет в чашке.
PM.preview = (function () {
  var SIZE = 64;
  var TICKS = 1100;
  var cache = {};

  function build(name) {
    if (cache[name]) return cache[name];

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
    var cx = S / 2, cy = S / 2, rr = S * 0.5 - 1;
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        lum[y * S + x] = (dx * dx + dy * dy) <= rr * rr ? 54 : 0;
      }
    }
    PM.scene.overlay(lum, f, [c]);

    var cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(S, S);
    PM.render.blit(lum, S, S, img);
    ctx.putImageData(img, 0, 0);

    cache[name] = cv;
    return cv;
  }

  // Плитка «случайный штамм»: не шрифтовой знак, а маленький «?», выросший
  // как пятно плесени. Глиф рисуется мелко и растягивается со сглаживанием —
  // это и есть размытие без ctx.filter; дальше край слегка искривляется шумом
  // и всё уходит в тот же дизер, что у чашки. Размер тот же, что был у знака.
  var RS = 88;
  function random() {
    if (cache['?']) return cache['?'];
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

    var lum = new Float32Array(S * S);
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var i = y * S + x;
        var g = px[i * 4] / 255;                       // размытый глиф 0..1
        if (g <= 0.01) continue;
        // Внутри ровно, без крапа: только слегка неровный край, как у пятна
        // плесени, и чуть неравномерная яркость. Остальную фактуру даёт дизер.
        var m = PM.rng.fbm(x / 4, y / 4, 777, 2);
        var body = ss(0.32, 0.72, g + (m - 0.5) * 0.14);
        lum[i] = body * 122 * (0.92 + 0.16 * m);
      }
    }

    var cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(S, S);
    PM.render.blit(lum, S, S, img);
    ctx.putImageData(img, 0, 0);

    cache['?'] = cv;
    return cv;
  }

  return { build: build, random: random, SIZE: SIZE };
})();
