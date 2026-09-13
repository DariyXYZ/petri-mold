var PM = PM || {};

// The supplied GIF stays a native image so the browser advances its frames.
// Canvas code handles only the charred residue left behind the visible flame.
PM.burn = (function () {
  var f = null, W = 0, H = 0, seed = 0;
  var soot = null, burned = null, burnAt = null;
  var active = false, done = null, t = 0, lastStepAt = 0;
  var topY = 0, botY = 0, leftX = 0, rightX = 0, sweepX = 0;
  var fire = null, cachedImage = null;
  var TOTAL_FRAMES = 240, RECOVER_START = 198;
  var SPRITE_W = 366, SPRITE_H = 391;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(v) { return v * v * (3 - 2 * v); }
  function hash(x, y, s) {
    var h = s ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function flameElement() {
    if (!fire) fire = document.getElementById('burn-gif');
    return fire;
  }
  function restartGif() {
    var el = flameElement();
    if (!el) return;
    el.style.display = 'none';
    el.removeAttribute('src');
    requestAnimationFrame(function () {
      el.src = 'assets/kostyor-19.gif';
      el.style.display = 'block';
    });
  }
  function start(fields, cultureSeed, onDone) {
    f = fields; W = f.W; H = f.H; seed = ((cultureSeed | 0) ^ 0x5f37) >>> 0;
    soot = new Float32Array(f.n); burned = new Uint8Array(f.n); burnAt = new Float32Array(f.n);
    topY = H; botY = 0; leftX = W; rightX = 0;
    for (var y = 0; y < H; y++) for (var x = 0, row = y * W; x < W; x++) {
      if (!f.mask[row + x]) continue;
      if (y < topY) topY = y;
      if (y > botY) botY = y;
      if (x < leftX) leftX = x;
      if (x > rightX) rightX = x;
    }
    for (var yy = topY; yy <= botY; yy++) for (var xx = leftX; xx <= rightX; xx++) {
      var pi = yy * W + xx;
      if (!f.mask[pi]) continue;
      var broad = PM.rng.fbm(xx / 24, yy / 31, seed + 1709, 3) - 0.5;
      var detail = PM.rng.fbm(xx / 8, yy / 10, seed + 3011, 2) - 0.5;
      burnAt[pi] = xx + broad * 34 + detail * 8;
    }
    // The flame enters through the left rim, already visible inside the dish.
    sweepX = leftX + SPRITE_W * 0.23;
    t = 0; lastStepAt = 0; active = true; done = onDone || null;
    restartGif();
  }
  function hideFire() {
    var el = flameElement();
    if (!el) return;
    el.style.display = 'none'; el.style.opacity = '0';
  }
  function reset() {
    active = false; done = null; f = null;
    soot = burned = burnAt = null; lastStepAt = 0;
    hideFire();
  }
  function clearBehindFlame() {
    // The clearing front lives inside the flame, and reaches past the right rim.
    var cut = sweepX + SPRITE_W * 0.18;
    for (var y = topY; y <= botY; y++) for (var x = leftX; x <= rightX; x++) {
      var i = y * W + x;
      if (burned[i] || !f.mask[i] || burnAt[i] > cut) continue;
      burned[i] = 1;
      var mold = f.owner[i] ? Math.min(1, f.density[i] / 210) : (f.film[i] > 40 ? 0.4 : 0);
      soot[i] = Math.max(0.05, 0.22 + mold * 0.25 + (hash(x, y, seed + 213) - 0.5) * 0.16);
      f.owner[i] = 0; f.density[i] = 0; f.film[i] = 0; f.texSet[i] = 0;
    }
  }
  function step() {
    if (!active) return;
    var now = Date.now();
    var dt = lastStepAt ? (now - lastStepAt) / (1000 / 60) : 1;
    lastStepAt = now; t += clamp(dt, 0.25, 4);
    var travel = smooth(clamp(t / TOTAL_FRAMES, 0, 1));
    sweepX = leftX + SPRITE_W * 0.23 + (rightX - leftX + SPRITE_W * 0.52) * travel;
    clearBehindFlame();
    if ((Math.floor(t) % 3) === 0 && t < RECOVER_START) PM.sound.event('crackle', null, (Math.random() - 0.5) * 1.2);
    if (t >= TOTAL_FRAMES) { var cb = done; reset(); if (cb) cb(); }
  }
  function paint(lum) {
    if (!active || !f) return;
    // Ash holds while the flame crosses the dish, then melts softly back into
    // a clean, empty starting dish during the outgoing movement.
    var ash = 1 - smooth(clamp((t - RECOVER_START) / (TOTAL_FRAMES - RECOVER_START), 0, 1));
    for (var i = 0; i < soot.length; i++) if (soot[i]) {
      var amount = soot[i] * ash;
      lum[i] = lum[i] * (1 - amount) + 2 * amount;
    }
  }
  function present(stage) {
    var el = flameElement();
    if (!el || !active || !stage) { hideFire(); return; }
    var rect = stage.getBoundingClientRect();
    // Slightly smaller, entirely inside the dish, with the source aspect ratio
    // intact. Entry and exit are created by x movement, never by opacity.
    var drawW = SPRITE_W * 0.78, drawH = SPRITE_H * 0.78;
    var ox = sweepX - drawW * 0.5;
    var oy = botY - 14 - drawH;
    el.style.left = (rect.left + ox / W * rect.width) + 'px';
    el.style.top = (rect.top + oy / H * rect.height) + 'px';
    el.style.width = (drawW / W * rect.width) + 'px';
    el.style.height = (drawH / H * rect.height) + 'px';
    el.style.opacity = '0.78';
    el.style.display = 'block';
  }
  return { start: start, step: step, paint: paint, present: present, reset: reset,
    isActive: function () { return active; },
    preload: function () {
      if (cachedImage) return;
      cachedImage = new Image(); cachedImage.src = 'assets/kostyor-19.gif';
    } };
})();
