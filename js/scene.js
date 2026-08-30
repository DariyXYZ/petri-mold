var PM = PM || {};

// Композитинг: фон чашки (кэшируется) + биомасса + плёнка + маркеры спор.
PM.scene = (function () {
  var TAU = Math.PI * 2;

  // Биомасса поверх готового фона
  function overlay(lum, f, colonies) {
    var W = f.W, n = f.n;
    var own = f.owner, dens = f.density, birth = f.birth, film = f.film;
    var tick = f.tick;

    var byId = [];
    for (var k = 0; k < colonies.length; k++) byId[colonies[k].id] = colonies[k];

    for (var i = 0; i < n; i++) {
      var o = own[i];

      if (o) {
        var c = byId[o];
        if (c) {
          var age = tick - birth[i];
          var k1 = age / c.decayAge; if (k1 > 1) k1 = 1;

          var edge = (own[i - 1] === 0) || (own[i + 1] === 0) ||
                     (own[i - W] === 0) || (own[i + W] === 0);

          // кольцо-призрак: тело прозрачное, видна только кайма
          if (c.a.hollow && !edge) { /* оставляем агар */ }
          else {
            // старая биомасса темнеет
            var l = dens[i] * (1 - 0.35 * k1);

            // возрастные кольца спороношения
            if (c.a.ringAmp) {
              l += c.a.ringAmp * Math.sin(age / c.ringPeriod * TAU) * (1 - k1 * 0.7);
            }

            // активная кромка, но не поверх и без того ярких контуров пузырей
            if (edge && dens[i] < 180) l += 38 * (1 - k1 * 0.6);

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
