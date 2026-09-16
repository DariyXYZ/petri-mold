var PM = PM || {};

PM.app = (function () {
  // Одно разрешение, пропорция референса 569:583. Всё пиксельное в симуляции
  // масштабируется коэффициентом W/192, так что картинка не зависит от него.
  var W = 380, H = 389;

  var MAX_SPORES = 8;
  var MATURE_AT = 7000;    // тик, после которого рост заметно замедляется
  var DISH_SEED = 12345;   // фон чашки не зависит от seed культуры — вид всегда один
  var seed = 12345;
  var speed = 3;

  var state = 'inoculate';   // inoculate | growing | mature | paused | burning | done
  var resumeTo = 'growing';  // куда вернуться из паузы
  var exportScale = 4;       // во сколько раз крупнее буфера сохранять PNG
  var points = [], colonies = [], fields = null;
  var rnd = null, nextId = 1;

  var lum, bg, img, off, offCtx, canvas, ctx, dw, dh, raf = null;
  var lastCells = {};        // сколько клеток было у колонии на прошлом кадре
  var lastCount = 0;         // сколько было колоний — для звука новых очагов
  var agarCells = 0;         // площадь агара в клетках — знаменатель для сцены

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
    var narrow = window.innerWidth < 760;
    // справа стоит палитра штаммов, на телефоне она уезжает вниз
    var availW = window.innerWidth - (narrow ? 14 : 250);
    var availH = window.innerHeight - (narrow ? 365 : 130);
    var fit = Math.min(availW / W, availH / H);
    var scale = Math.max(1, Math.floor(fit));

    // Внутренний буфер — всегда целое кратное, пиксель остаётся квадратным.
    dw = W * scale; dh = H * scale;
    canvas.width = dw; canvas.height = dh;

    // На узком экране добираем остаток дробным CSS-масштабом: иначе на телефоне
    // чашка сидит в 380 px и рядом остаются поля. Коэффициент близок к целому,
    // неравномерность пикселей на плотном экране не читается.
    var css = fit < 2 ? fit : scale;
    canvas.style.width = Math.floor(W * css) + 'px';
    canvas.style.height = Math.floor(H * css) + 'px';
  }

  // Фон рисуем один раз и держим копию — агар и обод не меняются.
  // Сид фиксированный (не seed культуры), иначе чашка перерисовывается
  // по-новому на каждый RESET/BURN.
  function bakeBackground() {
    PM.dish.paint(bg, W, H, DISH_SEED, PM.dish.GEO);
  }

  // ---------- культура ----------
  function newCulture(keepPoints) {
    rnd = PM.rng.mulberry32(seed);
    fields = PM.fields.create(W, H, seed, PM.dish.GEO);
    fields.seedBase = seed;
    colonies = [];
    nextId = 1;
    lastCells = {};
    lastCount = 0;
    PM.sound.reset();
    PM.sound.setScene(0, 6);
    PM.burn.reset();
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
    points.push({ x: Math.round(bx), y: Math.round(by),
                  arch: PM.ui.brush() || pickUnusedStrain() });
    PM.sound.ui('spore');
    PM.ui.sync();
    draw();
  }

  // Случайная кисть выдаёт каждой споре свой вид: две одинаковые колонии в
  // одной чашке смазывают весь смысл выбора штаммов.
  function pickUnusedStrain() {
    var all = PM.growth.names();
    var used = {};
    for (var i = 0; i < points.length; i++) if (points[i].arch) used[points[i].arch] = 1;

    var free = [];
    for (var k = 0; k < all.length; k++) if (!used[all[k]]) free.push(all[k]);
    // штаммов больше, чем спор, так что запас кончиться не должен
    var pool = free.length ? free : all;
    return pool[(Math.random() * pool.length) | 0];
  }

  function start() {
    if (state !== 'inoculate' || !points.length) return;
    for (var p = 0; p < points.length; p++) {
      var c = PM.growth.makeColony(nextId++, points[p].x, points[p].y, rnd, seed,
                                   points[p].arch, W / 192);
      PM.growth.inoculate(c, fields, rnd);
      colonies.push(c);
    }
    state = 'growing';
    PM.ui.sync();
    loop();
  }

  // ---------- цикл ----------
  function running() {
    return state === 'growing' || state === 'mature' || state === 'burning';
  }

  function loop() {
    if (raf) cancelAnimationFrame(raf);
    var lastFrame = null, accumulated = 0;
    raf = requestAnimationFrame(function step(now) {
      var dt = lastFrame === null ? 1000 / 60 : Math.max(0, now - lastFrame);
      lastFrame = now;
      accumulated = Math.min(1000 / 30, accumulated + dt);
      if (state !== 'burning' && accumulated + 0.001 < 1000 / 60) {
        raf = requestAnimationFrame(step);
        return;
      }
      if (state === 'burning') {
        // Огонь идёт своим кадром: рост остановлен, чашка только выгорает.
        PM.burn.step();
      } else if (state === 'growing' || state === 'mature') {
        accumulated = Math.max(0, accumulated - 1000 / 60);
        PM.growth.tick(fields, colonies, rnd,
                       state === 'mature' ? speed * 0.3 : speed);

        voiceGrowth();

        if (state === 'growing' && fields.tick > MATURE_AT) {
          state = 'mature'; PM.sound.event('mature'); PM.ui.sync();
        } else if (!PM.growth.anyAlive(colonies)) { state = 'done'; PM.sound.reset(); PM.ui.sync(); }
        else if (fields.tick % 20 === 0) PM.ui.sync();
      }
      draw();
      if (running()) raf = requestAnimationFrame(step);
      else raf = null;
    });
  }

  // Прирост за кадр — это и есть «голос» колонии: чем быстрее растёт, тем чаще
  // подаёт звук. Панорама берётся из её положения в чашке.
  function voiceGrowth() {

    // Голос принадлежит ВИДУ, а не колонии: колоний бывает больше сотни, и
    // если каждая подаёт сигнал отдельно, пул голосов упирается в потолок и
    // всё превращается в кашу. Прирост складываем по виду, панораму берём
    // у самой активной его колонии — она и «ведёт» партию.
    var byArch = {};
    for (var i = 0; i < colonies.length; i++) {
      var c = colonies[i];
      var was = lastCells[c.id] || 0;
      var delta = c.cells - was;
      lastCells[c.id] = c.cells;
      if (delta <= 0) continue;

      var a = byArch[c.archetype];
      if (!a) a = byArch[c.archetype] = { sum: 0, best: 0, lead: c, weightedX: 0 };
      a.sum += delta;
      a.weightedX += c.x * delta;
      if (delta > a.best) { a.best = delta; a.lead = c; }
    }

    for (var k in byArch) {
      var e = byArch[k];
      PM.sound.growth(e.lead, e.sum, (e.weightedX / e.sum / W - 0.5) * 1.7);
    }

    // Подклад следует за заполнением чашки: чем больше заросло, тем полнее
    // звучит. Считаем редко — сцена всё равно меняется секундами.
    if (fields.tick % 30 === 0) PM.sound.setScene(coverage(), 4);

    if (colonies.length > lastCount) {
      var fresh = colonies[colonies.length - 1];
      PM.sound.event('spawn', fresh.archetype, (fresh.x / W - 0.5) * 1.7);
    }
    lastCount = colonies.length;
  }

  // Доля занятого агара. Плёнка лежит поверх чужих клеток, поэтому её
  // площадь не складываем с остальными — иначе сумма уходит за единицу.
  function coverage() {
    if (!agarCells) {
      for (var i = 0; i < fields.n; i++) if (fields.mask[i]) agarCells++;
    }
    var sum = 0;
    for (var k = 0; k < colonies.length; k++) {
      if (colonies[k].a.layer !== 'veil') sum += colonies[k].cells;
    }
    return Math.min(1, sum / agarCells * 1.6);
  }

  function draw() {
    lum.set(bg);
    if (fields) {
      if (colonies.length && state !== 'burning') PM.scene.overlay(lum, fields, colonies);
      if (state === 'inoculate') PM.scene.markers(lum, fields, points);
      PM.burn.paint(lum);
    }
    PM.render.blit(lum, W, H, img);
    offCtx.putImageData(img, 0, 0);
    PM.render.present(ctx, off, W, H, dw, dh);
    PM.burn.present(canvas);
    if (state === 'inoculate') labelSpores();
  }

  // Номера посевов рисуются поверх готового кадра обычным шрифтом: в пиксельном
  // буфере цифры получались грубыми, а подпись здесь служебная, не часть картинки.
  function labelSpores() {
    if (!points.length) return;
    var k = dw / W;
    // радиус кольца в экранных точках — цифра ставится сразу за ним,
    // иначе налезает на прицел
    var ring = 3.4 * (W / 192) * k;
    ctx.save();
    ctx.font = '11px "Pixelated MS Sans Serif", "MS Sans Serif", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2f2f2';
    for (var p = 0; p < points.length; p++) {
      ctx.fillText(String(p + 1),
                   Math.round(points[p].x * k + ring + 5),
                   Math.round(points[p].y * k));
    }
    ctx.restore();
  }

  // ---------- управление ----------
  function reseed(s) {
    seed = (s === undefined) ? (Math.random() * 1e9) | 0 : s;
    location.hash = 'seed=' + seed;
    newCulture(false);
  }

  function sameSeed() { newCulture(true); }

  // Чашку не стирают — её выжигают. После огня остаётся тот же seed и тот же
  // агар: меняется только культура, которую посетитель засевает заново.
  function burnClean() {
    if (state === 'burning') return;

    // Preserve the rendered colony/spore texture for the charred imprint.
    draw();
    var beforeBurn = new Float32Array(lum);

    if (raf) { cancelAnimationFrame(raf); raf = null; }
    for (var i = 0; i < colonies.length; i++) {
      colonies[i].alive = false;
      colonies[i].tips.length = 0;
      if (colonies[i].blobs) colonies[i].blobs.length = 0;
      if (colonies[i].waves) colonies[i].waves.length = 0;
    }
    state = 'burning';
    PM.sound.reset();
    PM.sound.setScene(0, 1.5);
    PM.sound.event('fire');
    PM.burn.start(fields, seed, function () {
      newCulture(false);
      PM.sound.event('rebirth');
    }, beforeBurn, bg);
    PM.ui.sync();
    loop();
  }

  function togglePause() {
    if (state === 'growing' || state === 'mature') {
      resumeTo = state;
      state = 'paused';
      PM.sound.reset();
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      PM.ui.sync();
    } else if (state === 'paused') {
      state = resumeTo;
      PM.ui.sync();
      loop();
    }
  }

  // Экспорт крупнее буфера: апскейл nearest-neighbour, пиксель остаётся
  // квадратным и чётким — это не интерполяция, а честное увеличение.
  function exportPNG() {
    var k = exportScale;
    var big = document.createElement('canvas');
    big.width = W * k;
    big.height = H * k;
    var bx = big.getContext('2d');
    bx.imageSmoothingEnabled = false;
    bx.drawImage(off, 0, 0, W, H, 0, 0, W * k, H * k);

    var link = document.createElement('a');
    link.download = 'petri-' + (W * k) + 'x' + (H * k) + '-' + seed + '.png';
    link.href = big.toDataURL('image/png');
    link.click();
  }

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
    PM.burn.preload();
    fitDisplay();
    if (document.fonts && document.fonts.load) {
      document.fonts.load('11px "Pixelated MS Sans Serif"').then(function () { draw(); });
    }

    canvas.addEventListener('click', function (ev) {
      var b = canvasToBuffer(ev);
      addSpore(b.x, b.y);
    });

    window.addEventListener('resize', function () { fitDisplay(); draw(); });

    PM.ui.init({
      MAX_SPORES: MAX_SPORES,
      reseed: reseed,
      togglePause: togglePause,
      burnClean: burnClean,
      exportPNG: exportPNG,
      getExportScale: function () { return exportScale; },
      setExportScale: function (v) { exportScale = v; },
      exportSize: function () { return (W * exportScale) + '\u00d7' + (H * exportScale); },
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
      dims: function () { return W + '×' + H; },
      sporePan: function (p) { return (p.x / W - 0.5) * 1.7; }
    });

    newCulture(false);
  }

  // Отладка: прогнать N тиков синхронно, минуя rAF
  function step(n) {
    for (var i = 0; i < n && (state === 'growing' || state === 'mature'); i++) {
      PM.growth.tick(fields, colonies, rnd, state === 'mature' ? speed * 0.3 : speed);
      voiceGrowth();
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
