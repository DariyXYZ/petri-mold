var PM = PM || {};

// Кнопки — только текст. Наведение и выбор обозначают четыре уголка вокруг
// надписи: пиксельные скобки в шаге пикселя чашки (--k из main.js), картинка
// печётся на размер кнопки и лежит в css-переменных; нажатие — те же
// уголки, сдвинутые на пиксель внутрь. У плиток штаммов уголки — знак
// выбора.
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
    var n = w * h, lum = new Float32Array(n);
    var i;
    for (i = 0; i < n; i++) lum[i] = -1;               // прозрачно

    if (state > 0) {
      // уголки: плечо в четверть меньшей стороны, не короче 3 и не длиннее 6;
      // при нажатии на пиксель ближе к тексту
      var L = Math.max(3, Math.min(6, Math.round(Math.min(w, h) / 4)));
      var o = state === 2 ? 1 : 0, v = state === 2 ? 179 : 230;
      var x, y;
      for (i = 0; i < L; i++) {
        x = o + i; y = o;
        lum[y * w + x] = v; lum[y * w + (w - 1 - x)] = v;
        lum[(h - 1 - y) * w + x] = v; lum[(h - 1 - y) * w + (w - 1 - x)] = v;
        x = o; y = o + i;
        lum[y * w + x] = v; lum[y * w + (w - 1 - x)] = v;
        lum[(h - 1 - y) * w + x] = v; lum[(h - 1 - y) * w + (w - 1 - x)] = v;
      }
    }

    // в холст, увеличение ровно на шаг пикселя
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    var img = g.createImageData(w, h);
    for (i = 0; i < n; i++) {
      var val = lum[i], q = i * 4;
      if (val < 0) { img.data[q + 3] = 0; continue; }
      img.data[q] = img.data[q + 1] = img.data[q + 2] = Math.round(val);
      img.data[q + 3] = 255;
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
    return document.querySelectorAll('button');
  }

  function refresh() {
    var b = all();
    for (var i = 0; i < b.length; i++) paint(b[i]);
  }

  function init() {
    var b = all();
    for (var i = 0; i < b.length; i++) if (!b[i].classList.contains('tile')) press(b[i]);
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
