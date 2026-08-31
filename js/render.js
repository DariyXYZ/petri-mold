var PM = PM || {};

// luminance -> dither -> quantize -> ImageData -> nearest-neighbour upscale
PM.render = (function () {
  var ditherAmp = 33;
  var ditherOn = true;

  function blit(lum, W, H, img) {
    var data = img.data;
    var B = PM.palette.BAYER4;
    var RAMP = PM.palette.ramp();
    var LUT = PM.palette.table();
    var OFF = PM.palette.LUT_OFF, LMAX = PM.palette.LUT_N - 1;

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var l = lum[i];
        var o = i << 2;

        // чистый фон не дизерим — иначе за чашкой ползёт шахматный шум
        if (l <= 1) {
          data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255;
          continue;
        }
        if (ditherOn) {
          // Байер даёт пиксельную фактуру, хеш-шум ломает его регулярность:
          // на плавных градиентах чистая матрица порождает муаровые кольца.
          var h = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
          h = (Math.imul(h ^ (h >>> 13), 1274126177) >>> 0) / 4294967296;
          l += ((B[(y & 3) * 4 + (x & 3)] / 16 - 0.46875) * 0.72 + (h - 0.5) * 0.55)
               * ditherAmp;
        }

        var q = (l + OFF) | 0;
        if (q < 0) q = 0; else if (q > LMAX) q = LMAX;
        var c = RAMP[LUT[q]];
        data[o] = c.r; data[o + 1] = c.g; data[o + 2] = c.b; data[o + 3] = 255;
      }
    }
  }

  function present(ctx, off, W, H, dw, dh) {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(off, 0, 0, W, H, 0, 0, dw, dh);
  }

  return {
    blit: blit,
    present: present,
    setDither: function (v) { ditherOn = v; },
    setAmp: function (v) { ditherAmp = v; },
    getAmp: function () { return ditherAmp; },
    getDither: function () { return ditherOn; }
  };
})();
