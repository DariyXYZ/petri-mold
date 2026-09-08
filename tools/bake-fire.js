'use strict';

// Пишет анимацию выжигания в GIF, чтобы её можно было посмотреть покадрово,
// не гоняя браузер.
//
//   node tools/bake-fire.js
//
// Гоняется РОВНО тот модуль, что в игре (js/burn.js), поверх настоящей
// выращенной чашки и через настоящую палитру с дизером, — поэтому GIF
// показывает то, что будет на экране, а не отдельную офлайновую модель.
// Варианты ниже правят только параметры PM.burn.P.
//
// Предпросмотр кладётся в tools/preview/ (GIF в .gitignore, они большие),
// параметры — рядом в variants.json.

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var Gif = require('./gif.js').Gif;

var ROOT = path.join(__dirname, '..');
var OUT = path.join(__dirname, 'preview');

// --- модули проекта в общий контекст ---

function loadPM() {
  var ctx = vm.createContext({ Math: Math, console: console,
    Float32Array: Float32Array, Uint8Array: Uint8Array, Uint16Array: Uint16Array,
    Object: Object, Array: Array, JSON: JSON, Date: Date });
  ['js/rng.js', 'js/palette.js', 'js/dish.js', 'js/fields.js',
   'js/growth.js', 'js/scene.js', 'js/burn.js'].forEach(function (fl) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, fl), 'utf8'), ctx,
                    { filename: fl });
  });
  // burn.js подаёт треск в озвучку; здесь звука нет
  ctx.PM.sound = { event: function () {} };
  return ctx.PM;
}

// --- чашка с плесенью ---

function growDish(PM, W, H, seed, ticks) {
  var rnd = PM.rng.mulberry32(seed);
  var f = PM.fields.create(W, H, seed, PM.dish.GEO);
  f.seedBase = seed;
  var colonies = [];
  var plan = [
    ['colony',  0.34, 0.36], ['speckle', 0.64, 0.34], ['dots',      0.48, 0.58],
    ['crackle', 0.72, 0.64], ['target',  0.30, 0.68], ['starburst', 0.55, 0.80]
  ];
  for (var i = 0; i < plan.length; i++) {
    var c = PM.growth.makeColony(i + 1, Math.round(W * plan[i][1]),
                                 Math.round(H * plan[i][2]), rnd, seed,
                                 plan[i][0], W / 192);
    PM.growth.inoculate(c, f, rnd);
    colonies.push(c);
  }
  for (var t = 0; t < ticks; t++) PM.growth.tick(f, colonies, rnd, 3);
  // рост остановлен: во время выжигания чашка уже не растёт
  for (var k = 0; k < colonies.length; k++) {
    var cc = colonies[k];
    cc.alive = false; cc.tips.length = 0;
    if (cc.blobs) cc.blobs.length = 0;
    if (cc.waves) cc.waves.length = 0;
  }
  return { fields: f, colonies: colonies };
}

// --- варианты: правки к PM.burn.P ---

var VARIANTS = [
  { name: 'crest', title: 'гребень', note: 'то, что стоит в игре', over: {} },
  { name: 'low',   title: 'низкий',
    note: 'языки ниже и чаще, лента толще — совсем спокойное выжигание',
    over: { hMain: 12, hTeeth: 5, lMain: 8, ribbon: 9, base: 8 } },
  { name: 'tall',  title: 'высокий',
    note: 'редкие высокие языки, лента тоньше',
    over: { hMain: 26, hTeeth: 7, lMain: 15, ribbon: 6, base: 6, sharp: 2.6 } }
];

// --- один вариант ---

function bake(PM, o, cfg) {
  var W = o.W, H = o.H, n = W * H;

  var base = {};
  Object.keys(PM.burn.P).forEach(function (k) { base[k] = PM.burn.P[k]; });
  Object.keys(cfg.over).forEach(function (k) { PM.burn.P[k] = cfg.over[k]; });

  var dish = growDish(PM, W, H, o.seed, o.ticks);
  var f = dish.fields, colonies = dish.colonies;

  var bg = new Float32Array(n);
  PM.dish.paint(bg, W, H, o.seed, PM.dish.GEO);

  var lum = new Float32Array(n);
  var idx = new Uint8Array(n);
  var BAYER = PM.palette.BAYER4;
  var LUT = PM.palette.table();
  var OFF = PM.palette.LUT_OFF, LMAX = PM.palette.LUT_N - 1;
  var amp = o.dither;

  var gif = new Gif(W, H, PM.palette.ramp().map(function (c) {
    return [c.r, c.g, c.b];
  }));

  var frames = 0, steps = 0;
  PM.burn.start(f, o.seed, function () {});

  while (PM.burn.isActive() && steps < o.maxSteps) {
    PM.burn.step();
    steps++;
    if (steps % o.every) continue;

    lum.set(bg);
    PM.scene.overlay(lum, f, colonies);
    PM.burn.paint(lum);

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var lv = lum[i];
        if (lv <= 1) { idx[i] = 0; continue; }
        var h = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
        h = (Math.imul(h ^ (h >>> 13), 1274126177) >>> 0) / 4294967296;
        lv += ((BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.46875) * 0.72
               + (h - 0.5) * 0.55) * amp;
        var q = (lv + OFF) | 0;
        if (q < 0) q = 0; else if (q > LMAX) q = LMAX;
        idx[i] = LUT[q];
      }
    }
    gif.frame(idx, o.every * 1000 / 60);
    frames++;
  }

  var snapshot = {};
  Object.keys(PM.burn.P).forEach(function (k) { snapshot[k] = PM.burn.P[k]; });
  Object.keys(base).forEach(function (k) { PM.burn.P[k] = base[k]; });

  return { gif: gif.buffer(), frames: frames, steps: steps, params: snapshot };
}

// --- прогон ---

function main() {
  var PM = loadPM();
  PM.palette.setName('grey8');

  var o = {
    W: 380, H: 389, seed: 424242, ticks: 4200,
    dither: PM.palette.autoAmp(), every: 2, maxSteps: 600
  };

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  var report = [];

  for (var i = 0; i < VARIANTS.length; i++) {
    var cfg = VARIANTS[i];
    var t0 = Date.now();
    var r = bake(PM, o, cfg);
    var file = path.join(OUT, 'burn-' + cfg.name + '.gif');
    fs.writeFileSync(file, r.gif);
    var kb = (r.gif.length / 1024).toFixed(0);
    console.log(cfg.name.padEnd(8) + String(r.frames).padStart(4) + ' кадров  ' +
                String(r.steps).padStart(4) + ' шагов  ' +
                (r.steps / 60).toFixed(1) + ' с  ' + kb.padStart(5) + ' КБ  ' +
                ((Date.now() - t0) / 1000).toFixed(1) + ' с расчёта');
    report.push({
      name: cfg.name, title: cfg.title, note: cfg.note,
      gif: path.relative(ROOT, file).replace(/\\/g, '/'),
      frames: r.frames, steps: r.steps,
      seconds: +(r.steps / 60).toFixed(2), sizeKB: +kb,
      over: cfg.over, params: r.params
    });
  }

  fs.writeFileSync(path.join(OUT, 'variants.json'),
                   JSON.stringify({ render: o, variants: report }, null, 2));
  console.log('\nпараметры: ' + path.relative(ROOT, path.join(OUT, 'variants.json')));
}

main();
