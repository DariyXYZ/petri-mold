var PM = PM || {};

// Сбой на весь экран на секунду — как будто на миг потерялась связь и
// декодер собирает кадр из того, что успело дойти.
//
// Экран целиком в пиксели не снять, поэтому сбой собирается из копий
// страницы: в начале сбоя всё содержимое body клонируется в несколько
// слоёв поверх (у копий холстов переносится картинка), и каждый слой
// показывает свой кусок экрана — обрезанный clip-path и сдвинутый:
//   - полосы экрана съезжают вбок (срыв строчной синхронизации);
//   - квадраты экрана встают не на своё место (битые макроблоки);
//   - строка пикселей залипает и тянется вниз;
//   - весь кадр проскакивает по вертикали с чёрной щелью (срыв кадровой);
//   - строки выпадают в чёрное, узкие полосы на миг инвертируются.
// Внутри чашки поверх этого ещё бьются блоки самой картинки (размазанные
// из одного столбца), а кадр иногда подвисает на несколько обновлений.
//
// Всё ломается на сетке пикселей буфера чашки. По силе — средний всплеск,
// сильный, длинная чистая пауза, слабый отголосок из пары тонких полос. Узор меняется через случайное число кадров:
// картинка подлагивает, а не плывёт.
PM.glitch = (function () {
  var DUR = 1300;
  var canvas = null, redraw = null, bufW = 380;
  var active = false, t0 = 0;
  var hold = 0, frozen = false;
  var cops = [], pops = [];                 // поломки чашки и страницы
  var snap = null, sctx = null, last = null, lctx = null;
  var layers = [], marks = [];              // слои-копии страницы и полосы
  var sources = [];                         // холсты оригинала в порядке копий

  function skip(el) {
    return el.tagName === 'SCRIPT' || el.id === 'loader' || el.id === 'tool' || el.id === 'rec-cursor' ||
           el.classList.contains('glitch-layer') || el.classList.contains('glitch-mark');
  }

  function attach(c, redrawFn, w) { canvas = c; redraw = redrawFn; bufW = w || bufW; }

  // огибающая: средний — сильный — длинная чистая пауза — слабый отголосок
  function strength(t) {
    var e;
    if (t < 0.03) e = 0.5 * t / 0.03;
    else if (t < 0.17) e = 0.5;
    else if (t < 0.36) e = 0.75;
    else if (t < 0.72) return 0;
    else if (t < 0.8) e = 0.18;
    else if (t < 0.9) e = 0.18 * (1 - (t - 0.8) / 0.1);
    else return 0;
    return e * (0.7 + 0.3 * Math.random());
  }

  function rint(n) { return (Math.random() * n) | 0; }

  // ---------- слои-копии страницы ----------
  var NL = 18;

  function build() {
    if (layers.length) return;
    sources = [];
    var top = document.body.children;
    for (var q = 0; q < top.length; q++) {
      if (skip(top[q])) continue;
      if (top[q].tagName === 'CANVAS') sources.push(top[q]);
      var inner = top[q].querySelectorAll('canvas');
      for (var w = 0; w < inner.length; w++) sources.push(inner[w]);
    }
    for (var i = 0; i < NL; i++) {
      var L = document.createElement('div');
      L.className = 'glitch-layer';
      var kids = document.body.children;
      for (var j = 0; j < kids.length; j++) if (!skip(kids[j])) L.appendChild(kids[j].cloneNode(true));
      document.body.appendChild(L);
      layers.push(L);
    }
    for (var m = 0; m < 10; m++) {
      var d = document.createElement('div');
      d.className = 'glitch-mark';
      document.body.appendChild(d);
      marks.push(d);
    }
  }

  // перенести картинки холстов в копии: превью штаммов — один раз,
  // чашку — каждый кадр (она растёт и сама сбоит)
  function copyCanvases(all) {
    var src = sources;
    for (var i = 0; i < layers.length; i++) {
      if (layers[i].style.display === 'none' && !all) continue;
      var dst = layers[i].querySelectorAll('canvas');
      var n = Math.min(src.length, dst.length);
      for (var j = 0; j < n; j++) {
        var s = src[j], d = dst[j];
        if (!all && s !== canvas) continue;
        if (!s.width || !s.height) continue;
        if (d.width !== s.width || d.height !== s.height) { d.width = s.width; d.height = s.height; }
        var g = d.getContext('2d');
        g.clearRect(0, 0, d.width, d.height);
        g.drawImage(s, 0, 0);
      }
    }
  }

  function teardown() {
    for (var i = 0; i < layers.length; i++) layers[i].remove();
    for (var m = 0; m < marks.length; m++) marks[m].remove();
    layers = []; marks = [];
  }

  // ---------- новый набор поломок под силу e ----------
  function pattern(dw, dh, k, e) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var r = canvas.getBoundingClientRect();
    var u = r.width / bufW;                  // пиксель буфера в css-пикселях
    var snapY = function (y) { return Math.round(y / u) * u; };
    pops = [];
    cops = [];
    if (e <= 0) { frozen = false; hold = 2; return; }
    if (e < 0.2) {
      var nw = 2 + rint(2);
      for (var w = 0; w < nw; w++) {
        pops.push({ kind: 'tear', y: snapY(Math.random() * vh), h: u * (1 + rint(5)),
                    dx: (Math.random() < 0.5 ? -1 : 1) * u * (1 + rint(4)) });
      }
      if (Math.random() < 0.5) pops.push({ kind: 'drop', y: snapY(Math.random() * vh), h: u });
      frozen = false;
      hold = 2 + rint(3);
      return;
    }

    if (e > 0.6 && Math.random() < 0.45) pops.push({ kind: 'roll', dy: snapY(u * (6 + rint(36))) });
    var n = 1 + rint(8 * e);
    for (var i = 0; i < n; i++) {
      pops.push({ kind: 'tear', y: snapY(Math.random() * vh), h: u * (1 + rint(22)),
                  dx: Math.round((Math.random() * 2 - 1) * 26 * e) * u });
    }
    var nb = rint(7 * e);
    var hx = Math.random() * vw, hy = Math.random() * vh;
    for (var b = 0; b < nb; b++) {
      var S = u * (Math.random() < 0.6 ? 8 : 16);
      var bx = Math.floor((hx + (Math.random() * 2 - 1) * 90 * u) / S) * S;
      var by = Math.floor((hy + (Math.random() * 2 - 1) * 60 * u) / S) * S;
      pops.push({ kind: 'block', x: bx, y: by, s: S, dx: S * (rint(5) - 2), dy: S * (rint(3) - 1) });
    }
    var ns = rint(3 * e + 0.6);
    for (var s = 0; s < ns; s++) pops.push({ kind: 'stuck', y: snapY(Math.random() * vh), u: u, h: u * (3 + rint(30)) });
    var nd = rint(5 * e + 0.5);
    for (var d = 0; d < nd; d++) pops.push({ kind: 'drop', y: snapY(Math.random() * vh), h: u * (1 + rint(Math.random() < 0.7 ? 2 : 10)) });
    if (Math.random() < 0.4 * e) pops.push({ kind: 'invert', y: snapY(Math.random() * vh), h: u * (1 + rint(5)) });

    // поломки внутри картинки чашки
    var cb = rint(10 * e);
    var cx = rint(dw), cy = rint(dh);
    for (var c = 0; c < cb; c++) {
      var B = k * (Math.random() < 0.6 ? 8 : 16);
      var x0 = Math.floor((cx + (Math.random() * 2 - 1) * 60 * k) / B) * B;
      var y0 = Math.floor((cy + (Math.random() * 2 - 1) * 40 * k) / B) * B;
      cops.push({ smear: Math.random() < 0.5, x: x0, y: y0, s: B, sx: x0 + B * (rint(5) - 2), sy: y0 + B * (rint(3) - 1) });
    }

    frozen = e > 0.3 && Math.random() < 0.25;
    hold = 1 + rint(frozen ? 5 : 3);
  }

  // расставить слои и полосы по текущему набору поломок
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var li = 0, mi = 0;
    function layer(clip, tx, ty, sy, oy) {
      if (li >= layers.length) return;
      var L = layers[li++];
      L.style.display = 'block';
      L.style.clipPath = clip;
      L.style.transformOrigin = '0 ' + (oy || 0) + 'px';
      L.style.transform = 'translate(' + tx + 'px,' + ty + 'px)' + (sy ? ' scaleY(' + sy + ')' : '');
    }
    function mark(y, h, cls) {
      if (mi >= marks.length) return;
      var M = marks[mi++];
      M.className = 'glitch-mark ' + cls;
      M.style.display = 'block';
      M.style.top = y + 'px';
      M.style.height = h + 'px';
    }
    for (var i = 0; i < pops.length; i++) {
      var o = pops[i];
      if (o.kind === 'roll') {
        // кадр уехал вниз; сверху — его хвост после чёрной щели
        layer('inset(0 0 0 0)', 0, o.dy);
        layer('inset(' + (vh - o.dy + 6) + 'px 0 0 0)', 0, -vh + o.dy - 6);
      } else if (o.kind === 'tear') {
        layer('inset(' + o.y + 'px 0 ' + Math.max(0, vh - o.y - o.h) + 'px 0)', o.dx, 0);
      } else if (o.kind === 'block') {
        layer('inset(' + o.y + 'px ' + Math.max(0, vw - o.x - o.s) + 'px ' + Math.max(0, vh - o.y - o.s) + 'px ' + o.x + 'px)', o.dx, o.dy);
      } else if (o.kind === 'stuck') {
        // строка в один пиксель буфера, растянутая вниз на всю полосу
        layer('inset(' + o.y + 'px 0 ' + Math.max(0, vh - o.y - o.u) + 'px 0)', 0, 0, o.h / o.u, o.y);
      } else if (o.kind === 'drop') {
        mark(o.y, o.h, 'drop');
      } else if (o.kind === 'invert') {
        mark(o.y, o.h, 'invert');
      }
    }
    for (; li < layers.length; li++) layers[li].style.display = 'none';
    for (; mi < marks.length; mi++) marks[mi].style.display = 'none';
  }

  // ---------- цикл ----------
  function run(ms) {
    if (!canvas || active) return;
    DUR = ms || 1300;
    build();
    copyCanvases(true);
    t0 = performance.now();
    hold = 0;
    active = true;
    document.body.classList.add('glitching');
    requestAnimationFrame(loop);
  }

  function loop() {
    if (!active) return;
    redraw();
    requestAnimationFrame(loop);
  }

  function ensure(dw, dh) {
    if (!snap || snap.width !== dw || snap.height !== dh) {
      snap = document.createElement('canvas'); snap.width = dw; snap.height = dh;
      sctx = snap.getContext('2d');
      last = document.createElement('canvas'); last.width = dw; last.height = dh;
      lctx = last.getContext('2d');
    }
  }

  function apply(ctx, dw, dh, k) {
    if (!active) return;
    var t = (performance.now() - t0) / DUR;
    if (t >= 1) {
      active = false;
      document.body.classList.remove('glitching');
      teardown();
      redraw();
      return;
    }
    ensure(dw, dh);

    var fresh = hold <= 0;
    if (fresh) { pattern(dw, dh, k, strength(t)); layout(); }
    hold--;

    // подвисание: держим прошлый битый кадр, слои не трогаем
    if (!fresh && frozen) {
      ctx.clearRect(0, 0, dw, dh);
      ctx.drawImage(last, 0, 0);
      return;
    }

    sctx.clearRect(0, 0, dw, dh);
    sctx.drawImage(ctx.canvas, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (var i = 0; i < cops.length; i++) {
      var o = cops[i];
      if (o.smear) ctx.drawImage(snap, o.sx, o.y, k, o.s, o.x, o.y, o.s, o.s);
      else ctx.drawImage(snap, o.sx, o.sy, o.s, o.s, o.x, o.y, o.s, o.s);
    }
    ctx.restore();
    lctx.clearRect(0, 0, dw, dh);
    lctx.drawImage(ctx.canvas, 0, 0);
    copyCanvases(false);
  }

  return { attach: attach, run: run, apply: apply, active: function () { return active; } };
})();
