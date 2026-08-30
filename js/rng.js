// Детерминированный ГСЧ + шум. Всё под глобальным PM, чтобы работало с file://
var PM = PM || {};

PM.rng = (function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // 2D value-noise на целочисленном хеше — без таблиц перестановок
  function ihash(x, y, seed) {
    var h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  function value2d(x, y, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = smooth(x - xi), yf = smooth(y - yi);
    var a = ihash(xi, yi, seed), b = ihash(xi + 1, yi, seed);
    var c = ihash(xi, yi + 1, seed), d = ihash(xi + 1, yi + 1, seed);
    return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf;
  }

  // fBm: сумма октав, результат в 0..1
  function fbm(x, y, seed, octaves, lacunarity, gain) {
    octaves = octaves || 3;
    lacunarity = lacunarity || 2.0;
    gain = gain || 0.5;
    var sum = 0, amp = 1, norm = 0, f = 1;
    for (var i = 0; i < octaves; i++) {
      sum += amp * value2d(x * f, y * f, seed + i * 7919);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }

  // Доменное искажение: сдвигаем координаты другим шумом. Самый дешёвый способ
  // увести любой регулярный узор от машинной ровности — прямая линия становится
  // блуждающей, окружность перестаёт быть циркульной.
  function warp(x, y, seed, amp, scale) {
    var wx = fbm(x / scale, y / scale, seed, 2) - 0.5;
    var wy = fbm(x / scale + 31.7, y / scale - 17.3, seed + 4093, 2) - 0.5;
    return [x + wx * amp, y + wy * amp];
  }

  // Мягкий порог вместо ступеньки: край узора перестаёт быть бритвенным.
  function smoothstep(a, b, t) {
    if (b === a) return t < a ? 0 : 1;
    var u = (t - a) / (b - a);
    if (u < 0) u = 0; else if (u > 1) u = 1;
    return u * u * (3 - 2 * u);
  }

  return { mulberry32: mulberry32, hashSeed: hashSeed, fbm: fbm, value2d: value2d,
           warp: warp, smoothstep: smoothstep };
})();
