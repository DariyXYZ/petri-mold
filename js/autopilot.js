var PM = PM || {};

// Автономный режим для галереи (страница auto/): без посетителя. Цикл —
// пинцет сам приносит споры и плавно опускает их в чашку, культура растёт,
// через какое-то время чашку выжигают, и всё начинается заново с новым сидом.
// Интерфейса нет: на экране только чашка и пинцет, как на отпечатке.
//
// Управляет тем же приложением, что и посетитель: addSpore / start /
// burnClean из main.js. Своего состояния симуляции здесь нет.
PM.autopilot = (function () {
  var api = null;

  // тайминги, мс
  var MOVE_MIN = 1300, MOVE_MAX = 2600;   // проход пинцета к точке
  var HOVER_MIN = 350, HOVER_MAX = 900;   // замер над точкой перед выпуском
  var GAP_MIN = 300, GAP_MAX = 1100;      // после выпуска, до следующей споры
  var BEFORE_GROW = 1600;                 // пинцет ушёл — пауза — рост
  var HOLD_MATURE_MIN = 25000, HOLD_MATURE_MAX = 45000;  // любуемся зрелой чашкой
  var HOLD_DONE = 12000;                  // рост встал сам — держим и жжём
  var GROW_CAP = 200000;                  // предохранитель на весь рост
  var AFTER_BURN_MIN = 2500, AFTER_BURN_MAX = 5000;  // пустая чашка после огня

  var SPORES_MIN = 3, SPORES_MAX = 7;
  var INTRO_EVERY = 5;                    // каждые 5 чашек — заставка, как при открытии
  var cycles = 0;
  var MIN_GAP_PX = 34;                    // споры не в куче (пиксели буфера)

  var pos = { x: 0, y: 0 };               // где пинцет сейчас (экранные точки)
  var timer = 0, raf = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function wait(ms, fn) { clearTimeout(timer); timer = setTimeout(fn, ms); }

  // Точка за краем экрана справа, откуда пинцет входит и куда уходит.
  function offstage() {
    return { x: window.innerWidth + 60, y: rand(0.2, 0.8) * window.innerHeight };
  }

  // Случайная точка агара, не слишком близко к уже посеянным и к стенке.
  function pickPoint(taken) {
    for (var tries = 0; tries < 400; tries++) {
      var p = api.randomAgar();
      if (!p) continue;
      var ok = true;
      for (var i = 0; i < taken.length; i++) {
        if (Math.hypot(taken[i].x - p.x, taken[i].y - p.y) < MIN_GAP_PX) { ok = false; break; }
      }
      if (ok) return p;
    }
    return api.randomAgar();
  }

  // Плавный проход по дуге: ease-in-out, лёгкий изгиб траектории и чуть
  // заметная дрожь руки — иначе движение читается как механика.
  function glide(to, ms, done) {
    cancelAnimationFrame(raf);
    var from = { x: pos.x, y: pos.y };
    var dx = to.x - from.x, dy = to.y - from.y;
    var len = Math.hypot(dx, dy) || 1;
    var bend = rand(-0.18, 0.18) * len;      // смещение середины дуги
    var nx = -dy / len, ny = dx / len;
    var t0 = performance.now(), ph = rand(0, 6.28);
    raf = requestAnimationFrame(function step(now) {
      var u = Math.min(1, (now - t0) / ms);
      var e = 0.5 - 0.5 * Math.cos(Math.PI * u);
      var arc = Math.sin(Math.PI * e) * bend;
      var shake = (1 - u) * 1.2;
      pos.x = from.x + dx * e + nx * arc + Math.sin(now / 90 + ph) * shake;
      pos.y = from.y + dy * e + ny * arc + Math.cos(now / 110 + ph) * shake;
      PM.cursor.drive(pos.x, pos.y);
      if (u < 1) raf = requestAnimationFrame(step);
      else { pos.x = to.x; pos.y = to.y; PM.cursor.drive(pos.x, pos.y); done(); }
    });
  }

  // ---------- цикл ----------
  function cycle() {
    if (api.getState() !== 'inoculate') { wait(500, cycle); return; }
    var n = Math.round(rand(SPORES_MIN, SPORES_MAX + 0.49));
    var taken = [];
    pos = offstage();
    PM.cursor.drive(pos.x, pos.y);
    PM.cursor.show(true);

    (function next(i) {
      if (i >= n) {
        glide(offstage(), rand(MOVE_MIN, MOVE_MAX), function () {
          PM.cursor.show(false);
          wait(BEFORE_GROW, grow);
        });
        return;
      }
      var p = pickPoint(taken);
      taken.push(p);
      var to = api.toScreen(p.x, p.y);
      glide(to, rand(MOVE_MIN, MOVE_MAX), function () {
        wait(rand(HOVER_MIN, HOVER_MAX), function () {
          PM.cursor.release(pos.x, pos.y);
          api.addSpore(p.x, p.y);
          wait(rand(GAP_MIN, GAP_MAX), function () { next(i + 1); });
        });
      });
    })(0);
  }

  function grow() {
    api.start();
    var t0 = performance.now(), matureAt = 0;
    var hold = rand(HOLD_MATURE_MIN, HOLD_MATURE_MAX);
    (function watch() {
      var st = api.getState(), now = performance.now();
      if (st === 'mature' && !matureAt) matureAt = now;
      var burnNow = (now - t0 > GROW_CAP)
        || (matureAt && now - matureAt > hold);
      if (st === 'done') { wait(HOLD_DONE, burn); return; }
      if (burnNow) { burn(); return; }
      wait(1000, watch);
    })();
  }

  function burn() {
    api.burnClean();
    // огонь сам вернёт чашку в 'inoculate' (новый сид — в main.js)
    (function waitClean() {
      if (api.getState() !== 'inoculate') { wait(400, waitClean); return; }
      cycles++;
      if (cycles % INTRO_EVERY === 0) {
        wait(1500, function () { api.intro(function () { wait(2000, cycle); }); });
      } else {
        wait(rand(AFTER_BURN_MIN, AFTER_BURN_MAX), cycle);
      }
    })();
  }

  function run(a) {
    api = a;
    wait(2000, cycle);
  }

  return { run: run };
})();
