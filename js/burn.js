var PM = PM || {};

// All 13 original GIF frames, at their original 40 ms cadence. Rendering them
// in the dish buffer shares its mask, pixel size, palette and dithering.
PM.burn = (function () {
  var f, snapshot, clean, ash, edge, cleared;
  var active = false, done, started = null, elapsed = 0;
  var atlas, pixels, ready, front = 0;
  var SW = 366, SH = 391, COUNT = 13;
  var DURATION = 4000, EXIT = 3400;
  var left, right, bottom, drawW, drawH;
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
      edge[i] = (PM.rng.fbm(x / 16, y / 22, seed + 1709, 3) - 0.5) * 22;
      // Capture the actual visible colony texture before changing its fields.
      var biomass = clamp(Math.abs(snapshot[i] - clean[i]) / 95);
      ash[i] = clean[i] * (0.92 - biomass * 0.78);
    }
    drawH = (bottom - top) * 1.5;
    drawW = drawH * SW / SH;
    front = left - 40;
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
    front = left - 40 + (right - left + drawW * 0.5 + 40) * clamp(elapsed / EXIT);
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
    var frame = Math.floor(elapsed / 40) % COUNT;
    var ox = front - drawW * 0.5;
    // Hide the source's straight lower edge below the circular agar boundary.
    var oy = bottom + 24 - drawH;
    for (var y = 0; y < f.H; y++) for (var x = 0; x < f.W; x++) {
      var i = y * f.W + x;
      if (!f.mask[i]) continue;
      var burned = smooth((front - 8 - x - edge[i]) / 14);
      var residue = ash[i] * (1 - recover) + clean[i] * recover;
      lum[i] = snapshot[i] * (1 - burned) + residue * burned;
      if (!pixels) continue;
      var sx = Math.floor((x - ox) / drawW * SW);
      var sy = Math.floor((y - oy) / drawH * SH);
      if (sx < 0 || sx >= SW || sy < 0 || sy >= SH) continue;
      var p = (sy * SW * COUNT + frame * SW + sx) * 4;
      var light = (pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114) / 255;
      var coverage = smooth(light / 0.3);
      // Match the dish grain; retain highlights without clipping to solid white.
      var grain = (PM.palette.BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.46875) * 24;
      var tone = 205 * Math.pow(light, 0.85) + grain;
      lum[i] = lum[i] * (1 - coverage) + tone * coverage;
    }
  }
  function reset() {
    active = false; done = null; started = null;
    f = snapshot = clean = ash = edge = cleared = null;
  }
  return { start: start, step: step, paint: paint, reset: reset,
    preload: preload, isActive: function () { return active; } };
})();
