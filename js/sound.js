var PM = PM || {};

// Озвучка. Ориентир — саунд-дизайн медиаинсталляций: глубокий низ, медленно
// плывущий пэд, воздух большого зала, редкие стеклянные события, и всё это
// в долгом реверберационном хвосте. Ничего не «играет» — всё дышит.
//
// Слои снизу вверх:
//   bed   — суб-бас: две почти совпадающие частоты, медленное биение
//   pad   — пять голосов на пентатонике, у каждого свой период дыхания
//           (несоизмеримые секунды — фазы никогда не сходятся);
//           изредка голос переползает на соседнюю ступень
//   air   — шум через две плавающие полосы, слева и справа независимо
//   grain — события роста: шум через резонанс плюс синусная опора,
//           окно на косинусах вместо ломаной огибающей — ни щелчков, ни «капель»
//
// Шины: сухая, свёрточный реверб 6 с и ленточная задержка с фильтром в
// обратной связи и лёгким плаванием времени. Задержка заодно кормит реверб.
//
// Сцена (setScene) — доля заросшей чашки. С ней открывается фильтр пэда,
// поднимается низ и воздух: пустая чашка почти беззвучна, заросшая гудит.
//
// Сэмплов нет намеренно: страница должна открываться с диска, а file:// не
// даёт подгружать аудиофайлы. Библиотеки (Tone.js и подобные) не дают ничего
// сверх нативных узлов, а тянут сотни килобайт и ту же проблему с file://.
PM.sound = (function () {

  // ля-минорная пентатоника: любое сочетание видов созвучно
  var A = 55;
  function n(semi, oct) { return A * Math.pow(2, oct + semi / 12); }
  var P = {
    A0: n(0, -1),
    A1: n(0, 0), A2: n(0, 1), C3: n(3, 1), D3: n(5, 1), E3: n(7, 1),
    G3: n(10, 1), A3: n(0, 2), C4: n(3, 2), D4: n(5, 2), E4: n(7, 2),
    G4: n(10, 2), A4: n(0, 3), C5: n(3, 3), E5: n(7, 3)
  };

  // Голос вида. q — острота резонанса (материал), grains — сколько зёрен в
  // облаке, air — доля шума над тоном, attack — насколько мягко входит звук.
  var VOICE = {
    // базовая плесень: тёплый деревянный резонанс, медленное дыхание
    colony:   { freq: P.D3, q: 9,  grains: 4, spread: 380, dur: 2.4, attack: 0.5,
                air: 0.85, gain: 0.19, every: 900 },
    // мелкая россыпь: сухие капли высоко, почти без тона
    dots:     { freq: P.E5, q: 16, grains: 3, spread: 220, dur: 0.9, attack: 0.08,
                air: 0.95, gain: 0.06, every: 420 },
    // мишень: низкий гулкий обертон, как удар по стеклу через воду
    target:   { freq: P.A2, q: 6,  grains: 3, spread: 600, dur: 4.6, attack: 0.9,
                air: 0.6,  gain: 0.2, every: 1600 },
    // лучи: облако зёрен, расходящееся по высоте
    starburst:{ freq: P.A4, q: 13, grains: 7, spread: 700, dur: 1.6, attack: 0.12,
                air: 0.8,  gain: 0.1, every: 1300, arp: 1 },
    // пузыри: восходящий резонанс, как воздух в жидкости
    bubble:   { freq: P.A3, q: 14, grains: 2, spread: 160, dur: 1.5, attack: 0.1,
                air: 0.7,  gain: 0.14, every: 800, rise: 1 },
    // икра: очень мелкие частые капли
    roe:      { freq: P.C5, q: 18, grains: 4, spread: 180, dur: 0.7, attack: 0.05,
                air: 1.0,  gain: 0.056, every: 480 },
    // ветвление: короткий сухой треск дерева
    dendrite: { freq: P.G3, q: 7,  grains: 3, spread: 260, dur: 1.1, attack: 0.07,
                air: 1.0,  gain: 0.088, every: 700 },
    // кольцо-призрак: длинный низкий выдох
    crater:   { freq: P.A1, q: 4,  grains: 2, spread: 900, dur: 6.5, attack: 2.0,
                air: 0.55, gain: 0.21, every: 2800 },
    // трещины: сухой деревянный треск, а не шорох
    crackle:  { freq: P.D3, q: 11, grains: 4, spread: 240, dur: 0.8, attack: 0.05,
                air: 0.9,  gain: 0.062, every: 640 },
    // крап: мягкий шелест с опорой на ноту
    speckle:  { freq: P.C4, q: 12, grains: 3, spread: 460, dur: 1.4, attack: 0.3,
                air: 0.85, gain: 0.048, every: 800 },
    // гифы: тихий высокий призвук
    hyphal:   { freq: P.E4, q: 14, grains: 3, spread: 560, dur: 2.0, attack: 0.6,
                air: 0.8,  gain: 0.038, every: 880 },
    // плёнка: непрерывный подклад
    film:     { freq: P.A1, drone: 1, gain: 0.075 }
  };

  var ctx = null, master = null, revb = null, dly = null, dlyIn = null, outNode = null;
  var noiseBuf = null, drones = {}, last = {};
  var live = 0, MAX_VOICES = 20;
  var activeGrains = new Set();
  var enabled = true, started = false;    // включён сразу, ждём только жеста
  var volume = 1.0, density = 1.0;
  var pad = null, bed = null, air = null;
  var scene = 0;                          // 0 — пустая чашка, 1 — заросла

  // ---------- граф ----------

  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }

    master = ctx.createGain();
    master.gain.value = 0;

    // подрезаем сумму ДО насыщения, иначе кривая всё время в изгибе
    var pre = ctx.createGain();
    pre.gain.value = 0.42;

    // Мягкое насыщение вместо компрессора: у него нет ни атаки, ни
    // восстановления, поэтому нечему «дышать» на всплесках.
    var shaper = ctx.createWaveShaper();
    shaper.curve = softCurve(2.2);
    shaper.oversample = '2x';

    // страховочный лимитер, почти всегда бездействует
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -1;
    lim.knee.value = 14;
    lim.ratio.value = 2.5;
    lim.attack.value = 0.006;
    lim.release.value = 0.25;

    // Верх подрезаем: звук уходит «в глубину кадра». Резкий верх — половина
    // ощущения дешёвой синтетики. Но не ниже 5 кГц: воздух должен остаться.
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    lp.Q.value = 0.5;

    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 24;

    master.connect(pre); pre.connect(shaper); shaper.connect(lim);
    lim.connect(lp); lp.connect(hp);
    hp.connect(ctx.destination);
    outNode = hp;

    // Долгий реверб — главный носитель пространства. Импульс с предзадержкой:
    // сначала тишина, потом хвост, отчего появляется ощущение зала.
    revb = ctx.createConvolver();
    revb.buffer = impulse(6.0, 2.4, 0.024);
    var wetRev = ctx.createGain();
    wetRev.gain.value = 0.42;
    revb.connect(wetRev); wetRev.connect(master);

    // Ленточная задержка: фильтр в обратной связи темнит каждый повтор,
    // медленное плавание времени размывает их. Повторы уходят и в реверб.
    dlyIn = ctx.createGain();
    dly = ctx.createDelay(2.0);
    dly.delayTime.value = 0.46;
    var fbLP = ctx.createBiquadFilter();
    fbLP.type = 'lowpass'; fbLP.frequency.value = 1500; fbLP.Q.value = 0.4;
    var fb = ctx.createGain();
    fb.gain.value = 0.44;
    dlyIn.connect(dly); dly.connect(fbLP); fbLP.connect(fb); fb.connect(dly);
    var wob = ctx.createOscillator();
    wob.frequency.value = 0.09;
    var wobG = ctx.createGain();
    wobG.gain.value = 0.007;
    wob.connect(wobG); wobG.connect(dly.delayTime); wob.start();
    var wetDly = ctx.createGain();
    wetDly.gain.value = 0.22;
    dly.connect(wetDly); wetDly.connect(master);
    var dlyToRev = ctx.createGain();
    dlyToRev.gain.value = 0.5;
    dly.connect(dlyToRev); dlyToRev.connect(revb);

    noiseBuf = noise(2.5);
    buildBed();
    buildPad();
    buildAir();
    applyScene(0, 0.1);
    return true;
  }

  // tanh-кривая: около нуля прозрачна, к краям плавно заваливается
  function softCurve(amount) {
    var n = 2048, curve = new Float32Array(n), k = Math.tanh(amount);
    for (var i = 0; i < n; i++) {
      var x = i * 2 / n - 1;
      curve[i] = Math.tanh(x * amount) / k;
    }
    return curve;
  }

  // Импульс зала: декоррелированный шум с экспоненциальным спадом. Однополюсный
  // фильтр закрывается по ходу хвоста — конец темнее начала, как в помещении
  // с мягкими стенами. Каналы независимы, отсюда ширина.
  function impulse(sec, decay, pre) {
    var sr = ctx.sampleRate;
    var len = Math.floor(sr * sec);
    var gap = Math.floor(sr * (pre || 0));
    var buf = ctx.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var lastV = 0;
      for (var i = 0; i < len; i++) {
        if (i < gap) { d[i] = 0; continue; }
        var t = (i - gap) / (len - gap);
        var k = 0.6 + 0.32 * t;          // фильтр закрывается к концу
        var raw = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        lastV = lastV * k + raw * (1 - k);
        d[i] = lastV;
      }
    }
    return buf;
  }

  // Шум для петли. Сгенерированный «в лоб» буфер щёлкает на каждом обороте:
  // последний сэмпл и первый не стыкуются. Лечится кроссфейдом: голова буфера
  // смешивается с продолжением хвоста, переход через стык непрерывен.
  function noise(sec) {
    var sr = ctx.sampleRate;
    var len = Math.floor(sr * sec);
    var fade = Math.floor(sr * 0.12);

    var raw = new Float32Array(len + fade);
    var v = 0;
    for (var i = 0; i < raw.length; i++) {
      // окрашенный шум: ближе к воздуху, чем к белому шипению
      v = v * 0.72 + (Math.random() * 2 - 1) * 0.28;
      raw[i] = v;
    }

    var buf = ctx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    for (var j = 0; j < len; j++) d[j] = raw[j];
    for (var k = 0; k < fade; k++) {
      var a = k / fade;
      d[k] = raw[len + k] * (1 - a) + raw[k] * a;
    }
    return buf;
  }

  function slot() { if (live >= MAX_VOICES) return false; live++; return true; }
  function freeSlot() { if (live > 0) live--; }

  // Выход источника: панорама, сухая шина, посыл в реверб и в задержку.
  function out(node, x, send, echo) {
    var pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.92, Math.min(0.92, x || 0));
    node.connect(pan);
    pan.connect(master);
    var s = ctx.createGain();
    s.gain.value = send === undefined ? 0.5 : send;
    pan.connect(s); s.connect(revb);
    var e = null;
    if (echo) {
      e = ctx.createGain();
      e.gain.value = echo;
      pan.connect(e); e.connect(dlyIn);
    }
    return { pan: pan, send: s, echo: e };
  }

  // Отцепить отзвучавшую цепочку от шин. Пока узел соединён с мастером,
  // сборщик его не тронет, а событий за минуту роста сотни.
  function detach(tail) {
    if (!tail) return;
    try { tail.pan.disconnect(); } catch (e) {}
    try { tail.send.disconnect(); } catch (e) {}
    try { if (tail.echo) tail.echo.disconnect(); } catch (e) {}
  }

  // Огибающая на косинусах: подъём sin², спад cos². Начинается и кончается
  // ровно в нуле с нулевой производной, поэтому не щёлкает ни на входе, ни
  // на выходе, а сама форма мягче любой ломаной из линейных рамп.
  function envelope(att, dur, peak) {
    var N = 64, c = new Float32Array(N);
    for (var k = 0; k < N; k++) {
      var t = k / (N - 1) * dur, v;
      if (t < att) { v = Math.sin(Math.PI / 2 * t / att); v *= v; }
      else { v = Math.cos(Math.PI / 2 * (t - att) / (dur - att)); v *= v; }
      c[k] = peak * v;
    }
    c[N - 1] = 0;
    return c;
  }

  function setTarget(param, value, sec) {
    var t = ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, sec / 3);
  }

  // ---------- зерно ----------

  // Одно зерно: шум через резонансный фильтр плюс синусная опора под ним.
  // Резонанс и даёт «материал» — стекло, дерево, воду; синус держит высоту.
  function grain(v, freq, x, mul, when) {
    if (!v.free && !slot()) return;
    var t = ctx.currentTime + 0.02 + (when || 0);
    var dur = v.dur * (0.8 + Math.random() * 0.5);
    var att = Math.min(dur * 0.6, Math.max(0.05, v.attack * (0.7 + Math.random() * 0.6)));

    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(envelope(att, dur, v.gain * (mul || 1)), t, dur);

    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.7;

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = v.q;
    bp.frequency.setValueAtTime(freq * (v.rise ? 0.68 : 1), t);
    if (v.rise) bp.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.75);
    else {
      // лёгкий дрейф полосы: без него резонанс статичен и звучит машинно
      bp.frequency.linearRampToValueAtTime(freq * (0.97 + Math.random() * 0.06),
                                           t + dur);
    }

    var airG = ctx.createGain();
    airG.gain.value = v.air === undefined ? 0.9 : v.air;
    src.connect(bp); bp.connect(airG); airG.connect(g);

    // Тональная опора — только для высотных видов. Два партиала: основной
    // и тихая октава, вместе читаются как стекло, а не как «пик».
    var oscs = [];
    if (v.tonal !== 0) {
      var parts = [[1, 0.3], [2, 0.07]];
      for (var p = 0; p < parts.length; p++) {
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        var f0 = freq * parts[p][0];
        osc.frequency.setValueAtTime(f0 * (v.rise ? 0.68 : 1), t);
        if (v.rise) osc.frequency.exponentialRampToValueAtTime(f0, t + dur * 0.75);
        var og = ctx.createGain();
        og.gain.value = parts[p][1];
        osc.connect(og); og.connect(g);
        osc.start(t); osc.stop(t + dur + 0.05);
        oscs.push(osc);
      }
    }

    var tail = out(g, x, v.send === undefined ? 0.55 : v.send,
                   v.echo === undefined ? 0.3 : v.echo);
    var voice = { gain: g, sources: [src].concat(oscs) };
    activeGrains.add(voice);
    src.start(t);
    src.stop(t + dur + 0.06);
    src.onended = function () {
      if (!v.free) freeSlot();
      detach(tail); activeGrains.delete(voice);
      src.disconnect(); bp.disconnect(); airG.disconnect(); g.disconnect();
    };
  }

  // Облако зёрен: разброс по времени, высоте и панораме. Именно он превращает
  // одиночный пик в событие, размазанное по залу.
  function cloud(v, x, mul) {
    var steps = [0, 3, 7, 10, 12];       // ступени той же пентатоники
    var count = Math.min(v.grains || 3, MAX_VOICES - live);
    if (count <= 0) return;
    for (var i = 0; i < count; i++) {
      var semi = v.arp ? steps[i % steps.length]
                       : (Math.random() < 0.45 ? steps[(Math.random() * 3) | 0] : 0);
      var f = v.tonal === 0
        ? v.freq * (0.8 + Math.random() * 0.5)
        : v.freq * Math.pow(2, semi / 12);
      var when = i === 0 ? 0 : (v.arp ? i / count : Math.random()) * Math.min(v.spread, 480) / 1000;
      grain(v, f, x + (Math.random() - 0.5) * 0.6, mul * (i ? 0.7 : 1) / Math.sqrt(count), when);
    }
  }

  // ---------- слои ----------

  // Суб-бас. Две частоты в полутора герцах друг от друга — медленное биение,
  // поверх него ещё более медленная амплитудная волна. Идёт мимо реверба:
  // низ в хвосте превращается в кашу.
  function buildBed() {
    var t = ctx.currentTime;
    var g = ctx.createGain();
    g.gain.value = 0;
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.021;
    var lg = ctx.createGain();
    lg.gain.value = 0.02;                  // размах волны в абсолютных единицах
    var freqs = [P.A0, P.A1 * 1.004, P.A0 * 1.5];
    var gains = [0.55, 0.5, 0.18];
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freqs[i];
      var og = ctx.createGain();
      og.gain.value = gains[i];
      o.connect(og); og.connect(g);
      o.start(t);
    }
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.5;
    g.connect(lp); lp.connect(master);
    lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
    bed = { gain: g, depth: lg };
  }

  // Пэд. Пять голосов на ступенях пентатоники, у каждого две расстроенные
  // копии, разведённые влево и вправо — отсюда ширина. Дыхание каждого голоса
  // на своём периоде: 7.3, 11.1, 13.9, 17.3, 23.7 с — суммарная фаза никогда
  // не повторяется, это и есть «генеративность» в духе Eno. Изредка голос
  // переползает на соседнюю ступень — аккорд медленно меняет окраску.
  var CHORD = [P.A2, P.E3, P.A3, P.C4, P.E4];
  var STEPS = [P.A2, P.C3, P.D3, P.E3, P.G3, P.A3, P.C4, P.D4, P.E4, P.G4];
  var CYCLES = [7.3, 11.1, 13.9, 17.3, 23.7];

  function buildPad() {
    var t = ctx.currentTime;
    var bus = ctx.createGain();
    bus.gain.value = 0;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 0.9;
    bus.connect(lp);
    var tail = out(lp, 0, 0.7, 0.12);

    var voices = [];
    for (var i = 0; i < CHORD.length; i++) {
      var g = ctx.createGain();
      // среднее дыхания: нижние голоса громче, верхние — призвуком
      var base = 1 - i * 0.12;
      g.gain.value = base;
      var lfo = ctx.createOscillator();
      lfo.frequency.value = 1 / CYCLES[i];
      var lg = ctx.createGain();
      lg.gain.value = base * 0.45;         // размах дыхания вокруг среднего
      lfo.connect(lg); lg.connect(g.gain); lfo.start(t + Math.random() * CYCLES[i]);
      var oscs = [];
      for (var s = -1; s <= 1; s += 2) {
        var o = ctx.createOscillator();
        o.type = i % 2 ? 'triangle' : 'sine';
        o.frequency.value = CHORD[i];
        o.detune.value = s * (4 + i * 1.5);
        var og = ctx.createGain();
        og.gain.value = i % 2 ? 0.28 : 0.5;  // треугольник ярче, тише
        var pan = ctx.createStereoPanner();
        pan.pan.value = s * 0.6;
        o.connect(og); og.connect(pan); pan.connect(g);
        o.start(t);
        oscs.push(o);
      }
      g.connect(bus);
      voices.push({ gain: g, oscs: oscs, freq: CHORD[i] });
    }
    pad = { bus: bus, lp: lp, voices: voices, tail: tail };
    wander();
  }

  // Раз в несколько секунд один голос уползает на соседнюю ступень. Глиссандо
  // долгое, шести-девятисекундное: слышно не «смену ноты», а сдвиг окраски.
  // Нижний голос (тоника) на месте — иначе теряется опора.
  function wander() {
    var delay = 5000 + Math.random() * 9000;
    setTimeout(function () {
      if (!ctx || !pad) return;
      if (Math.random() < 0.6) {
        var v = pad.voices[1 + ((Math.random() * (pad.voices.length - 1)) | 0)];
        var idx = STEPS.indexOf(v.freq);
        if (idx < 0) idx = 3;
        var to = idx + (Math.random() < 0.5 ? -1 : 1);
        if (to >= 1 && to < STEPS.length) {
          var f = STEPS[to], t = ctx.currentTime, len = 6 + Math.random() * 3;
          for (var k = 0; k < v.oscs.length; k++) {
            v.oscs[k].frequency.cancelScheduledValues(t);
            v.oscs[k].frequency.setValueAtTime(v.freq, t);
            v.oscs[k].frequency.exponentialRampToValueAtTime(f, t + len);
          }
          v.freq = f;
        }
      }
      wander();
    }, delay);
  }

  // Воздух зала: шум через две плавающие полосы, слева и справа независимо,
  // на несоизмеримых периодах. На пустой чашке едва слышен.
  function buildAir() {
    var t = ctx.currentTime;
    var g = ctx.createGain();
    g.gain.value = 0;
    var sides = [[-0.75, 0.031, 480, 260], [0.75, 0.047, 640, 300]];
    for (var i = 0; i < sides.length; i++) {
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      src.playbackRate.value = 0.9 + i * 0.17;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = sides[i][2]; bp.Q.value = 1.4;
      var lfo = ctx.createOscillator();
      lfo.frequency.value = sides[i][1];
      var lg = ctx.createGain();
      lg.gain.value = sides[i][3];
      lfo.connect(lg); lg.connect(bp.frequency); lfo.start(t + i * 7);
      var pan = ctx.createStereoPanner();
      pan.pan.value = sides[i][0];
      src.connect(bp); bp.connect(pan); pan.connect(g);
      src.start(t);
    }
    out(g, 0, 0.8, 0);
    air = { gain: g };
  }

  // Сцена: доля заросшей чашки 0..1. Управляет всеми подкладами разом.
  // Кривые вогнутые: первые проценты роста почти ничего не меняют, зато
  // зрелая чашка звучит заметно полнее пустой.
  function applyScene(v, sec) {
    if (!ctx) return;
    var s = Math.max(0, Math.min(1, v));
    var k = Math.pow(s, 1.4);
    setTarget(pad.bus.gain, 0.026 + 0.06 * k, sec);
    setTarget(pad.lp.frequency, 260 + 1900 * k, sec);
    setTarget(bed.gain.gain, 0.04 + 0.045 * k, sec);
    setTarget(air.gain.gain, 0.016 + 0.034 * k, sec);
  }

  function setScene(v, sec) {
    scene = v;
    applyScene(v, sec === undefined ? 4 : sec);
  }

  function speciesDrone(name, v, x) {
    var t = ctx.currentTime;
    if (drones[name]) {
      var existing = drones[name].gain.gain;
      if (existing.cancelAndHoldAtTime) existing.cancelAndHoldAtTime(t);
      else { existing.cancelScheduledValues(t); existing.setValueAtTime(existing.value, t); }
      existing.linearRampToValueAtTime(v.gain, t + 0.6);
      existing.setValueAtTime(v.gain, t + 0.9);
      existing.linearRampToValueAtTime(0, t + 2.4);
      return;
    }
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.gain, t + 0.6);
    g.gain.setValueAtTime(v.gain, t + 0.9);
    g.gain.linearRampToValueAtTime(0, t + 2.4);

    var nodes = [];
    for (var i = 0; i < 2; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = v.freq * (1 + i * 0.007);
      var og = ctx.createGain(); og.gain.value = 0.5;
      o.connect(og); og.connect(g);
      o.start(t);
      nodes.push(o);
    }
    var tail = out(g, x, 0.6, 0);
    drones[name] = { gain: g, nodes: nodes, tail: tail };
  }

  // Дрон надо не только заглушить, но и ОСТАНОВИТЬ. Раньше узлы просто
  // теряли ссылку и продолжали работать с нулевой громкостью: каждая новая
  // культура добавляла дрон поверх прежних, сумма росла, насыщение уводило
  // всю картину вниз — фон проседал и щёлкал.
  function fadeDrones() {
    if (!ctx) return;
    var t = ctx.currentTime;
    for (var k in drones) {
      var d = drones[k];
      d.gain.gain.cancelScheduledValues(t);
      d.gain.gain.setValueAtTime(d.gain.gain.value, t);
      d.gain.gain.linearRampToValueAtTime(0, t + 1.6);
      if (d.nodes) {
        for (var i = 0; i < d.nodes.length; i++) d.nodes[i].stop(t + 1.7);
        d.nodes[d.nodes.length - 1].onended = (function (tail) {
          return function () { detach(tail); };
        })(d.tail);
      }
      delete drones[k];
    }
  }

  // ---------- события ----------

  function due(key, ms) {
    var now = ctx.currentTime * 1000;
    if (last[key] !== undefined && now - last[key] < ms) return false;
    last[key] = now;
    return true;
  }

  // Голос вида — только тембр. Регистр и вес даёт РАЗМЕР колонии: мелочь
  // отзывается высоко, коротко и легко, крупные массы — низко, длинно и
  // насыщенно. Так набор одновременно растущих колоний складывается в
  // композицию, а не в ровный поток одинаковых событий.
  function byScale(v, c) {
    var unit = 600 * (c.sc || 1) * (c.sc || 1);
    var big = c.cells / unit;                 // 0 — крошка, 4+ — большая масса

    var semi, weight, len, grains;
    if (big < 0.25)      { semi =  12; weight = 0.55; len = 0.55; grains = -1; }
    else if (big < 1)    { semi =   7; weight = 0.75; len = 0.8;  grains =  0; }
    else if (big < 2.5)  { semi =   0; weight = 1.0;  len = 1.0;  grains =  0; }
    else if (big < 5)    { semi =  -5; weight = 1.15; len = 1.5;  grains =  1; }
    else                 { semi = -12; weight = 1.3;  len = 2.1;  grains =  2; }

    return {
      freq: v.freq * Math.pow(2, semi / 12),
      q: v.q, spread: Math.min(420, v.spread * len), dur: Math.min(3.4, v.dur * len),
      attack: v.attack * (len > 1 ? len * 0.8 : 1),
      air: v.air * 0.32, tonal: v.tonal, rise: v.rise, arp: v.arp,
      gain: v.gain * weight * 1.2,
      grains: Math.max(1, Math.min(3, (v.grains || 3) + grains))
    };
  }

  function growth(c, delta, panX) {
    if (!enabled || !ctx || ctx.state !== 'running' || delta <= 0 || live >= MAX_VOICES - 2) return;
    var v = VOICE[c.archetype];
    if (!v) return;
    if (v.drone) { speciesDrone(c.archetype, v, panX); return; }

    var every = v.every / (density * Math.min(2.4, 1 + delta * 0.04));
    if (!due(c.archetype, Math.max(420, every))) return;
    if (!due('growth-budget', 320)) return;
    cloud(byScale(v, c), panX, Math.min(1.3, 0.55 + delta * 0.02));
  }

  // Капля в воду: синус с коротким падением высоты, почти весь в реверб.
  function drip(freq, x, gain, dur) {
    if (!slot()) return;
    var t = ctx.currentTime + 0.02;
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.35, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.07);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(envelope(0.012, dur, gain), t, dur);
    o.connect(g);
    var tail = out(g, x, 0.85, 0.45);
    o.start(t); o.stop(t + dur + 0.05);
    o.onended = function () { freeSlot(); detach(tail); o.disconnect(); g.disconnect(); };
  }

  // Долгий расцвет: несколько синусов с многосекундной атакой, широко
  // разведённых. Так звучит смена состояния — зрелость, новая чашка.
  function bloom(freqs, gain, att, dur) {
    for (var i = 0; i < freqs.length; i++) {
      if (!slot()) return;
      var t = ctx.currentTime + 0.02 + i * 0.35;
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freqs[i];
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueCurveAtTime(envelope(att, dur, gain), t, dur);
      o.connect(g);
      var tail = out(g, (i / (freqs.length - 1 || 1) - 0.5) * 1.4, 0.8, 0.2);
      o.start(t); o.stop(t + dur + 0.05);
      o.onended = (function (o, g, tail) {
        return function () { freeSlot(); detach(tail); o.disconnect(); g.disconnect(); };
      })(o, g, tail);
    }
  }

  // Огонь: гул снизу, поднимающееся шипение и россыпь тресков, рассеянных по
  // всей длительности прохода. Подклад на это время сжимает main через сцену.
  function fire(sec) {
    var t = ctx.currentTime + 0.02;
    var len = sec || 3.6;

    // поджиг: синус падает с 90 до 35 Гц — толчок, который слышен телом
    var whoomp = ctx.createOscillator();
    whoomp.type = 'sine';
    whoomp.frequency.setValueAtTime(90, t);
    whoomp.frequency.exponentialRampToValueAtTime(35, t + 1.4);
    var wg = ctx.createGain();
    wg.gain.setValueAtTime(0, t);
    wg.gain.setValueCurveAtTime(envelope(0.12, 1.8, 0.32), t, 1.8);
    whoomp.connect(wg); wg.connect(master);
    whoomp.start(t); whoomp.stop(t + 1.9);
    whoomp.onended = function () { wg.disconnect(); };

    var rumble = ctx.createBufferSource();
    rumble.buffer = noiseBuf; rumble.loop = true; rumble.playbackRate.value = 0.5;
    var rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass'; rlp.frequency.value = 110; rlp.Q.value = 1.2;
    var rg = ctx.createGain();
    rg.gain.setValueAtTime(0, t);
    rg.gain.setValueCurveAtTime(envelope(0.8, len + 1.2, 1.6), t, len + 1.2);
    rumble.connect(rlp); rlp.connect(rg); rg.connect(master);
    rumble.start(t); rumble.stop(t + len + 1.3);
    rumble.onended = function () { rg.disconnect(); };

    var hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuf; hiss.loop = true; hiss.playbackRate.value = 1.3;
    var hbp = ctx.createBiquadFilter();
    hbp.type = 'bandpass'; hbp.Q.value = 0.9;
    hbp.frequency.setValueAtTime(300, t);
    hbp.frequency.exponentialRampToValueAtTime(2600, t + len);
    var hg = ctx.createGain();
    hg.gain.setValueAtTime(0, t);
    hg.gain.setValueCurveAtTime(envelope(1.0, len + 0.8, 0.2), t, len + 0.8);
    hiss.connect(hbp); hbp.connect(hg);
    var htail = out(hg, 0, 0.7, 0.2);
    hiss.start(t); hiss.stop(t + len + 0.9);
    hiss.onended = function () { detach(htail); hg.disconnect(); };

    // треск: короткие зёрна высоко, гуще к середине прохода
    var n = 26;
    for (var i = 0; i < n; i++) {
      var when = Math.pow(Math.random(), 0.8) * len;
      grain({ freq: 1500 + Math.random() * 2600, q: 15, dur: 0.09, attack: 0.05,
              air: 1.0, gain: 0.07, tonal: 0, send: 0.4, echo: 0.5, free: 1 },
            0, (Math.random() - 0.5) * 1.6, 1, when);
    }
  }

  function event(kind, arch, panX) {
    if (!enabled || !ctx) return;

    if (kind === 'spawn') {
      if (!due('spawn', 900 / density)) return;
      drip([P.A4, P.C5, P.E5][(Math.random() * 3) | 0] * (Math.random() < 0.3 ? 2 : 1),
           panX, 0.035, 1.6);
    } else if (kind === 'fire') {
      fire(3.6);
    } else if (kind === 'mature') {
      bloom([P.A2, P.E3, P.A3], 0.045, 3.5, 11);
    } else if (kind === 'rebirth') {
      bloom([P.A3, P.E4, P.A4, P.E5], 0.03, 2.5, 8);
    }
  }

  // ---------- интерфейс ----------

  // Отклики тихие и стеклянные: не часть картины, а подтверждение нажатия.
  var UI = {
    select: { freq: 3200, q: 9,  dur: 0.16, gain: 0.03 },
    spore:  { freq: 1900, q: 12, dur: 0.3,  gain: 0.045 },
    press:  { freq: 2600, q: 8,  dur: 0.14, gain: 0.026 },
    start:  { freq: P.A3, q: 11, dur: 1.4,  gain: 0.06 },
    clean:  { freq: P.D3, q: 10, dur: 1.2,  gain: 0.05 }
  };

  function ui(kind) {
    if (!enabled || !ctx) return;
    var u = UI[kind] || UI.press;
    if (!due('ui' + kind, 45)) return;
    if (!slot()) return;

    var t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.3;

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = u.freq;
    bp.Q.value = u.q;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(envelope(u.dur > 0.4 ? 0.08 : 0.01, u.dur, u.gain), t, u.dur);

    src.connect(bp); bp.connect(g);
    var tail = out(g, 0, 0.35, 0);
    src.start(t);
    src.stop(t + u.dur + 0.04);
    src.onended = function () { freeSlot(); detach(tail); };
  }

  // ---------- управление ----------

  function setEnabled(on) {
    enabled = on;
    if (!on) {
      reset();
      if (ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      }
      return;
    }
    if (!started) { started = build(); if (!started) { enabled = false; return; } }
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 2.0);
  }

  function reset() {
    fadeDrones(); last = {};
    if (!ctx) return;
    var t = ctx.currentTime;
    activeGrains.forEach(function (v) {
      if (v.gain.gain.cancelAndHoldAtTime) v.gain.gain.cancelAndHoldAtTime(t);
      else { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t); }
      v.gain.gain.linearRampToValueAtTime(0, t + 0.12);
      v.sources.forEach(function (source) { try { source.stop(t + 0.14); } catch (e) {} });
    });
  }

  // Браузер не даёт создать звук без жеста пользователя, поэтому контекст
  // поднимается на первом же касании страницы, а не по тумблеру.
  function arm() {
    function wake() {
      if (enabled && !started) setEnabled(true);
      else if (enabled && ctx && ctx.state === 'suspended') ctx.resume();
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (e) {
      document.addEventListener(e, wake, { passive: true });
    });
  }

  arm();

  return {
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    growth: growth,
    event: event,
    ui: ui,
    reset: reset,
    setScene: setScene,
    getScene: function () { return scene; },
    live: function () { return live; },
    setVolume: function (v) {
      volume = v;
      if (ctx && enabled) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.2);
      }
    },
    getVolume: function () { return volume; },
    setDensity: function (v) { density = v; },
    getDensity: function () { return density; },
    context: function () { return ctx; },
    output: function () { return outNode; },      // для замеров уровня извне
    voices: VOICE
  };
})();
