var PM = PM || {};

// Экран загрузки. Чёрное поле, белая линия во всю ширину, по ней слева
// направо идёт очаг плесени: перед ним линия чистая, под ним нарастает
// пушистая масса, позади она сходит обратно в линию. Положение очага —
// прогресс загрузки (превью штаммов печутся по одному). Рисуется в буфере
// с тем же шагом пикселя и тем же дизером, что чашка.
PM.loader = (function () {
  var W = 380, H = 44, MID = 22;
  var box = null, cv = null, ctx = null, img = null, lum = null;
  var p = 0, target = 0, raf = null, t0 = 0, finished = false, onDone = null;
  var MIN_MS = 2400;                     // меньше — очаг не успевает пройти

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
    t0 = performance.now();
    raf = requestAnimationFrame(tick);
  }

  // тот же шаг пикселя, что у чашки: линия должна лечь в её сетку
  function fit() {
    if (!cv) return;
    var k = Math.max(1, Math.floor(Math.min(window.innerWidth * 0.8 / W, 4)));
    cv.style.width = (W * k) + 'px';
    cv.style.height = (H * k) + 'px';
  }

  function progress(v) { target = Math.max(target, Math.min(1, v)); }

  function done(cb) { finished = true; onDone = cb; target = 1; }

  function tick(now) {
    var el = now - t0;
    // очаг не обгоняет время: даже при мгновенной загрузке проходит линию
    // не быстрее MIN_MS
    var cap = Math.min(1, el / MIN_MS);
    var goal = Math.min(target, cap);
    p += (goal - p) * 0.12;
    draw(p, now);
    if (finished && p > 0.985) {
      draw(1, now);
      box.classList.add('out');
      setTimeout(function () {
        if (box && box.parentNode) box.parentNode.removeChild(box);
        box = null;
        if (onDone) onDone();
      }, 450);
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function draw(pr, now) {
    var ss = PM.rng.smoothstep, fbm = PM.rng.fbm;
    var front = -30 + (W + 60) * pr;         // заходит слева за край, уходит справа
    var tm = now / 700;
    for (var i = 0; i < W * H; i++) lum[i] = 0;

    for (var x = 0; x < W; x++) {
      var dx = x - front;
      // асимметричный колокол: впереди узкий склон, позади длинный
      var env = Math.exp(-(dx * dx) / (dx > 0 ? 2 * 9 * 9 : 2 * 34 * 34));
      var wob = fbm(x / 7 + tm * 0.6, 0.3, 4242, 2);
      var h = 17 * env * (0.55 + 0.9 * wob);          // высота массы над линией
      var h2 = 17 * env * (0.55 + 0.9 * fbm(x / 7 - tm * 0.4, 1.7, 4343, 2));
      for (var y = 0; y < H; y++) {
        var i = y * W + x;
        var d = y - MID;
        var lim = d < 0 ? h : h2;
        var ad = Math.abs(d);
        if (ad < 0.5) { lum[i] = 200; continue; }   // сама линия
        if (lim < 0.6 || ad > lim + 2) continue;
        // кромка рваная: сравниваем расстояние с высотой, размытой шумом
        var m = fbm(x / 3.2, y / 3.2 + tm * 0.2, 777, 2);
        var edge = ss(lim + 1.5, lim - 2.5, ad + (m - 0.5) * 3);
        if (edge <= 0) continue;
        // бархат: тело серое, к линии темнее, пух по краю светлее
        var body = 96 + 40 * m;
        var rim = ss(lim - 3, lim, ad) * 95;
        lum[i] = (body + rim) * edge;
      }
    }
    PM.render.blit(lum, W, H, img);
    ctx.putImageData(img, 0, 0);
  }

  return { start: start, progress: progress, done: done };
})();
