var PM = PM || {};

// Большой пинцет вместо курсора. Картинка — фотография анатомического пинцета,
// прогнанная через ту же пикселизацию, что и вся сцена: даунсемпл, квантование
// в палитру проекта с дизером, жёсткая альфа. Иначе фотоинструмент выпадал бы
// из кадра.
//
// Пикселизация идёт в рантайме под масштаб чашки: у чашки пиксель буфера
// занимает k экранных точек, и у пинцета он должен занимать столько же.
// Запечённая заранее картинка одного размера этого не даёт — при 320 px
// ширины и 88 px исходника пиксель выходил в 3.6 точки против 2 у чашки, и
// сетки не совпадали. Поэтому исходник хранится в 400 px (assets/tweezers.js),
// а под каждый масштаб печётся свой холст через PM.render.blit.
//
// Пинцет всё время держит спору (сомкнут) и разжимается в момент клика —
// это и есть жест «отпустили спору над чашкой». Точка, где сходятся бранши,
// приходится ровно на курсор.
PM.cursor = (function () {
  var W = 320;                       // ширина инструмента на экране
  var ALPHA = 110;                   // порог жёсткой альфы, как у старой запечки
  // Точка выпуска споры — ровно между концами браншей. Замерено по картинкам:
  // у разомкнутого нижний кончик в (0,6), верхний в (7,0) при 88x77;
  // у сомкнутого бранши слиты в левом верхнем углу. Доли от ширины и высоты,
  // кроп тот же — при любом масштабе остаются верными.
  var HOT = {
    open: [0.040, 0.039],
    shut: [0.006, 0.006]
  };

  var tool = null, host = null, shown = false;
  var openNow = false, relaxTimer = 0;
  var src = {}, baked = {}, getScale = null;
  var lastX = 0, lastY = 0;

  function ensure() {
    if (tool) return;
    tool = document.createElement('canvas');
    tool.id = 'tool';
    document.body.appendChild(tool);
    ['open', 'shut'].forEach(function (k) {
      var im = new Image();
      im.onload = function () { baked = {}; if (shown) redraw(); };
      im.src = PM.tweezersSrc[k];
      src[k] = im;
    });
  }

  // Масштаб чашки: сколько экранных точек в одном пикселе буфера. На узком
  // окне он дробный (CSS-добор), и пинцет берёт тот же дробный шаг.
  function scale() {
    var k = getScale ? getScale() : 2;
    return k > 0.5 ? k : 2;
  }

  // Испечь пинцет под масштаб k: ширина буфера W/k, потом та же цепочка, что
  // у чашки — яркость, дизер, квантование. Альфа жёсткая: полупрозрачная
  // бахрома сглаживания читалась бы как мыло на пиксельной сцене.
  function bake(state, k) {
    var key = state + '@' + k.toFixed(3);
    if (baked[key]) return baked[key];
    var im = src[state];
    if (!im || !im.complete || !im.naturalWidth) return null;

    var w = Math.max(8, Math.round(W / k));
    var h = Math.max(8, Math.round(w * im.naturalHeight / im.naturalWidth));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var cx = c.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(im, 0, 0, w, h);

    var px;
    try { px = cx.getImageData(0, 0, w, h).data; }
    catch (e) { return null; }           // tainted-холст с диска: см. assets/tweezers.js

    var n = w * h, lum = new Float32Array(n), alpha = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      if (px[o + 3] < ALPHA) continue;
      alpha[i] = 255;
      // яркость минимум 2: ноль в blit считается фоном и уходит без дизера
      lum[i] = Math.max(2, px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114);
    }
    var out = cx.createImageData(w, h);
    PM.render.blit(lum, w, h, out);
    for (var j = 0; j < n; j++) out.data[j * 4 + 3] = alpha[j];
    cx.putImageData(out, 0, 0);

    baked[key] = { canvas: c, w: w, h: h, k: k };
    return baked[key];
  }

  function redraw() {
    var k = scale();
    var b = bake(openNow ? 'open' : 'shut', k);
    if (!b) return;
    if (tool.width !== b.w || tool.height !== b.h) { tool.width = b.w; tool.height = b.h; }
    var g = tool.getContext('2d');
    g.clearRect(0, 0, b.w, b.h);
    g.drawImage(b.canvas, 0, 0);
    tool.style.width = (b.w * k) + 'px';
    tool.style.height = (b.h * k) + 'px';
    place(lastX, lastY);
  }

  function place(x, y) {
    lastX = x; lastY = y;
    var hot = HOT[openNow ? 'open' : 'shut'];
    var w = parseFloat(tool.style.width) || W;
    var h = parseFloat(tool.style.height) || W;
    tool.style.left = (x - hot[0] * w) + 'px';
    tool.style.top = (y - hot[1] * h) + 'px';
  }

  function setOpen(v, x, y) {
    if (openNow === v) return;
    openNow = v;
    if (!tool) return;
    if (x !== undefined) { lastX = x; lastY = y; }
    redraw();
  }

  // Короткий разжим на клике: спора выпала, бранши сомкнулись обратно.
  function release(x, y) {
    setOpen(true, x, y);
    clearTimeout(relaxTimer);
    relaxTimer = setTimeout(function () { setOpen(false, x, y); }, 260);
  }

  function show(on) {
    if (!tool) return;
    if (on && !shown) redraw();
    shown = on;
    tool.style.display = on ? 'block' : 'none';
  }

  // Инструмент живёт только там, где им работают: над чашкой и только пока
  // расставляются споры. На сенсорном экране курсора нет вовсе.
  // scaleFn — сколько экранных точек в пикселе буфера чашки.
  function attach(canvas, isActive, scaleFn) {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    ensure();
    host = canvas;
    getScale = scaleFn || null;
    canvas.classList.add('has-tool');

    canvas.addEventListener('pointermove', function (e) {
      if (!isActive()) { show(false); return; }
      show(true);
      place(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerleave', function () { show(false); });
    canvas.addEventListener('pointerdown', function (e) {
      if (!isActive()) return;
      place(e.clientX, e.clientY);
      release(e.clientX, e.clientY);
    });
    // масштаб чашки меняется вместе с окном — запечь заново при следующем показе
    window.addEventListener('resize', function () { if (shown) redraw(); });
  }

  return { attach: attach, release: release, show: show };
})();
