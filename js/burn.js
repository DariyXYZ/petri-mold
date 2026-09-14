var PM = PM || {};

// All 13 original GIF frames, at their original 40 ms cadence. Rendering them
// above the dish shares its pixel size, palette and dithering.
PM.burn = (function () {
  var f, snapshot, clean, ash, edge, cleared;
  var active = false, done, started = null, elapsed = 0;
  var atlas, pixels, ready, front = 0;
  var SW = 366, SH = 391, COUNT = 13;
  var DURATION = 3500, EXIT = 2900;
  var left, right, bottom, drawW, drawH;
  var overlay, overlayCtx, overlayLum, overlayImage, overlayAlpha;
  var progress = 0;
  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function smooth(v) { v = clamp(v); return v * v * (3 - 2 * v); }

  function preload() {
    if (ready) return ready;
    ready = new Promise(function (resolve) {
      atlas = new Image();
      atlas.onload = function () {
        var c = document.createElement('canvas');
        c.width = SW * COUNT; c.height = SH;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(atlas, 0, 0);
        pixels = ctx.getImageData(0, 0, c.width, c.height).data;
        resolve();
      };
      atlas.onerror = function () { ready = null; resolve(); };
      atlas.src = 'assets/fire-frames.png';
    });
    return ready;
  }

  function start(fields, seed, callback, scene, background) {
    f = fields; done = callback; active = true; started = null; elapsed = 0;
    snapshot = new Float32Array(scene); clean = new Float32Array(background);
    ash = new Float32Array(f.n); edge = new Float32Array(f.n);
    cleared = new Uint8Array(f.n);
    left = f.W; right = 0; bottom = 0;
    var top = f.H;
    for (var y = 0; y < f.H; y++) for (var x = 0; x < f.W; x++) {
      var i = y * f.W + x;
      if (!f.mask[i]) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      bottom = Math.max(bottom, y); top = Math.min(top, y);
      edge[i] = (PM.rng.fbm(x / 25, y / 34, seed + 1709, 3) - 0.5) * 48
        + (PM.rng.fbm(x / 7, y / 9, seed + 1823, 2) - 0.5) * 14;
      // Capture the actual visible colony texture before changing its fields.
      var biomass = clamp(Math.abs(snapshot[i] - clean[i]) / 95);
      ash[i] = clean[i] * (1 - biomass * 0.85);
    }
    drawH = (bottom - top) * 1.35;
    drawW = drawH * SW / SH;
    front = left - 40; progress = 0;
    preload();
  }

  function step() {
    if (!active) return;
    if (!pixels) {
      // A failed asset must not strand the UI in BURNING.
      if (!ready) { var fail = done; reset(); if (fail) fail(); }
      return;
    }
    var now = performance.now();
    if (started === null) started = now;
    elapsed = now - started;
    var linear = clamp(elapsed / EXIT);
    // Faster entry/exit, more time crossing the centre.
    progress = linear + 0.09 * Math.sin(2 * Math.PI * linear);
    front = left - 40 + (right - left + 110) * progress;
    for (var y = 0; y < f.H; y++) for (var x = 0; x < f.W; x++) {
      var i = y * f.W + x;
      if (!f.mask[i] || cleared[i] || x + edge[i] > front - 8) continue;
      cleared[i] = 1;
      f.owner[i] = f.density[i] = f.film[i] = f.texSet[i] = 0;
    }
    if (elapsed >= DURATION) { var cb = done; reset(); if (cb) cb(); }
  }

  function paint(lum) {
    if (!active) return;
    var recover = smooth((elapsed - EXIT) / (DURATION - EXIT));
    for (var y = 0; y < f.H; y++) for (var x = 0; x < f.W; x++) {
      var i = y * f.W + x;
      if (!f.mask[i]) continue;
      var burned = smooth((front + 12 - x - edge[i]) / 42);
      var residue = ash[i] * (1 - recover) + clean[i] * recover;
      lum[i] = snapshot[i] * (1 - burned) + residue * burned;
    }
  }

  function present(stage) {
    if (!overlay) {
      overlay = document.getElementById('fire-overlay');
      overlayCtx = overlay.getContext('2d');
    }
    if (!active || !pixels || elapsed >= EXIT) {
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      return;
    }
    var rect = stage.getBoundingClientRect();
    var scale = rect.width / f.W;
    var w = Math.ceil(window.innerWidth / scale), h = Math.ceil(window.innerHeight / scale);
    if (overlay.width !== w || overlay.height !== h || !overlayImage) {
      overlay.width = w; overlay.height = h;
      overlayLum = new Float32Array(w * h);
      overlayAlpha = new Uint8Array(w * h);
      overlayImage = overlayCtx.createImageData(w, h);
    }
    overlayLum.fill(0); overlayAlpha.fill(0);
    var frame = Math.floor(elapsed / 40) % COUNT;
    // Even at the apex, the GIF's straight base stays below the viewport.
    // Entry and exit come from vertical translation, never opacity.
    var base = h + 24;
    var height = Math.max(drawH, (base - rect.top / scale - (f.H - bottom)) * 1.25);
    var width = height * SW / SH;
    var rise = Math.pow(Math.sin(Math.PI * progress), 0.7);
    var ox = rect.left / scale + front - width / 2;
    var oy = base - height * rise;
    for (var y = Math.max(0, Math.floor(oy)); y < h; y++) {
      var sy = Math.floor((y - oy) / height * SH);
      if (sy < 0 || sy >= SH) continue;
      for (var x = Math.max(0, Math.floor(ox)); x < Math.min(w, ox + width); x++) {
        var sx = Math.floor((x - ox) / width * SW);
        if (sx < 0 || sx >= SW) continue;
        var p = (sy * SW * COUNT + frame * SW + sx) * 4;
        var light = (pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114) / 255;
        var i = y * w + x;
        overlayAlpha[i] = Math.round(255 * smooth(light / 0.3));
        var grain = (PM.palette.BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.46875) * 24;
        overlayLum[i] = 205 * Math.pow(light, 0.85) + grain;
      }
    }
    PM.render.blit(overlayLum, w, h, overlayImage);
    for (var i = 0; i < overlayAlpha.length; i++) overlayImage.data[i * 4 + 3] = overlayAlpha[i];
    overlayCtx.putImageData(overlayImage, 0, 0);
  }
  function reset() {
    active = false; done = null; started = null;
    f = snapshot = clean = ash = edge = cleared = null;
    if (overlayCtx) overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  }
  return { start: start, step: step, paint: paint, reset: reset,
    preload: preload, present: present, isActive: function () { return active; } };
})();
