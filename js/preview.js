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
  // Образец — только плесень, без чашки: фон прозрачный, выбор обозначает
  // плитка (уголки и подпись), не картинка. lit сохранён для совместимости.
  var base = {};
  var RR = SIZE * 0.5 - 1.5;         // радиус поля, где растёт образец
  function build(name, lit) {
    if (cache[name]) return cache[name];
    var S = SIZE;
    if (!base[name]) base[name] = grow(name);
    cache[name] = toCanvas(base[name], S);
    return cache[name];
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

    // Под колонией — тот же агар, что в чашке (54), но только там, где она
    // выросла: снаружи ноль, и toCanvas делает это прозрачным. Так кромка
    // сходит на нет в фон, как в чашке, а самой чашки нет.
    var lum = new Float32Array(S * S);
    var cx = S / 2, cy = S / 2, rr = RR;
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        lum[y * S + x] = (dx * dx + dy * dy) <= rr * rr ? 54 : 0;
      }
    }
    PM.scene.overlay(lum, f, [c]);
    for (var i = 0; i < S * S; i++) {
      if (!f.owner[i] && !f.film[i]) lum[i] = 0;
    }
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

  // Знак «?» для плитки «случайно»: чистый, без плесени — растровый глиф
  // с жёстким краем, в три яркости: покой, наведение, выбор.
  var RS = 88;
  var TONE = [140, 179, 230];
  var qMask = null;
  function random(lit) {
    lit = lit | 0;
    var key = '?/' + lit;
    if (cache[key]) return cache[key];
    var S = RS;
    if (!qMask) glyph();
    var lum = new Float32Array(S * S);
    for (var i = 0; i < S * S; i++) if (qMask[i]) lum[i] = TONE[lit];
    cache[key] = toCanvas(lum, S);
    return cache[key];
  }

  function glyph() {
    var S = RS;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#fff';
    // Глиф центрируется по фактической рамке, а не по базовой линии: у «?»
    // крюк тяжелее точки, «middle» сажает его вкривь.
    g.font = 'bold 79px Georgia, "Times New Roman", serif';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    var mt = g.measureText('?');
    var gw = (mt.actualBoundingBoxLeft || 0) + (mt.actualBoundingBoxRight || mt.width);
    var asc = mt.actualBoundingBoxAscent || 54, desc = mt.actualBoundingBoxDescent || 0;
    g.fillText('?', (S - gw) / 2 + (mt.actualBoundingBoxLeft || 0),
               (S - asc - desc) / 2 + asc);
    var px = g.getImageData(0, 0, S, S).data;
    qMask = new Uint8Array(S * S);
    for (var i = 0; i < S * S; i++) qMask[i] = px[i * 4] >= 128 ? 1 : 0;
  }

  return { build: build, random: random, SIZE: SIZE };
})();
