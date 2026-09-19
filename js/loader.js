var PM = PM || {};

// Экран загрузки. Чёрное поле, короткая белая линия, по ней слева направо
// идёт волна роста: на линии посеяны споры разных штаммов из коллекции, и
// каждая прорастает, когда до неё доходит фронт. Это та же симуляция, что
// в чашке, на узкой полосе поля — колонии настоящие, со своей текстурой.
// Позади фронта масса растворяется обратно в линию, поэтому живой остаётся
// только один участок.
//
// Таймлайн: пауза в начале (край успевает прорасти), проход фронта, пауза в
// конце. Положение фронта не обгоняет прогресс загрузки (превью штаммов
// печутся по одному) и не идёт быстрее своего времени.
//
// start(opts): { seed, loop, onDone } — seed фиксирует набор и порядок
// штаммов (см. tools/loader-lab.html), loop — крутить заново без конца.
PM.loader = (function () {
  var W = 110, H = 56, MID = 28;
  var TOTAL = 900;                       // тиков симуляции на весь таймлайн
  var HOLD0 = 1100, MOVE = 4600, HOLD1 = 1300;
  var D = HOLD0 + MOVE + HOLD1;
  var A = HOLD0 / D, B = HOLD1 / D;      // доли пауз в таймлайне
  var box = null, cv = null, ctx = null, img = null, lum = null, base = null;
  var line = null;
  var f = null, colonies = [], rnd = null, opts = {};
  var u = 0, target = 0, t0 = 0, finished = false, onDone = null;

  function start(o) {
    if (box) return;
    opts = o || {};
    u = 0; target = 0; finished = false; onDone = opts.onDone || null;
    box = document.createElement('div');
    box.id = 'loader';
    var wrap = document.createElement('div');
    wrap.className = 'strip';
    line = document.createElement('i');
    line.className = 'line';
    cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    ctx = cv.getContext('2d');
    img = ctx.createImageData(W, H);
    lum = new Float32Array(W * H);
    wrap.appendChild(line);
    wrap.appendChild(cv);
    box.appendChild(wrap);
    document.body.appendChild(box);
    fit();
    window.addEventListener('resize', fit);
    seed(opts.seed);
    t0 = performance.now();
    requestAnimationFrame(tick);
  }

  // тот же шаг пикселя, что у чашки; линия — ровно один пиксель экрана
  function fit() {
    if (!cv) return;
    var k = Math.max(1, Math.floor(Math.min(window.innerWidth * 0.8 / W, 3)));
    cv.style.width = (W * k) + 'px';
    cv.style.height = (H * k) + 'px';
    line.style.top = Math.round((MID + 0.5) * k) + 'px';
  }

  // Полоса поля: маска — вся полоса, стенки чашки нет. Споры — штаммы из
  // коллекции в случайном порядке, впритык, с общим «стоп» у стыков: колонии
  // врастают друг в друга и полоса читается одной массой. Каждая прорастает,
  // когда до неё дойдёт фронт; крайние — маленькие, но прорастают в паузах.
  function seed(s) {
    s = (s === undefined || s === null) ? ((Date.now() & 0xffff) ^ 0x5eed) : (s >>> 0);
    rnd = PM.rng.mulberry32(s);
    f = PM.fields.create(W, H, s, PM.dish.GEO);
    f.scale = 1;
    f.seedBase = s;
    f.noWall = true;
    // Поле — веретено: у концов узкое, к середине широкое, край чуть
    // волнистый. Колонии растут до его границы, поэтому масса сама
    // получается тонкой на концах и полной в середине.
    for (var i = 0; i < f.n; i++) {
      var x = i % W, y = (i / W) | 0;
      var env = 3 + 23 * Math.pow(Math.sin(Math.PI * (x + 0.5) / W), 0.7)
              + (PM.rng.fbm(x / 9, 0.5, s + 17, 2) - 0.5) * 5;
      f.mask[i] = (x > 0 && x < W - 1 && Math.abs(y - MID) < env) ? 1 : 0;
    }
    var pool = ['colony', 'target', 'starburst', 'crackle', 'hyphal',
                'dendrite', 'speckle', 'bubble', 'crater'];
    for (var k = pool.length - 1; k > 0; k--) {
      var j = (rnd() * (k + 1)) | 0, t = pool[k]; pool[k] = pool[j]; pool[j] = t;
    }
    // у краёв — виды с фронтом: кончики гиф упираются в границу полосы и
    // гибнут, и такой край не прорастает
    var frontier = ['colony', 'target', 'speckle', 'crackle', 'dendrite', 'starburst'];
    colonies = [];
    var n = 9;
    for (var q = 0; q < n; q++) {
      var edge = q === 0 || q === n - 1;
      var fx = edge ? (q === 0 ? 5 : W - 6)
                    : 10 + (W - 20) * (q - 0.5) / (n - 2) + (rnd() - 0.5) * 6;
      var arch = edge ? frontier[(rnd() * frontier.length) | 0] : pool[q % pool.length];
      var c = PM.growth.makeColony(q + 1, Math.round(fx), MID + ((rnd() * 5) | 0) - 2,
                                   rnd, s, arch, 1);
      c.brood = 0; c.wDrift = 0; c.greed = 1.3;
      c.a = Object.create(c.a); c.a.satChance = 0;     // без спутников и потомков
      c.collisionMode = 'stop';
      c.inhibition = 0.2;
      c.maxCells = edge ? Math.round(70 + rnd() * 60) : Math.round(260 + rnd() * 240);
      // тик, на котором фронт доходит до x, минус фора на прорастание
      var at = A + (1 - A - B) * (c.x + 30) / (W + 60);
      c.delay = q === 0 ? 0 : Math.max(0, Math.round(at * TOTAL) - 110);
      PM.growth.inoculate(c, f, rnd);
      colonies.push(c);
    }
    base = new Float32Array(W * H);
  }

  function progress(v) { target = Math.max(target, Math.min(1, v)); }

  function done(cb) { finished = true; if (cb) onDone = cb; target = 1; }

  function tick(now) {
    // u — положение на таймлайне 0..1: пауза, проход, пауза. Загрузка
    // держит его: пока превью не готовы, фронт не уходит дальше доли target.
    var byTime = Math.min(1, (now - t0) / D);
    var byLoad = (finished || opts.loop) ? 1 : A + (1 - A - B) * target;
    var goal = Math.min(byTime, byLoad);
    u += (goal - u) * 0.1;

    var want = Math.round(u * TOTAL);
    var guard = 40;
    while (f.tick < want && guard-- > 0) PM.growth.tick(f, colonies, rnd, 8);

    draw();
    if (u > 0.995 && (finished || opts.loop)) {
      if (opts.loop) {
        var keep = opts;
        stop();
        start(keep);
        return;
      }
      box.classList.add('out');
      setTimeout(function () {
        stop();
        if (onDone) onDone();
      }, 450);
      return;
    }
    requestAnimationFrame(tick);
  }

  function stop() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    window.removeEventListener('resize', fit);
    box = null; f = null; colonies = [];
  }

  function draw() {
    lum.set(base);
    PM.scene.overlay(lum, f, colonies);
    // непроросшие споры не показываем: точки вдоль линии выдавали бы посев
    for (var q = 0; q < colonies.length; q++) {
      var c = colonies[q];
      if (f.tick < c.delay) lum[Math.round(c.y) * W + Math.round(c.x)] = 0;
    }
    // Позади фронта масса притухает, но остаётся: вес 1 у фронта, 0.45 в
    // сотне пикселей за ним. Впереди колонии ещё не проросли сами.
    var p = Math.max(0, Math.min(1, (u - A) / (1 - A - B)));
    var front = -30 + (W + 60) * p;
    for (var x = 0; x < W; x++) {
      var back = front - x;
      var w = back <= 24 ? 1 : Math.max(0.45, 1 - (back - 24) / 100);
      if (w >= 1) continue;
      for (var y = 0; y < H; y++) lum[y * W + x] *= w;
    }
    PM.render.blit(lum, W, H, img);
    for (var i = 0; i < W * H; i++) if (lum[i] <= 1) img.data[i * 4 + 3] = 0;
    ctx.putImageData(img, 0, 0);
  }

  function dbg() {
    return { u: u, tick: f ? f.tick : -1,
             cells: colonies.map(function (c) { return c.archetype + ':' + c.cells + '@' + c.x + 'd' + c.delay; }) };
  }

  return { start: start, stop: stop, progress: progress, done: done, dbg: dbg };
})();
