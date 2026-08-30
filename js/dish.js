var PM = PM || {};

// Геометрия и статическая графика чашки Петри.
// Константы — доли внешнего радиуса, замерены по референсу 569x583.
PM.dish = (function () {
  var GEO = {
    cx: 0.5,                 // центр чашки, доли ширины кадра
    cy: 0.5,                 // доли высоты кадра
    rOuter: 0.436,           // внешний радиус, доли ширины кадра
    // границы полос обода, доли rOuter
    rBand1: 0.985,           // внешняя тень -> тёмная стенка
    rBand2: 0.965,           // тёмная стенка -> тело стенки
    rBand3: 0.936,           // тело стенки -> яркий блик
    rAgar: 0.900,            // блик -> агар
    lBand0: 10,
    lBand1: 32,
    lBand2: 72,
    // сетка
    gridStep: 0.1292,        // доли ширины кадра
    gridOffsetY: -0.0446,    // доли высоты кадра
    gridBoost: 11,
    // агар
    agarCenter: 66,
    agarFalloff: 34,
    agarNoiseAmp: 12,
    agarNoiseScale: 6.5,
    // обод
    rimBase: 126,
    rimSwing: 40,
    rimLightAngle: 3.05,     // рад, откуда светит (пи ~ слева)
    rimBreaks: 0.55,         // 0 = ровные кольца, 1 = сильные разрывы дуг
    glareCount: 3            // постоянные блики стекла
  };

  // Заполняет Float32Array яркостями 0..255
  function paint(lum, W, H, seed, geo) {
    var g = geo || GEO;
    var cx = g.cx * W, cy = g.cy * H;
    var R = g.rOuter * W;
    var Ragar = g.rAgar * R;
    var step = g.gridStep * W;
    var gcy = cy + g.gridOffsetY * H;
    var sc = W / 192;                       // масштаб буфера
    var nsc = g.agarNoiseScale * sc;

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        var t = d / R;

        // за ободом — чистый чёрный, как на референсе
        if (t > 1.0) { lum[i] = 0; continue; }

        var th = Math.atan2(dy, dx);

        if (t > g.rAgar) {
          // --- обод ---
          var l;
          if (t > g.rBand1) l = g.lBand0;
          else if (t > g.rBand2) l = g.lBand1;
          else if (t > g.rBand3) l = g.lBand2;
          else l = g.rimBase + g.rimSwing * Math.cos(th - g.rimLightAngle);

          // кольца обода на референсе местами разорваны + радиальные швы
          if (g.rimBreaks > 0) {
            var brk = PM.rng.fbm(Math.cos(th) * 3.1, Math.sin(th) * 3.1, seed + 313, 3);
            l *= 1 - g.rimBreaks * 0.55 * Math.max(0, brk - 0.45);
          }
          // зернистость, чтобы обод не читался как вектор
          l += (PM.rng.fbm(x / (3.5 * sc), y / (3.5 * sc), seed + 991, 2) - 0.5) * 14;
          lum[i] = l;
          continue;
        }

        // --- агар: подсветка снизу, центр светлее ---
        var rn = d / Ragar;
        var a = g.agarCenter - g.agarFalloff * rn * rn;
        a += (PM.rng.fbm(x / nsc, y / nsc, seed, 3) - 0.5)
             * 2 * g.agarNoiseAmp;

        // --- сетка под чашкой, линия ровно 1 px буфера ---
        var gx = ((x + 0.5 - cx) % step + step) % step;
        var gy = ((y + 0.5 - gcy) % step + step) % step;
        if (gx > step * 0.5) gx = step - gx;
        if (gy > step * 0.5) gy = step - gy;
        if (gx < 0.5 || gy < 0.5) a += g.gridBoost;

        // мениск: тонкое просветление у самой стенки
        if (rn > 0.965) a += 30 * (rn - 0.965) / 0.035;

        lum[i] = a;
      }
    }

    if (g.glareCount > 0) addGlare(lum, W, H, seed, g);
  }

  // Постоянные блики стекла — короткие светлые дуги у внутренней грани обода
  function addGlare(lum, W, H, seed, g) {
    var rnd = PM.rng.mulberry32(seed ^ 0x9e37);
    var cx = g.cx * W, cy = g.cy * H, R = g.rOuter * W;
    for (var k = 0; k < g.glareCount; k++) {
      var a0 = rnd() * Math.PI * 2;
      var span = 0.10 + rnd() * 0.22;
      var rr = (g.rAgar - 0.02 - rnd() * 0.06) * R;
      var steps = Math.ceil(span * rr * 2);
      for (var s = 0; s <= steps; s++) {
        var f = s / steps;
        var th = a0 + (f - 0.5) * span;
        var fall = Math.sin(f * Math.PI);          // затухание к концам дуги
        for (var w = -Math.round(W / 192); w <= Math.round(W / 192); w++) {
          var x = Math.round(cx + Math.cos(th) * (rr + w));
          var y = Math.round(cy + Math.sin(th) * (rr + w));
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          var i = y * W + x;
          lum[i] += 42 * fall * (w === 0 ? 1 : 0.45);
        }
      }
    }
  }

  // Маска агара — куда можно ставить споры и где растёт плесень
  function agarMask(W, H, geo) {
    var g = geo || GEO;
    var cx = g.cx * W, cy = g.cy * H, R = g.rOuter * W, Ragar = g.rAgar * R;
    var m = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        m[y * W + x] = (dx * dx + dy * dy) <= Ragar * Ragar ? 1 : 0;
      }
    }
    return m;
  }

  return { GEO: GEO, paint: paint, agarMask: agarMask };
})();
