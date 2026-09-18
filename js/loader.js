var PM = PM || {};

// Экран загрузки. Чёрное поле, короткая белая линия, по ней слева направо
// идёт волна роста: на линии посеяны споры разных штаммов из коллекции, и
// каждая прорастает, когда до неё доходит фронт. Это та же симуляция, что
// в чашке, на узкой полосе поля — колонии настоящие, со своей текстурой.
// Позади фронта масса растворяется обратно в линию, поэтому живой остаётся
// только один участок. Положение фронта — прогресс загрузки (превью
// штаммов печутся по одному), но не быстрее MIN_MS.
PM.loader = (function () {
  var W = 220, H = 64, MID = 32;
  var TOTAL = 640;                       // тиков симуляции на весь проход
  var MIN_MS = 5200;
  var box = null, cv = null, ctx = null, img = null, lum = null, base = null;
  var f = null, colonies = [], rnd = null;
  var p = 0, target = 0, t0 = 0, finished = false, onDone = null;

  function start() {
    if (box) return;
    p = 0; target = 0; finished = false; onDone = null;
    box = document.createElement('div');
    box.id = 'loader';
    cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    ctx = cv.getContext('2d');
    img = ctx.createImageData(W, H);
    lum = new Float32Array(W * H);
    box.appendChild(cv);
    document.body.appendChild(box);
    fit();
    window.addEventListener('resize', fit);
    seed();
    t0 = performance.now();
    requestAnimationFrame(tick);
  }

  // тот же шаг пикселя, что у чашки: линия должна лечь в её сетку
  function fit() {
    if (!cv) return;
    var k = Math.max(1, Math.floor(Math.min(window.innerWidth * 0.8 / W, 3)));
    cv.style.width = (W * k) + 'px';
    cv.style.height = (H * k) + 'px';
  }

  // Полоса поля: маска — вся полоса, стенки чашки нет. Споры — шесть разных
  // штаммов из коллекции в случайном порядке, каждая с задержкой по своей
  // координате: прорастает, когда фронт дойдёт.
  function seed() {
    var s = (Date.now() & 0xffff) ^ 0x5eed;
    rnd = PM.rng.mulberry32(s);
    f = PM.fields.create(W, H, s, PM.dish.GEO);
    f.scale = 1;
    f.seedBase = s;
    f.noWall = true;
    for (var i = 0; i < f.n; i++) {
      var x = i % W, y = (i / W) | 0;
      f.mask[i] = (x > 1 && x < W - 2 && y > 1 && y < H - 2) ? 1 : 0;
    }
    var pool = ['colony', 'target', 'starburst', 'crackle', 'hyphal',
                'dendrite', 'speckle', 'bubble', 'crater'];
    for (var k = pool.length - 1; k > 0; k--) {
      var j = (rnd() * (k + 1)) | 0, t = pool[k]; pool[k] = pool[j]; pool[j] = t;
    }
    colonies = [];
    var n = 6, margin = 22, span = W - margin * 2;
    for (var q = 0; q < n; q++) {
      var fx = margin + span * (q + 0.5) / n + (rnd() - 0.5) * 10;
      var c = PM.growth.makeColony(q + 1, Math.round(fx), MID + ((rnd() * 5) | 0) - 2,
                                   rnd, s, pool[q], 1);
      c.brood = 0; c.wDrift = 0; c.greed = 1.15;
      c.maxCells = Math.round(220 + rnd() * 260);
      // фронт доходит до x при p = (x + 30) / (W + 60); тик = p · TOTAL
      c.delay = Math.round((c.x + 30) / (W + 60) * TOTAL) - 40;
      PM.growth.inoculate(c, f, rnd);
      colonies.push(c);
    }
    base = new Float32Array(W * H);
    for (var x2 = 0; x2 < W; x2++) base[MID * W + x2] = 200;
  }

  function progress(v) { target = Math.max(target, Math.min(1, v)); }

  function done(cb) { finished = true; onDone = cb; target = 1; }

  function tick(now) {
    var el = now - t0;
    // фронт не обгоняет время: даже при мгновенной загрузке проход занимает
    // не меньше MIN_MS
    var cap = Math.min(1, el / MIN_MS);
    var goal = Math.min(target, cap);
    p += (goal - p) * 0.08;

    // симуляция идёт в ногу с фронтом
    var want = Math.round(p * TOTAL);
    var guard = 40;
    while (f.tick < want && guard-- > 0) PM.growth.tick(f, colonies, rnd, 8);

    draw();
    if (finished && p > 0.985) {
      box.classList.add('out');
      setTimeout(function () {
        if (box && box.parentNode) box.parentNode.removeChild(box);
        box = null; f = null; colonies = [];
        if (onDone) onDone();
      }, 450);
      return;
    }
    requestAnimationFrame(tick);
  }

  function draw() {
    lum.set(base);
    PM.scene.overlay(lum, f, colonies);
    // Позади фронта масса растворяется в линию: вес 1 у фронта, ноль в
    // сотне пикселей за ним. Впереди колонии ещё не проросли сами.
    var front = -30 + (W + 60) * p;
    for (var x = 0; x < W; x++) {
      var back = front - x;
      var w = back <= 36 ? 1 : Math.max(0, 1 - (back - 36) / 70);
      if (w >= 1) continue;
      for (var y = 0; y < H; y++) {
        var i = y * W + x;
        lum[i] = base[i] + (lum[i] - base[i]) * w;
      }
    }
    PM.render.blit(lum, W, H, img);
    ctx.putImageData(img, 0, 0);
  }

  return { start: start, progress: progress, done: done };
})();
