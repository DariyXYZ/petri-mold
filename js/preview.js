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

  return { build: build, SIZE: SIZE };
})();
