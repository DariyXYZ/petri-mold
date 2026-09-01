var PM = PM || {};

// Озвучка роста. Атмосферная, не чиптюн — поэтому здесь почти нет чистых
// осцилляторов. Основа тембра: ШУМ через резонансный фильтр. Полоса с высоким Q
// звучит как капля по стеклу, дерево, дыхание, но остаётся высотной, поэтому
// виды складываются в созвучие. Чистый синус с быстрой атакой — ровно то, что
// даёт «восьмибитность», и он оставлен лишь тихой опорой под шумом.
//
// Второй приём против механичности — гранулярность: событие это не один пик,
// а облако из нескольких зёрен с разбросом по времени, высоте и панораме.
//
// Сэмплов нет намеренно: страница должна открываться с диска, а file:// не даёт
// подгружать аудиофайлы.
PM.sound = (function () {

  // ля-минорная пентатоника: любое сочетание видов созвучно
  var A = 55;
  function n(semi, oct) { return A * Math.pow(2, oct + semi / 12); }
  var P = {
    A1: n(0, 0), A2: n(0, 1), C3: n(3, 1), D3: n(5, 1), E3: n(7, 1),
    G3: n(10, 1), A3: n(0, 2), C4: n(3, 2), D4: n(5, 2), E4: n(7, 2),
    A4: n(0, 3), C5: n(3, 3), E5: n(7, 3)
  };

  // Голос вида. q — острота резонанса (материал), grains — сколько зёрен в
  // облаке, air — доля шума над тоном, attack — насколько мягко входит звук.
  var VOICE = {
    // базовая плесень: тёплый деревянный резонанс, медленное дыхание
    colony:   { freq: P.D3, q: 9,  grains: 4, spread: 260, dur: 1.6, attack: 0.22,
                air: 0.85, gain: 0.15, every: 620 },
    // мелкая россыпь: сухие капли высоко, почти без тона
    dots:     { freq: P.E5, q: 16, grains: 3, spread: 130, dur: 0.5, attack: 0.03,
                air: 0.95, gain: 0.05, every: 260 },
    // мишень: низкий гулкий обертон, как удар по стеклу через воду
    target:   { freq: P.A2, q: 6,  grains: 3, spread: 420, dur: 3.4, attack: 0.5,
                air: 0.6,  gain: 0.16, every: 1100 },
    // лучи: облако зёрен, расходящееся по высоте
    starburst:{ freq: P.A4, q: 13, grains: 7, spread: 520, dur: 1.1, attack: 0.06,
                air: 0.8,  gain: 0.08, every: 900, arp: 1 },
    // пузыри: восходящий резонанс, как воздух в жидкости
    bubble:   { freq: P.A3, q: 14, grains: 2, spread: 90,  dur: 1.0, attack: 0.05,
                air: 0.7,  gain: 0.11, every: 520, rise: 1 },
    // икра: очень мелкие частые капли
    roe:      { freq: P.C5, q: 18, grains: 4, spread: 110, dur: 0.4, attack: 0.02,
                air: 1.0,  gain: 0.045, every: 300 },
    // ветвление: короткий сухой треск дерева
    dendrite: { freq: P.G3, q: 7,  grains: 3, spread: 180, dur: 0.7, attack: 0.01,
                air: 1.0,  gain: 0.07, every: 480 },
    // кольцо-призрак: длинный низкий выдох
    crater:   { freq: P.A1, q: 4,  grains: 2, spread: 700, dur: 5.0, attack: 1.2,
                air: 0.55, gain: 0.17, every: 2000 },
    // трещины: сухой деревянный треск, а не шорох
    crackle:  { freq: P.D3, q: 11, grains: 4, spread: 170, dur: 0.5, attack: 0.008,
                air: 0.9,  gain: 0.05, every: 420 },
    // крап: мягкий шелест с опорой на ноту
    speckle:  { freq: P.C4, q: 12, grains: 3, spread: 320, dur: 0.9, attack: 0.14,
                air: 0.85, gain: 0.038, every: 520 },
    // гифы: тихий высокий призвук
    hyphal:   { freq: P.E4, q: 14, grains: 3, spread: 400, dur: 1.3, attack: 0.32,
                air: 0.8,  gain: 0.030, every: 580 },
    // плёнка: непрерывный подклад
    film:     { freq: P.A1, drone: 1, gain: 0.06 }
  };

  var ctx = null, master = null, revb = null, wet = null;
  var noiseBuf = null, drones = {}, last = {};
  var live = 0, MAX_VOICES = 16;
  var enabled = true, started = false;    // включён сразу, ждём только жеста
  var volume = 0.75, density = 1.0;

  // ---------- граф ----------

  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;

    // подрезаем сумму ДО насыщения, иначе кривая всё время в изгибе
    var pre = ctx.createGain();
    pre.gain.value = 0.5;

    // Мягкое насыщение вместо компрессора: у него нет ни атаки, ни
    // восстановления, поэтому нечему «дышать» на всплесках.
    var shaper = ctx.createWaveShaper();
    shaper.curve = softCurve(1.6);
    shaper.oversample = '4x';

    // страховочный лимитер, почти всегда бездействует
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2;
    lim.knee.value = 14;
    lim.ratio.value = 3;
    lim.attack.value = 0.006;
    lim.release.value = 0.25;

    // Верх отрезаем заметно ниже обычного: звук уходит «в глубину кадра»
    // и перестаёт царапать. Резкий верх — половина ощущения дешёвой синтетики.
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4600;
    lp.Q.value = 0.4;

    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 38;

    master.connect(pre); pre.connect(shaper); shaper.connect(lim);
    lim.connect(lp); lp.connect(hp);
    hp.connect(ctx.destination);

    // Долгий реверб — главный носитель «атмосферы». Импульс с предзадержкой:
    // сначала тишина, потом хвост, отчего появляется ощущение помещения.
    revb = ctx.createConvolver();
    revb.buffer = impulse(5.2, 2.1, 0.03);
    wet = ctx.createGain();
    wet.gain.value = 0.32;
    revb.connect(wet); wet.connect(master);

    noiseBuf = noise(2.5);
    ambientDrone();
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
        // шум, сглаженный однополюсным фильтром: хвост тёмный, а не шипящий
        var raw = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        lastV = lastV * 0.72 + raw * 0.28;
        d[i] = lastV;
      }
    }
    return buf;
  }

  function noise(sec) {
    var len = Math.floor(ctx.sampleRate * sec);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var v = 0;
    for (var i = 0; i < len; i++) {
      // окрашенный шум: ближе к воздуху, чем к белому шипению
      v = v * 0.28 + (Math.random() * 2 - 1) * 0.72;
      d[i] = v;
    }
    return buf;
  }

  function slot() { if (live >= MAX_VOICES) return false; live++; return true; }
  function freeSlot() { if (live > 0) live--; }

  function out(node, x, send) {
    var pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.92, Math.min(0.92, x || 0));
    node.connect(pan);
    pan.connect(master);
    var s = ctx.createGain();
    s.gain.value = send === undefined ? 0.35 : send;
    pan.connect(s); s.connect(revb);
  }

  // ---------- зерно ----------

  // Одно зерно: шум через резонансный фильтр плюс тихий тон под ним.
  // Резонанс и даёт «материал» — стекло, дерево, воду.
  function grain(v, freq, x, mul, when) {
    if (!slot()) return;
    var t = ctx.currentTime + (when || 0);
    var dur = v.dur * (0.75 + Math.random() * 0.5);
    var att = Math.max(0.004, v.attack * (0.7 + Math.random() * 0.6));

    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.gain * (mul || 1), t + att);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.03);

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

    // тихая тональная опора — только для высотных видов
    if (v.tonal !== 0) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * (v.rise ? 0.68 : 1), t);
      if (v.rise) osc.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.75);
      var og = ctx.createGain();
      og.gain.value = 0.22;
      osc.connect(og); og.connect(g);
      osc.start(t); osc.stop(t + dur + 0.05);
    }

    out(g, x, 0.4);
    src.start(t);
    src.stop(t + dur + 0.06);
    src.onended = freeSlot;
  }

  // Облако зёрен: разброс по времени, высоте и панораме. Именно он превращает
  // одиночный пик в атмосферное событие.
  function cloud(v, x, mul) {
    var steps = [0, 3, 7, 10, 12];       // ступени той же пентатоники
    var count = v.grains || 3;
    for (var i = 0; i < count; i++) {
      var semi = v.arp ? steps[i % steps.length]
                       : (Math.random() < 0.45 ? steps[(Math.random() * 3) | 0] : 0);
      var f = v.tonal === 0
        ? v.freq * (0.8 + Math.random() * 0.5)
        : v.freq * Math.pow(2, semi / 12);
      var when = (v.arp ? i / count : Math.random()) * v.spread / 1000;
      grain(v, f, x + (Math.random() - 0.5) * 0.5, mul * (i ? 0.7 : 1), when);
    }
  }

  // ---------- дроны ----------

  // Подклад, который держит всю картину: три расстроенных синуса и шумовой
  // слой с медленно плывущим фильтром. Без него события висят в пустоте.
  function ambientDrone() {
    var t = ctx.currentTime;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 8);

    var f = P.A1;
    for (var i = 0; i < 3; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (1 + (i - 1) * 0.004);
      var og = ctx.createGain();
      og.gain.value = 0.5;
      o.connect(og); og.connect(g);
      o.start(t);
    }

    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 2;

    // очень медленная модуляция: картина «дышит»
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    var lg = ctx.createGain();
    lg.gain.value = 130;
    lfo.connect(lg); lg.connect(lp.frequency);
    lfo.start(t);

    var ng = ctx.createGain();
    ng.gain.value = 0.5;
    src.connect(lp); lp.connect(ng); ng.connect(g);
    src.start(t);

    out(g, 0, 0.3);
    drones.ambient = { gain: g };
  }

  function speciesDrone(name, v, x) {
    if (drones[name]) return;
    var t = ctx.currentTime;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.gain, t + 6);

    for (var i = 0; i < 2; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = v.freq * (1 + i * 0.007);
      var og = ctx.createGain(); og.gain.value = 0.5;
      o.connect(og); og.connect(g);
      o.start(t);
    }
    out(g, x, 0.4);
    drones[name] = { gain: g };
  }

  function fadeDrones() {
    if (!ctx) return;
    var t = ctx.currentTime;
    for (var k in drones) {
      if (k === 'ambient') continue;
      drones[k].gain.gain.cancelScheduledValues(t);
      drones[k].gain.gain.linearRampToValueAtTime(0, t + 2);
      delete drones[k];
    }
  }

  // ---------- события ----------

  function due(key, ms) {
    var now = ctx.currentTime * 1000;
    if (last[key] && now - last[key] < ms) return false;
    last[key] = now;
    return true;
  }

  function growth(c, delta, panX) {
    if (!enabled || !ctx || delta <= 0) return;
    var v = VOICE[c.archetype];
    if (!v) return;
    if (v.drone) { speciesDrone(c.archetype, v, panX); return; }

    var every = v.every / (density * Math.min(2.4, 1 + delta * 0.04));
    if (!due(c.archetype, every)) return;
    cloud(v, panX, Math.min(1.3, 0.55 + delta * 0.02));
  }

  function event(kind, arch, panX) {
    if (!enabled || !ctx) return;

    if (kind === 'spawn') {
      if (!due('spawn', 620 / density)) return;
      cloud({ freq: P.E4, q: 15, grains: 2, spread: 120, dur: 0.55,
              attack: 0.04, air: 1.0, gain: 0.04, tonal: 0 }, panX, 1);
    } else if (kind === 'seam') {
      if (!due('seam', 900)) return;
      cloud({ freq: 180, q: 3, grains: 2, spread: 200, dur: 1.6,
              attack: 0.25, air: 0.8, gain: 0.09, tonal: 0 }, panX, 1);
    } else if (kind === 'mature') {
      cloud({ freq: P.A2, q: 5, grains: 3, spread: 700, dur: 5.5,
              attack: 1.4, air: 0.6, gain: 0.13 }, 0, 1);
    }
  }

  // ---------- интерфейс ----------

  // Отклики еле слышные и сухие: это не часть картины, а подтверждение нажатия.
  var UI = {
    select: { freq: 3200, q: 9,  dur: 0.13, gain: 0.030 },
    spore:  { freq: 1900, q: 12, dur: 0.22, gain: 0.042 },
    press:  { freq: 2600, q: 8,  dur: 0.11, gain: 0.026 },
    start:  { freq: 620,  q: 5,  dur: 0.7,  gain: 0.055 },
    clean:  { freq: 420,  q: 3,  dur: 0.9,  gain: 0.05  }
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
    g.gain.linearRampToValueAtTime(u.gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + u.dur);
    g.gain.linearRampToValueAtTime(0, t + u.dur + 0.02);

    src.connect(bp); bp.connect(g);
    out(g, 0, 0.12);                    // почти сухо
    src.start(t);
    src.stop(t + u.dur + 0.04);
    src.onended = freeSlot;
  }

  // ---------- управление ----------

  function setEnabled(on) {
    enabled = on;
    if (!on) {
      if (ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      }
      return;
    }
    if (!started) { started = build(); if (!started) { enabled = false; return; } }
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.2);
  }

  function reset() { fadeDrones(); last = {}; }

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
    voices: VOICE
  };
})();
