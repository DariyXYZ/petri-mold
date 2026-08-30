var PM = PM || {};

// Композитинг: фон чашки (кэшируется) + биомасса + полупрозрачный слой + маркеры спор.
PM.scene = (function () {
  var TAU = Math.PI * 2;

  // Текстура внутренности колонии. Форма фронта у видов похожая — на глаз их
  // различает именно заполнение, поэтому оно вынесено в отдельную функцию.
  function texture(kind, c, l, age, k1, x, y, dx, dy, sc) {
    switch (kind) {

      // резкие концентрические зоны — мишень
      case 'zones': {
        var z = age / c.ringPeriod;
        var band = z - Math.floor(z);
        return l + (band < 0.44 ? 1 : -1) * c.a.ringAmp * (1 - k1 * 0.55);
      }

      // радиальные борозды: ширина постоянная в пикселях, а не угловая
      case 'grooves': {
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 2) return l;
        var off = Math.abs(Math.sin(Math.atan2(dy, dx) * c.lobes + c.dirAngle)) * dist;
        var wg = 1.3 * sc;
        return off < wg ? l - 46 * (1 - off / wg) : l;
      }

      // одна борозда поперёк — делит колонию на две доли
      case 'groove': {
        var pr = dx * Math.cos(c.dirAngle) + dy * Math.sin(c.dirAngle);
        var w = 1.6 * sc;
        return Math.abs(pr) < w ? l - 58 * (1 - Math.abs(pr) / w) : l;
      }

      // мелкая складчатость — общая фактура, не зависящая от центра
      case 'wrinkle': {
        var wr = PM.rng.fbm(x / (4.5 * sc), y / (4.5 * sc), c.seed + 129, 2);
        return l + (Math.abs(wr - 0.5) < 0.06 ? -38 : 0);
      }

      // тёмный крап спороносцев
      case 'speckle': {
        var sp = PM.rng.fbm(x / (2.1 * sc), y / (2.1 * sc), c.seed + 77, 1);
        return sp > 0.60 ? l - 74 * (sp - 0.60) / 0.40 : l;
      }

      // сетка трещин: тёмные линии по гребням шума
      case 'crackle': {
        var cr = PM.rng.fbm(x / (9 * sc), y / (9 * sc), c.seed + 91, 2);
        var ridge = Math.abs(cr - 0.5);
        return ridge < 0.045 ? l - 82 * (1 - ridge / 0.045) : l;
      }

      // рыхлая крупная зернистость
      case 'fuzz': {
        var fz = PM.rng.fbm(x / (2.8 * sc), y / (2.8 * sc), c.seed + 37, 3);
        return l + (fz - 0.5) * 74;
      }

      default:
        return l;
    }
  }

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
          var edge = (l4 === 0) || (r4 === 0) || (u4 === 0) || (d4 === 0);
          var seam = (l4 && l4 !== o) || (r4 && r4 !== o) ||
                     (u4 && u4 !== o) || (d4 && d4 !== o);

          // кольцо-призрак: тело прозрачное, видна только кайма
          if (c.a.hollow && !edge && !seam) { /* оставляем агар */ }
          else {
            var x = i % W, y = (i / W) | 0;
            var dx = x - c.x, dy = y - c.y;

            var l = dens[i] * (1 - 0.35 * k1);
            l = texture(c.a.texture, c, l, age, k1, x, y, dx, dy, sc);

            // Пушистая опушка по краю. Ширину задаёт возраст относительно момента,
            // когда колония в последний раз росла: свежие клетки и есть периметр.
            // Поэтому опушка не пропадает, когда фронт останавливается.
            if (c.a.haloB) {
              var fresh = (c.lastGrow || tick) - birth[i];
              if (fresh >= 0 && fresh < c.haloAge) {
                l += c.a.haloB * (1 - fresh / c.haloAge);
              }
            }

            // лизис: в старой биомассе прогорают тёмные каверны
            if (k1 > 0.7) {
              var cav = PM.rng.fbm(x / (7 * sc), y / (7 * sc), c.seed + 613, 2);
              if (cav > 0.56) l -= (cav - 0.56) * 190 * (k1 - 0.7) / 0.3;
            }

            // активная кромка, но не поверх и без того ярких контуров пузырей
            if (edge && dens[i] < 180) l += 30 * (1 - k1 * 0.6);

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
    var r = Math.round(2 * (f.scale || 1));
    for (var p = 0; p < points.length; p++) {
      var x = points[p].x, y = points[p].y;
      for (var d = -r; d <= r; d++) {
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
