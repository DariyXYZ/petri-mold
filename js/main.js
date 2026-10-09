var PM = PM || {};

PM.app = (function () {
  // Одно разрешение, пропорция референса 569:583. Всё пиксельное в симуляции
  // масштабируется коэффициентом W/192, так что картинка не зависит от него.
  var W = 380, H = 389;

  var MAX_SPORES = 8;
  var MATURE_AT = 7000;    // тик, после которого рост заметно замедляется
  var DISH_SEED = 12345;   // фон чашки не зависит от seed культуры — вид всегда один
  // выбранные наборы штаммов для экрана загрузки (tools/loader-lab.html);
  // крутятся по очереди, счётчик в localStorage
  var LOADER_SEEDS = [667451123, 1289195108, 2148973688];
  var seed = 12345;
  var speed = 3;

  var state = 'inoculate';   // inoculate | growing | mature | paused | burning | done
  var resumeTo = 'growing';  // куда вернуться из паузы
  var exportScale = 4;       // во сколько раз крупнее буфера сохранять PNG
  var points = [], colonies = [], fields = null;
  var rnd = null, nextId = 1;

  var lum, bg, img, off, offCtx, canvas, ctx, dw, dh, raf = null;
  // Звук идёт за картинкой, а не за полем. Клетка, занятая в поле, проступает
  // на экране за edgeFade тиков (у chrysogenum — 190), и раньше прирост клеток
  // читался с задержкой в тиках. На медленном кадре задержка растягивалась:
  // съёмка шла 32 к/с, и звук роста отставал от картинки на 3,5 с. Теперь
  // после каждой отрисовки считаем, сколько пикселей каждой колонии реально
  // заметно на агаре, — всход и рост звучат от этого, при любой частоте кадров.
  var VIS_T = 12;            // отличие от фона, с которого пиксель заметен (шаг палитры ~25, дизер ±16)
  var GERM_PX = 4;           // столько заметных пикселей — колония появилась
  var vis = new Int32Array(64);   // заметные пиксели по id колонии, текущий кадр
  var prevVis = {};          // id -> заметные пиксели на прошлом кадре
  var filmPrev = 0;          // то же для плёнки: её пиксели не принадлежат колонии
  var germinated = {};       // колонии, чей всход уже озвучен
  var germCount = 0;         // сколько всходов уже прозвучало в этой чашке
  var queue = [];            // отложенные события: { at, kind, arch, pan, extra }
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
    var narrow = window.innerWidth <= 760;   // та же граница, что у @media в css
    // справа стоит палитра штаммов, на телефоне она уезжает вниз
    var availW = window.innerWidth - (narrow ? 14 : 262);
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
    // шаг пикселя для интерфейса: кнопки в css считают от него
    document.documentElement.style.setProperty('--k', String(css));
    // толщина линий интерфейса — ровно один пиксель экрана
    document.documentElement.style.setProperty('--dpr', String(window.devicePixelRatio || 1));
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
    prevVis = {};
    filmPrev = 0;
    germinated = {};
    germCount = 0;
    queue = [];
    PM.sound.reset();
    PM.sound.resume();
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

        if (state === 'growing' && fields.tick > MATURE_AT) {
          state = 'mature'; PM.sound.event('mature'); PM.ui.sync();
        } else if (!PM.growth.anyAlive(colonies)) { state = 'done'; PM.sound.reset(); PM.ui.sync(); }
        else if (fields.tick % 20 === 0) PM.ui.sync();
      }
      draw();
      if (state === 'growing' || state === 'mature') voice();
      if (running()) raf = requestAnimationFrame(step);
      else raf = null;
    });
  }

  function later(kind, arch, pan, extra, delay) {
    queue.push({ at: fields.tick + delay, kind: kind, arch: arch, pan: pan, extra: extra });
  }

  function panOf(x) { return (x / W - 0.5) * 1.7; }

  // Голос по кадру: зовётся сразу после draw(), в lum лежит ровно то, что
  // ушло на экран. Всход — первый кадр, где колония заметна. Рост — сколько
  // заметных пикселей прибавилось за кадр, сложенное по виду: колоний бывает
  // больше сотни, голос принадлежит ВИДУ, панораму ведёт самая активная.
  function voice() {
    var n = fields.n, own = fields.owner, film = fields.film;
    // дочерние очаги получают id внутри growth, мимо nextId — берём максимум
    var top = 0;
    for (var m = 0; m < colonies.length; m++) if (colonies[m].id > top) top = colonies[m].id;
    if (vis.length <= top) vis = new Int32Array((top + 1) * 2);
    else vis.fill(0);
    var filmVis = 0;
    for (var i = 0; i < n; i++) {
      var d = lum[i] - bg[i];
      if (d < VIS_T && d > -VIS_T) continue;
      var o = own[i];
      if (o) vis[o]++;
      else if (film[i]) filmVis++;
    }

    var byArch = {};
    for (var k = 0; k < colonies.length; k++) {
      var c = colonies[k], a = c.archetype, veil = c.a.layer === 'veil';
      var now = veil ? filmVis : vis[c.id];
      var was = veil ? filmPrev : (prevVis[c.id] || 0);
      if (!veil) prevVis[c.id] = now;
      if (!germinated[c.id]) {
        if (now < GERM_PX || (veil && !c.cells)) continue;
        germinated[c.id] = 1;
        PM.sound.event('germinate', a, panOf(c.x), germCount++);
      }
      var grow = now > was ? now - was : 0;
      var e = byArch[a];
      if (!e) e = byArch[a] = { rate: 0, lead: c, best: -1 };
      else if (veil) continue;               // плёнка — один слой на всех
      e.rate += grow;
      if (grow > e.best) { e.best = grow; e.lead = c; }
    }
    filmPrev = filmVis;
    // зовём и с нулём: голос сам затихает, когда видимый рост встал
    for (var g in byArch) PM.sound.growth(byArch[g].lead, byArch[g].rate, panOf(byArch[g].lead.x));

    // События картинки из симуляции: надувшаяся капля проступает за ~14 тиков.
    var ev = fields.events;
    for (var q = 0; q < ev.length; q++) {
      var e2 = ev[q];
      if (e2.kind === 'blob') later('blob', e2.arch, panOf(e2.x), e2.r / (W / 192), 14);
    }
    ev.length = 0;
    for (var j = queue.length - 1; j >= 0; j--) {
      if (queue[j].at > fields.tick) continue;
      var qe = queue[j];
      PM.sound.event(qe.kind, qe.arch, qe.pan, qe.extra);
      queue.splice(j, 1);
    }

    // Подклад следует за заполнением чашки: чем больше заросло, тем полнее
    // звучит. Считаем редко — сцена всё равно меняется секундами.
    if (fields.tick % 30 === 0) PM.sound.setScene(coverage(), 4);
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
    PM.glitch.apply(ctx, dw, dh, dw / W);
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
    PM.sound.resume();
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
      PM.sound.pause();
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      PM.ui.sync();
    } else if (state === 'paused') {
      state = resumeTo;
      PM.sound.resume();
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
    // в светлой теме сохраняем то, что видно на экране, — негатив
    if (document.documentElement.classList.contains('light')) {
      var id = bx.getImageData(0, 0, big.width, big.height), d = id.data;
      for (var i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
      }
      bx.putImageData(id, 0, 0);
    }

    var link = document.createElement('a');
    link.download = 'petri-' + (W * k) + 'x' + (H * k) + '-' + seed + '.png';
    link.href = big.toDataURL('image/png');
    link.click();
    flash();
  }

  // Вспышка на сохранении: тема на миг переворачивается и возвращается,
  // как щелчок затвора. Кнопка темы при этом не трогается.
  function flash() {
    var root = document.documentElement;
    setTimeout(function () {
      root.classList.toggle('light');
      setTimeout(function () { root.classList.toggle('light'); }, 200);
    }, 200);
  }

  function redrawBackground() { bakeBackground(); draw(); }

  function canvasToBuffer(ev) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / r.width * W,
      y: (ev.clientY - r.top) / r.height * H
    };
  }

  function nextLoaderSeed() {
    var i = 0;
    try {
      i = (parseInt(localStorage.getItem('pm-loader'), 10) || 0) % LOADER_SEEDS.length;
      localStorage.setItem('pm-loader', String(i + 1));
    } catch (e) { i = (Math.random() * LOADER_SEEDS.length) | 0; }
    return LOADER_SEEDS[i];
  }

  function init() {
    canvas = document.getElementById('stage');
    ctx = canvas.getContext('2d');

    var h = location.hash.match(/seed=(\d+)/);
    if (h) seed = parseInt(h[1], 10);

    PM.loader.start({ seed: nextLoaderSeed() });
    allocate();
    PM.burn.preload();
    fitDisplay();
    if (document.fonts && document.fonts.load) {
      document.fonts.load('11px "Pixelated MS Sans Serif"').then(function () { draw(); });
    }

    PM.glitch.attach(canvas, draw, W);

    canvas.addEventListener('click', function (ev) {
      var b = canvasToBuffer(ev);
      addSpore(b.x, b.y);
    });

    window.addEventListener('resize', function () { fitDisplay(); draw(); });

    PM.ui.init({
      MAX_SPORES: MAX_SPORES,
      bufferW: W,
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

    // Превью штаммов — двенадцать прогонов симуляции, по 50–100 мс каждый.
    // Печём по одному между кадрами, чтобы очаг на линии загрузки полз, а
    // не стоял; прогресс — доля готовых плиток.
    var tiles = PM.ui.tiles(), ti = 0;
    (function bakeNext() {
      if (ti < tiles.length) {
        tiles[ti]._paint();
        ti++;
        PM.loader.progress(ti / tiles.length);
        setTimeout(bakeNext, 0);
      } else {
        // через секунду после того, как открылась чашка, — короткий сбой
        PM.loader.done(function () { draw(); setTimeout(function () { PM.glitch.run(); }, 1000); });
      }
    })();
  }

  // Отладка: прогнать N тиков синхронно, минуя rAF
  function step(n) {
    for (var i = 0; i < n && (state === 'growing' || state === 'mature'); i++) {
      PM.growth.tick(fields, colonies, rnd, state === 'mature' ? speed * 0.3 : speed);
      draw();
      voice();
      if (state === 'growing' && fields.tick > MATURE_AT) state = 'mature';
      else if (!PM.growth.anyAlive(colonies)) state = 'done';
    }
    PM.ui.sync();
    draw();
    return { tick: fields.tick, state: state,
             cells: colonies.map(function (c) { return c.archetype + ':' + c.cells; }) };
  }

  return { init: init, step: step, redraw: draw, glitch: function (ms) { PM.glitch.run(ms); },
           debug: function () { return { fields: fields, colonies: colonies, state: state }; } };
})();

window.addEventListener('DOMContentLoaded', PM.app.init);
