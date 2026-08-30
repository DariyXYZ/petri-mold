var PM = PM || {};

PM.app = (function () {
  // Одно разрешение, пропорция референса 569:583. Всё пиксельное в симуляции
  // масштабируется коэффициентом W/192, так что картинка не зависит от него.
  var W = 380, H = 389;

  var MAX_SPORES = 8;
  var MATURE_AT = 5200;    // тик, после которого рост заметно замедляется
  var seed = 12345;
  var speed = 3;

  var state = 'inoculate';     // inoculate | growing | mature | done
  var points = [], colonies = [], fields = null;
  var rnd = null, nextId = 1;

  var lum, bg, img, off, offCtx, canvas, ctx, dw, dh, raf = null;

  // ---------- буферы ----------
  function allocate() {
    lum = new Float32Array(W * H);
    bg = new Float32Array(W * H);
    off = document.createElement('canvas');
    off.width = W; off.height = H;
    offCtx = off.getContext('2d');
    img = offCtx.createImageData(W, H);
  }

  function fitDisplay() {
    var availW = window.innerWidth - 48;
    var availH = window.innerHeight - 100;
    var scale = Math.max(1, Math.floor(Math.min(availW / W, availH / H)));
    dw = W * scale; dh = H * scale;
    canvas.width = dw; canvas.height = dh;
    canvas.style.width = dw + 'px';
    canvas.style.height = dh + 'px';
  }

  // Фон рисуем один раз и держим копию — агар и обод не меняются
  function bakeBackground() {
    PM.dish.paint(bg, W, H, seed, PM.dish.GEO);
  }

  // ---------- культура ----------
  function newCulture(keepPoints) {
    rnd = PM.rng.mulberry32(seed);
    fields = PM.fields.create(W, H, seed, PM.dish.GEO);
    colonies = [];
    nextId = 1;
    if (!keepPoints) points = [];
    state = 'inoculate';
    bakeBackground();
    PM.ui.sync();
    draw();
  }

  function addSpore(bx, by) {
    if (state !== 'inoculate') return;
    if (points.length >= MAX_SPORES) return;
    var i = Math.round(by) * W + Math.round(bx);
    if (!fields.mask[i]) return;
    // клик по существующей споре — убрать
    for (var p = 0; p < points.length; p++) {
      var d = Math.hypot(points[p].x - bx, points[p].y - by);
      if (d < 4) { points.splice(p, 1); PM.ui.sync(); draw(); return; }
    }
    points.push({ x: Math.round(bx), y: Math.round(by) });
    PM.ui.sync();
    draw();
  }

  function start() {
    if (state !== 'inoculate' || !points.length) return;
    for (var p = 0; p < points.length; p++) {
      var c = PM.growth.makeColony(nextId++, points[p].x, points[p].y, rnd, seed,
                                   PM.ui.forcedArchetype(), W / 192);
      PM.growth.inoculate(c, fields, rnd);
      colonies.push(c);
    }
    state = 'growing';
    PM.ui.sync();
    loop();
  }

  // ---------- цикл ----------
  function loop() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function step() {
      if (state === 'growing' || state === 'mature') {
        PM.growth.tick(fields, colonies, rnd,
                       state === 'mature' ? speed * 0.3 : speed);

        if (state === 'growing' && fields.tick > MATURE_AT) { state = 'mature'; PM.ui.sync(); }
        else if (!PM.growth.anyAlive(colonies)) { state = 'done'; PM.ui.sync(); }
        else if (fields.tick % 20 === 0) PM.ui.sync();
      }
      draw();
      if (state === 'growing' || state === 'mature') raf = requestAnimationFrame(step);
      else raf = null;
    });
  }

  function draw() {
    lum.set(bg);
    if (fields) {
      if (colonies.length) PM.scene.overlay(lum, fields, colonies);
      if (state === 'inoculate') PM.scene.markers(lum, fields, points);
    }
    PM.render.blit(lum, W, H, img);
    offCtx.putImageData(img, 0, 0);
    PM.render.present(ctx, off, W, H, dw, dh);
  }

  // ---------- управление ----------
  function reseed(s) {
    seed = (s === undefined) ? (Math.random() * 1e9) | 0 : s;
    location.hash = 'seed=' + seed;
    newCulture(false);
  }

  function sameSeed() { newCulture(true); }

  function redrawBackground() { bakeBackground(); draw(); }

  function canvasToBuffer(ev) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / r.width * W,
      y: (ev.clientY - r.top) / r.height * H
    };
  }

  function init() {
    canvas = document.getElementById('stage');
    ctx = canvas.getContext('2d');

    var h = location.hash.match(/seed=(\d+)/);
    if (h) seed = parseInt(h[1], 10);

    allocate();
    fitDisplay();

    canvas.addEventListener('click', function (ev) {
      var b = canvasToBuffer(ev);
      addSpore(b.x, b.y);
    });

    window.addEventListener('resize', function () { fitDisplay(); draw(); });

    PM.ui.init({
      MAX_SPORES: MAX_SPORES,
      reseed: reseed,
      sameSeed: sameSeed,
      start: start,
      redraw: draw,
      redrawBackground: redrawBackground,
      getSeed: function () { return seed; },
      getState: function () { return state; },
      getPoints: function () { return points; },
      getColonies: function () { return colonies; },
      getTick: function () { return fields ? fields.tick : 0; },
      getSpeed: function () { return speed; },
      setSpeed: function (v) { speed = v; },
      dims: function () { return W + '×' + H; }
    });

    newCulture(false);
  }

  // Отладка: прогнать N тиков синхронно, минуя rAF
  function step(n) {
    for (var i = 0; i < n && (state === 'growing' || state === 'mature'); i++) {
      PM.growth.tick(fields, colonies, rnd, state === 'mature' ? speed * 0.3 : speed);
      if (state === 'growing' && fields.tick > MATURE_AT) state = 'mature';
      else if (!PM.growth.anyAlive(colonies)) state = 'done';
    }
    PM.ui.sync();
    draw();
    return { tick: fields.tick, state: state,
             cells: colonies.map(function (c) { return c.archetype + ':' + c.cells; }) };
  }

  return { init: init, step: step, redraw: draw };
})();

window.addEventListener('DOMContentLoaded', PM.app.init);
