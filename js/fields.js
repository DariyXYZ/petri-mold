var PM = PM || {};

// Поля симуляции. Всё в типизированных массивах W*H, маскируется кругом агара.
PM.fields = (function () {

  function create(W, H, seed, geo) {
    var n = W * H;
    var scale = W / 192;
    var f = {
      W: W, H: H, n: n, scale: scale,
      mask: PM.dish.agarMask(W, H, geo),   // 1 = внутри агара
      owner: new Uint8Array(n),            // 0 = пусто, иначе id колонии
      birth: new Uint16Array(n),           // тик заселения
      density: new Uint8Array(n),          // 0..255 плотность биомассы
      film: new Uint8Array(n),             // полупрозрачная плёнка, поверх owner
      nutrient: new Float32Array(n),
      inhibitor: new Float32Array(n),
      tmp: new Float32Array(n),
      // кэш текстуры: узор в клетке не меняется, считаем его один раз
      texBuf: new Float32Array(n),
      mottBuf: new Float32Array(n),
      cavBuf: new Float32Array(n),
      texSet: new Uint8Array(n),
      tick: 0
    };

    // питание: неровное поле, чтобы рост не был идеально круглым
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        if (!f.mask[i]) { f.nutrient[i] = 0; continue; }
        var v = PM.rng.fbm(x / (22 * scale), y / (22 * scale), seed + 4441, 3);
        // контраст поля еды выше — колонии тянутся к пятнам и растут неровно
        f.nutrient[i] = 0.42 + 0.58 * v;
      }
    }
    return f;
  }

  // Дешёвая диффузия по 4 соседям с испарением. Гоняем раз в несколько тиков.
  function diffuse(src, f, rate, decay) {
    var W = f.W, H = f.H, mask = f.mask, tmp = f.tmp;
    for (var y = 1; y < H - 1; y++) {
      var row = y * W;
      for (var x = 1; x < W - 1; x++) {
        var i = row + x;
        if (!mask[i]) { tmp[i] = 0; continue; }
        var s = src[i];
        var acc = src[i - 1] + src[i + 1] + src[i - W] + src[i + W];
        tmp[i] = (s + rate * (acc * 0.25 - s)) * decay;
      }
    }
    src.set(tmp);
  }

  return { create: create, diffuse: diffuse };
})();
