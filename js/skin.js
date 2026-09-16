var PM = PM || {};

// Кнопки как пиксельные объекты в сетке чашки. Фон каждой кнопки рисуется в
// буфере с шагом пикселя чашки (--k из main.js): тёмный бархат с лёгкой
// пятнистостью, рамка в один пиксель, фаска в один пиксель (светлая грань
// сверху-слева, чёрная снизу-справа), скруглённые на пиксель углы, пара
// сколов на рамке и несколько пятен на теле. Три состояния — покой,
// наведение (грань зажигается белым), нажатие (фаска перевёрнута) — три
// картинки в css-переменных кнопки; переключает их css мгновенно.
PM.skin = (function () {
  var STATES = ['idle', 'hover', 'press'];
  var ro = null;

  function k() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k'));
    return v > 0 ? v : 2;
  }

  function paint(btn) {
    var kk = k();
    var r = btn.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var w = Math.ceil(r.width / kk), h = Math.ceil(r.height / kk);
    var tag = w + 'x' + h + '@' + kk;
    if (btn.dataset.skin === tag) return;
    btn.dataset.skin = tag;
    var seed = PM.rng.hashSeed(btn.id || btn.textContent || 'btn');
    for (var s = 0; s < STATES.length; s++) {
      btn.style.setProperty('--bg-' + STATES[s], 'url(' + render(w, h, seed, s, kk) + ')');
    }
  }

  function render(w, h, seed, state, kk) {
    var rnd = PM.rng.mulberry32(seed);
    var n = w * h, lum = new Float32Array(n);
    var i, x, y;

    // тело: тёмный бархат с пятнистостью в две октавы
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      lum[y * w + x] = 20 + (PM.rng.fbm(x / 5, y / 4, seed, 2) - 0.5) * 12;
    }

    // пятна: пара светлых, одно тёмное — как потёртости
    var spots = 2 + ((rnd() * 3) | 0);
    for (var sp = 0; sp < spots; sp++) {
      var cx = 2 + rnd() * (w - 4), cy = 2 + rnd() * (h - 4);
      var rad = 0.6 + rnd() * 1.5, val = rnd() < 0.65 ? 32 + rnd() * 16 : 8;
      for (y = Math.floor(cy - rad); y <= cy + rad; y++) for (x = Math.floor(cx - rad); x <= cx + rad; x++) {
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= rad * rad) lum[y * w + x] = val;
      }
    }

    // фаска: внутренние грани
    var light = state === 1 ? 230 : (state === 2 ? 0 : 48);
    var dark = state === 2 ? 96 : 0;
    for (x = 1; x < w - 1; x++) { lum[1 * w + x] = light; lum[(h - 2) * w + x] = dark; }
    for (y = 1; y < h - 1; y++) { lum[y * w + 1] = light; lum[y * w + (w - 2)] = dark; }

    // рамка
    var border = state === 1 ? 64 : 38;
    for (x = 0; x < w; x++) { lum[x] = border; lum[(h - 1) * w + x] = border; }
    for (y = 0; y < h; y++) { lum[y * w] = border; lum[y * w + (w - 1)] = border; }
    // углы скруглены на пиксель
    lum[0] = lum[w - 1] = lum[(h - 1) * w] = lum[n - 1] = -1;

    // сколы: два-три выпавших пикселя рамки, один на фаске
    var chips = 2 + ((rnd() * 2) | 0);
    for (var ch = 0; ch < chips; ch++) {
      var side = (rnd() * 4) | 0, len = 1 + ((rnd() * 2) | 0);
      var pos = 2 + ((rnd() * ((side < 2 ? w : h) - 4 - len)) | 0);
      for (var q = 0; q < len; q++) {
        if (side === 0) lum[pos + q] = -1;
        else if (side === 1) lum[(h - 1) * w + pos + q] = -1;
        else if (side === 2) lum[(pos + q) * w] = -1;
        else lum[(pos + q) * w + (w - 1)] = -1;
      }
    }
    var fx = 3 + ((rnd() * (w - 6)) | 0);
    lum[1 * w + fx] = 20;

    // в холст, увеличение ровно на шаг пикселя
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    var img = g.createImageData(w, h);
    for (i = 0; i < n; i++) {
      var v = lum[i], o = i * 4;
      if (v < 0) { img.data[o + 3] = 0; continue; }
      v = Math.max(0, Math.min(255, Math.round(v)));
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var big = document.createElement('canvas');
    big.width = Math.round(w * kk); big.height = Math.round(h * kk);
    var bg = big.getContext('2d');
    bg.imageSmoothingEnabled = false;
    bg.drawImage(c, 0, 0, big.width, big.height);
    return big.toDataURL('image/png');
  }

  // Нажатие держится не меньше 220 мс: кнопка «дожимается», даже если
  // клик был мгновенным.
  function press(btn) {
    var t0 = 0;
    btn.addEventListener('pointerdown', function () {
      if (btn.disabled) return;
      t0 = performance.now();
      btn.classList.add('pressed');
    });
    function up() {
      if (!btn.classList.contains('pressed')) return;
      var left = Math.max(0, 220 - (performance.now() - t0));
      setTimeout(function () { btn.classList.remove('pressed'); }, left);
    }
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  function all() {
    return document.querySelectorAll('button:not(.tile)');
  }

  function refresh() {
    var b = all();
    for (var i = 0; i < b.length; i++) paint(b[i]);
  }

  function init() {
    var b = all();
    for (var i = 0; i < b.length; i++) press(b[i]);
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function (entries) {
        for (var j = 0; j < entries.length; j++) paint(entries[j].target);
      });
      for (var q = 0; q < b.length; q++) ro.observe(b[q]);
    }
    window.addEventListener('resize', refresh);
    refresh();
  }

  return { init: init, refresh: refresh, paint: paint };
})();
