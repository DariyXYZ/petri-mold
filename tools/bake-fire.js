'use strict';

// Печёт варианты анимации выжигания и складывает их в GIF для отбора.
//
//   node tools/bake-fire.js
//
// Считает офлайн честным решателем (tools/fluid-fire.js), рендерит через
// настоящий конвейер проекта — та же чашка, та же палитра, тот же дизер, —
// поэтому GIF показывает ровно то, что будет в игре.
//
// Предпросмотр кладётся в tools/preview/. Параметры каждого варианта — там же
// в variants.json, чтобы выбранный можно было запечь в игровой формат.

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var Gif = require('./gif.js').Gif;
var FF = require('./fluid-fire.js');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(__dirname, 'preview');

// --- загрузка модулей проекта в общий контекст ---

function loadPM() {
  var ctx = vm.createContext({ Math: Math, console: console,
    Float32Array: Float32Array, Uint8Array: Uint8Array, Uint16Array: Uint16Array,
    Object: Object, Array: Array, JSON: JSON, Date: Date });
  ['js/rng.js', 'js/palette.js', 'js/dish.js', 'js/fields.js',
   'js/growth.js', 'js/scene.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx.PM;
}

// --- чашка с плесенью: фон для предпросмотра ---

function growDish(PM, W, H, seed, ticks) {
  var rnd = PM.rng.mulberry32(seed);
  var f = PM.fields.create(W, H, seed, PM.dish.GEO);
  f.seedBase = seed;
  var colonies = [];
  var plan = [
    ['colony',    0.34, 0.36], ['speckle', 0.64, 0.34], ['dots', 0.48, 0.58],
    ['crackle',   0.72, 0.64], ['target',  0.30, 0.68], ['starburst', 0.55, 0.80]
  ];
  for (var i = 0; i < plan.length; i++) {
    var c = PM.growth.makeColony(i + 1, Math.round(W * plan[i][1]),
                                 Math.round(H * plan[i][2]), rnd, seed,
                                 plan[i][0], W / 192);
    PM.growth.inoculate(c, f, rnd);
    colonies.push(c);
  }
  for (var t = 0; t < ticks; t++) PM.growth.tick(f, colonies, rnd, 3);
  return { fields: f, colonies: colonies };
}

// --- варианты ---
//
// dt = 1 кадр. frontBase/frontWob — ход кромки поджига в клетках сетки за
// кадр (сетка вдвое грубее кадра, так что в пикселях выходит вдвое больше).

var VARIANTS = [
  {
    name: '1-even-sweep',
    title: 'ровный отжиг',
    note: 'низкая ровная стена пламени, слабый подъём, мало вихрей — ' +
          'спокойное лабораторное выжигание',
    frontBase: 0.55, frontWob: 0.40,
    buoy: 1.6, vort: 1.4, iters: 24, dt: 1.0,
    fuelBase: 0.35, fuelSwing: 0.55, patchScale: 9,
    ignite: 0.95, burn: 0.22, tburn: 1.5, tcap: 1.15,
    coolQ: 0.30, coolL: 0.16,
    sootBase: 0.16, sootSwing: 0.5, sootHold: 0.997, sootFade: 0.92,
    gain: [200, 130], grain: 0.34
  },
  {
    name: '2-gusty',
    title: 'порывистый',
    note: 'языки заваливает набок, кромка рвётся на лопасти — ' +
          'сильное завихрение при среднем подъёме',
    frontBase: 0.62, frontWob: 0.55,
    buoy: 2.4, vort: 4.5, iters: 28, dt: 1.0,
    fuelBase: 0.22, fuelSwing: 0.85, patchScale: 13,
    ignite: 1.05, burn: 0.20, tburn: 1.7, tcap: 1.2,
    coolQ: 0.28, coolL: 0.13,
    sootBase: 0.18, sootSwing: 0.55, sootHold: 0.9975, sootFade: 0.92,
    gain: [215, 135], grain: 0.40
  },
  {
    name: '3-firestorm',
    title: 'шторм',
    note: 'высокие грибовидные факелы, сильный подъём и завихрение — ' +
          'самое зрелищное и самое «горячее»',
    frontBase: 0.85, frontWob: 0.55,
    buoy: 3.6, vort: 6.5, iters: 32, dt: 1.0,
    fuelBase: 0.30, fuelSwing: 0.85, patchScale: 16,
    ignite: 1.15, burn: 0.16, tburn: 2.1, tcap: 1.25,
    coolQ: 0.24, coolL: 0.10,
    sootBase: 0.22, sootSwing: 0.6, sootHold: 0.998, sootFade: 0.93,
    gain: [230, 140], grain: 0.42
  },
  {
    name: '4-smoulder',
    title: 'тление',
    note: 'почти без пламени: тёмный вал, редкие вспышки над колониями, ' +
          'длинный сажевый след',
    frontBase: 0.34, frontWob: 0.30,
    buoy: 1.1, vort: 2.2, iters: 24, dt: 1.0,
    fuelBase: 0.10, fuelSwing: 0.75, patchScale: 20,
    ignite: 0.70, burn: 0.10, tburn: 1.1, tcap: 1.0,
    coolQ: 0.34, coolL: 0.20,
    sootBase: 0.30, sootSwing: 0.6, sootHold: 0.9992, sootFade: 0.95,
    gain: [175, 120], grain: 0.30
  },
  {
    name: '5-flashover',
    title: 'вспышка',
    note: 'кромка проходит чашку вдвое быстрее, разом яркая волна и ' +
          'быстрое догорание',
    frontBase: 1.35, frontWob: 0.60,
    buoy: 3.0, vort: 5.0, iters: 28, dt: 1.0,
    fuelBase: 0.45, fuelSwing: 0.65, patchScale: 11,
    ignite: 1.2, burn: 0.30, tburn: 2.0, tcap: 1.25,
    coolQ: 0.30, coolL: 0.15,
    sootBase: 0.20, sootSwing: 0.55, sootHold: 0.996, sootFade: 0.90,
    gain: [235, 145], grain: 0.38
  }
];

// --- билинейный подъём поля симуляции в разрешение кадра ---

function upsample(dst, src, sw, sh, W, H) {
  var kx = (sw - 1) / (W - 1), ky = (sh - 1) / (H - 1);
  for (var y = 0; y < H; y++) {
    var sy = y * ky;
    var iy = sy | 0; if (iy > sh - 2) iy = sh - 2;
    var fy = sy - iy;
    var r0 = iy * sw, r1 = r0 + sw;
    for (var x = 0; x < W; x++) {
      var sx = x * kx;
      var ix = sx | 0; if (ix > sw - 2) ix = sw - 2;
      var fx = sx - ix;
      dst[y * W + x] =
          src[r0 + ix] * (1 - fx) * (1 - fy) + src[r0 + ix + 1] * fx * (1 - fy)
        + src[r1 + ix] * (1 - fx) * fy + src[r1 + ix + 1] * fx * fy;
    }
  }
}

// --- один вариант ---

function bake(PM, o, cfg) {
  var W = o.W, H = o.H, n = W * H;
  var SW = W >> 1, SH = (H >> 1) + 1;

  var dish = growDish(PM, W, H, o.seed, o.ticks);
  var f = dish.fields, colonies = dish.colonies;

  var bg = new Float32Array(n);
  PM.dish.paint(bg, W, H, o.seed, PM.dish.GEO);

  var sim = FF.makeSim(Object.assign({
    W: SW, H: SH, radius: PM.dish.GEO.rAgar * PM.dish.GEO.rOuter * W * 0.5,
    seed: o.seed
  }, cfg));

  var T = new Float32Array(n), soot = new Float32Array(n);
  var lum = new Float32Array(n);
  var idx = new Uint8Array(n);

  var BAYER = PM.palette.BAYER4;
  var LUT = PM.palette.table();
  var OFF = PM.palette.LUT_OFF, LMAX = PM.palette.LUT_N - 1;
  var amp = o.dither;
  var g0 = cfg.gain[0], g1 = cfg.gain[1], grain = cfg.grain;

  var gif = new Gif(W, H, PM.palette.ramp().map(function (c) {
    return [c.r, c.g, c.b];
  }));

  var frames = 0, tail = 0;
  for (var step = 0; step < o.maxFrames; step++) {
    FF.stepSim(sim);

    // Плесень выгорает по кромке поджига — ровно так же, как в игре.
    for (var x = 0; x < W; x++) {
      var fy = sim.front[x >> 1] * 2;
      for (var y = Math.max(0, Math.floor(fy)); y < H; y++) {
        var i = y * W + x;
        if (!f.mask[i] || (!f.owner[i] && !f.film[i])) continue;
        f.owner[i] = 0; f.density[i] = 0; f.film[i] = 0; f.texSet[i] = 0;
      }
    }

    if (step % o.every) continue;

    upsample(T, sim.T, SW, SH, W, H);
    upsample(soot, sim.soot, SW, SH, W, H);

    lum.set(bg);
    PM.scene.overlay(lum, f, colonies);

    for (var q = 0; q < n; q++) {
      var s = soot[q], h = T[q];
      if (!s && !h) continue;
      var l = lum[q];
      if (s > 0.004) l = l * (1 - s) + 5 * s;
      if (h > 0.004) {
        if (h > 1) h = 1;
        var gn = FF.fbm2(q % W / 3.6, ((q / W) | 0) / 3.6 - step * 0.55,
                         o.seed + 17, 2);
        l += (h * h * g0 + h * g1) * (1 - grain * 0.5 + grain * gn);
      }
      lum[q] = l > 255 ? 255 : l;
    }

    for (var y2 = 0; y2 < H; y2++) {
      for (var x2 = 0; x2 < W; x2++) {
        var i2 = y2 * W + x2;
        var lv = lum[i2];
        if (lv <= 1) { idx[i2] = 0; continue; }
        var hh = (Math.imul(x2 + 1, 374761393) ^ Math.imul(y2 + 1, 668265263)) >>> 0;
        hh = (Math.imul(hh ^ (hh >>> 13), 1274126177) >>> 0) / 4294967296;
        lv += ((BAYER[(y2 & 3) * 4 + (x2 & 3)] / 16 - 0.46875) * 0.72
               + (hh - 0.5) * 0.55) * amp;
        var qq = (lv + OFF) | 0;
        if (qq < 0) qq = 0; else if (qq > LMAX) qq = LMAX;
        idx[i2] = LUT[qq];
      }
    }

    gif.frame(idx, o.every * 1000 / 60);
    frames++;

    if (!sim.burning) { tail++; if (tail > o.tailFrames) break; }
  }

  return { gif: gif.buffer(), frames: frames, simSteps: sim.frame };
}

// --- прогон ---

function main() {
  var PM = loadPM();
  PM.palette.setName('grey8');

  var o = {
    W: 380, H: 389, seed: 424242, ticks: 4200,
    dither: PM.palette.autoAmp(), every: 2, maxFrames: 460, tailFrames: 26
  };

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  var report = [];

  for (var i = 0; i < VARIANTS.length; i++) {
    var cfg = VARIANTS[i];
    var t0 = Date.now();
    var r = bake(PM, o, cfg);
    var file = path.join(OUT, 'fire-' + cfg.name + '.gif');
    fs.writeFileSync(file, r.gif);
    var kb = (r.gif.length / 1024).toFixed(0);
    console.log(cfg.name.padEnd(14) + ' ' + String(r.frames).padStart(3) +
                ' кадров  ' + String(r.simSteps).padStart(3) + ' шагов  ' +
                kb.padStart(5) + ' КБ  ' +
                ((Date.now() - t0) / 1000).toFixed(1) + ' с');
    report.push({
      name: cfg.name, title: cfg.title, note: cfg.note,
      gif: path.relative(ROOT, file).replace(/\\/g, '/'),
      frames: r.frames, simSteps: r.simSteps,
      seconds: +(r.simSteps / 60).toFixed(2),
      sizeKB: +kb, params: cfg
    });
  }

  fs.writeFileSync(path.join(OUT, 'variants.json'),
                   JSON.stringify({ render: o, variants: report }, null, 2));
  console.log('\nпараметры: ' + path.relative(ROOT, path.join(OUT, 'variants.json')));
}

main();
