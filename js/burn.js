var PM = PM || {};

// Выжигание использует исходный GIF kostyor-19 напрямую. Мы не имитируем форму
// пламени: браузер проигрывает все его кадры, а затем существующий render.js
// квантует наложение в палитру игры и добавляет дизер.
PM.burn = (function () {
  var f = null, W = 0, H = 0, seed = 0;
  var soot = null, burned = null, burnAt = null;
  var active = false, done = null, t = 0;
  var topY = 0, botY = 0, leftX = 0, rightX = 0, sweepX = 0;
  var fireImage = null, fireCanvas = null, fireCtx = null, firePixels = null;
  var cachedImage = null, fireReady = false;

  var TOTAL_FRAMES = 180; // 3 секунды при 60 fps
  var IGNITE_END = 34;
  var TRAVEL_END = 150;
  // GIF намеренно растянут по вертикали: факел входит снизу и проходит через
  // почти всю чашку, как в референсном композе, а не мелькает у её края.
  var SPRITE_W = 110, SPRITE_H = 290;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(v) { return v * v * (3 - 2 * v); }

  function hash(x, y, s) {
    var h = s ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function makeSprite() {
    // Новый Image на каждый BURN перезапускает зацикленный GIF с первого кадра.
    // URL не получает cache-buster: ранее из-за него GIF снова скачивался уже
    // после BURN, и весь трёхсекундный эффект мог закончиться до первого кадра.
    fireImage = new Image();
    fireReady = false;
    fireImage.onload = function () { fireReady = true; };
    fireImage.src = 'assets/kostyor-19.gif';
    if (fireImage.complete && fireImage.naturalWidth) fireReady = true;
    fireCanvas = document.createElement('canvas');
    fireCanvas.width = SPRITE_W; fireCanvas.height = SPRITE_H;
    fireCtx = fireCanvas.getContext('2d', { willReadFrequently: true });
    fireCtx.imageSmoothingEnabled = false;
    firePixels = null;
  }

  function start(fields, cultureSeed, onDone) {
    f = fields; W = f.W; H = f.H; seed = ((cultureSeed | 0) ^ 0x5f37) >>> 0;
    soot = new Float32Array(f.n);
    burned = new Uint8Array(f.n);
    burnAt = new Float32Array(f.n);
    topY = H; botY = 0; leftX = W; rightX = 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0, row = y * W; x < W; x++) {
        if (!f.mask[row + x]) continue;
        if (y < topY) topY = y;
        if (y > botY) botY = y;
        if (x < leftX) leftX = x;
        if (x > rightX) rightX = x;
      }
    }
    // У каждого пикселя свой момент выгорания. Поле зафиксировано на время
    // одного BURN, поэтому чёрный след не дрожит, но его граница распадается
    // на мягкие шумные языки вместо прямой вертикальной линии.
    for (var yy = topY; yy <= botY; yy++) {
      for (var xx = leftX; xx <= rightX; xx++) {
        var pi = yy * W + xx;
        if (!f.mask[pi]) continue;
        var coarse = PM.rng.fbm(xx / 19, yy / 27, seed + 1709, 3) - 0.5;
        var fine = PM.rng.fbm(xx / 6, yy / 8, seed + 3011, 2) - 0.5;
        burnAt[pi] = xx + coarse * 44 + fine * 12;
      }
    }
    sweepX = leftX - SPRITE_W * 0.35;
    t = 0; active = true; done = onDone || null;
    makeSprite();
  }

  function reset() {
    active = false; done = null; f = null;
    soot = burned = burnAt = fireImage = fireCanvas = fireCtx = firePixels = null;
    fireReady = false;
  }

  function clearBehindFlame() {
    // Точка очистки спрятана внутри факела: перед ней биомасса нетронута,
    // сразу за ней — угольный отпечаток. burnAt добавляет размытый шумный край.
    var cut = sweepX - SPRITE_W * 0.08;
    for (var y = topY; y <= botY; y++) {
      for (var x = leftX; x <= rightX; x++) {
        var i = y * W + x;
        if (burned[i] || burnAt[i] > cut) continue;
        if (!f.mask[i]) continue;
        burned[i] = 1;
        var mold = f.owner[i] ? Math.min(1, f.density[i] / 210) : (f.film[i] > 40 ? 0.4 : 0);
        soot[i] = 0.22 + mold * 0.25 + (hash(x, y, seed + 213) - 0.5) * 0.22;
        if (soot[i] < 0.05) soot[i] = 0.05;
        f.owner[i] = 0; f.density[i] = 0; f.film[i] = 0; f.texSet[i] = 0;
      }
    }
  }

  function step() {
    if (!active) return;
    // Не начинаем отсчёт до готовности GIF: зритель всегда увидит вспышку,
    // даже при первом открытии страницы и холодном кеше браузера.
    if (!fireReady) return;
    t++;
    var travel = smooth(clamp((t - IGNITE_END) / (TRAVEL_END - IGNITE_END), 0, 1));
    sweepX = leftX - SPRITE_W * 0.35 + (rightX - leftX + SPRITE_W * 0.7) * travel;
    clearBehindFlame();
    if (t % 3 === 0 && t < TRAVEL_END) PM.sound.event('crackle', null, (Math.random() - 0.5) * 1.2);

    if (t >= TOTAL_FRAMES) {
      var cb = done;
      reset();
      if (cb) cb();
    }
  }

  function readGifFrame() {
    if (!fireImage || !fireImage.complete || !fireImage.naturalWidth) return false;
    fireCtx.clearRect(0, 0, SPRITE_W, SPRITE_H);
    fireCtx.drawImage(fireImage, 0, 0, SPRITE_W, SPRITE_H);
    firePixels = fireCtx.getImageData(0, 0, SPRITE_W, SPRITE_H).data;
    return true;
  }

  function paint(lum) {
    if (!active || !f) return;
    for (var i = 0; i < soot.length; i++) {
      if (soot[i]) lum[i] = lum[i] * (1 - soot[i]) + 2 * soot[i];
    }
    if (!readGifFrame()) return;

    // Вспышка приходит из нижней границы, затем факел держит полную силу и
    // последние 26 кадров плавно растворяется. Масштаб в начале добавляет
    // ощущение поджига, не обрезая сам GIF.
    var inT = smooth(clamp(t / IGNITE_END, 0, 1));
    var outT = 1 - smooth(clamp((t - TRAVEL_END) / (TOTAL_FRAMES - TRAVEL_END), 0, 1));
    var alpha = inT * outT;
    var scale = 0.12 + inT * 0.88;
    var drawW = Math.round(SPRITE_W * scale), drawH = Math.round(SPRITE_H * scale);
    var ox = Math.round(sweepX - drawW * 0.5);
    // Спрайт растёт за нижней кромкой чашки и поэтому кажется, что пламя идёт
    // из-под экрана, а не возникает внутри агаровой поверхности.
    var oy = Math.round(botY + 38 - drawH);

    for (var sy = 0; sy < SPRITE_H; sy++) {
      var dy = oy + Math.floor(sy * drawH / SPRITE_H);
      if (dy < 0 || dy >= H) continue;
      for (var sx = 0; sx < SPRITE_W; sx++) {
        var si = (sy * SPRITE_W + sx) << 2;
        var r = firePixels[si], g = firePixels[si + 1], b = firePixels[si + 2];
        // У исходного GIF чёрный фон: порог извлекает только настоящий огонь.
        var light = Math.max(r, g, b);
        if (light < 14) continue;
        var dx = ox + Math.floor(sx * drawW / SPRITE_W);
        if (dx < 0 || dx >= W) continue;
        var di = dy * W + dx;
        if (!f.mask[di]) continue;
        var k = alpha * Math.pow(light / 255, 0.72);
        var level = 44 + light * 0.83;
        lum[di] = lum[di] * (1 - k) + level * k;
      }
    }
  }

  return { start: start, step: step, paint: paint, reset: reset,
    isActive: function () { return active; },
    preload: function () {
      if (cachedImage) return;
      cachedImage = new Image();
      cachedImage.src = 'assets/kostyor-19.gif';
    } };
})();
