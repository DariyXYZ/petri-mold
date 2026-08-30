var PM = PM || {};

// Композитинг: фон чашки (кэшируется) + биомасса + плёнка + маркеры спор.
PM.scene = (function () {
  var TAU = Math.PI * 2;

  // Биомасса поверх готового фона
  function overlay(lum, f, colonies) {
    var W = f.W, n = f.n;
    var own = f.owner, dens = f.density, birth = f.birth, film = f.film;
    var tick = f.tick, sc = f.scale || 1;

    var byId = [];
    for (var k = 0; k < colonies.length; k++) byId[colonies[k].id] = colonies[k];

    for (var i = 0; i < n; i++) {
      var o = own[i];

      if (o) {
        var c = byId[o];
        if (c) {
          var age = tick - birth[i];
          var k1 = age / c.decayAge; if (k1 > 1) k1 = 1;

          var l4 = own[i - 1], r4 = own[i + 1], u4 = own[i - W], d4 = own[i + W];
          var edge  = (l4 === 0) || (r4 === 0) || (u4 === 0) || (d4 === 0);
          // граница с чужой колонией — отдельный случай, из неё делается шов
          var seam  = (l4 && l4 !== o) || (r4 && r4 !== o) ||
                      (u4 && u4 !== o) || (d4 && d4 !== o);

          // кольцо-призрак: тело прозрачное, видна только кайма
          if (c.a.hollow && !edge && !seam) { /* оставляем агар */ }
          else {
            var l = dens[i] * (1 - 0.35 * k1);

            // возрастные кольца спороношения
            if (c.a.ringAmp) {
              l += c.a.ringAmp * Math.sin(age / c.ringPeriod * TAU) * (1 - k1 * 0.7);
            }

            // лизис: в старой биомассе прогорают тёмные каверны
            if (k1 > 0.7) {
              var x = i % W, y = (i / W) | 0;
              var cav = PM.rng.fbm(x / (7 * sc), y / (7 * sc), c.seed + 613, 2);
              if (cav > 0.56) l -= (cav - 0.56) * 190 * (k1 - 0.7) / 0.3;
            }

            // активная кромка, но не поверх и без того ярких контуров пузырей
            if (edge && dens[i] < 180) l += 38 * (1 - k1 * 0.6);

            // шов между территориями: тёмная линия делает границы читаемыми
            if (seam) l -= 34;

            lum[i] = l;
          }
        }
      }

      // прозрачный слой идёт последним — он и создаёт наслоения
      var fv = film[i];
      if (fv) lum[i] += fv * 0.38;
    }
  }

  // Маркеры спор до старта: крестик
  function markers(lum, f, points) {
    var W = f.W, H = f.H;
    for (var p = 0; p < points.length; p++) {
      var x = points[p].x, y = points[p].y;
      for (var d = -2; d <= 2; d++) {
        put(lum, W, H, x + d, y, d === 0 ? 250 : 190);
        put(lum, W, H, x, y + d, d === 0 ? 250 : 190);
      }
    }
  }

  function put(lum, W, H, x, y, v) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    lum[y * W + x] = v;
  }

  return { overlay: overlay, markers: markers };
})();
