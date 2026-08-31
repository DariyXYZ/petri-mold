var PM = PM || {};

// Композитинг: фон чашки (кэшируется) + биомасса + полупрозрачный слой + маркеры спор.
PM.scene = (function () {
  var TAU = Math.PI * 2;

  // Текстура внутренности колонии. Форма фронта у видов похожая — на глаз их
  // различает именно заполнение, поэтому оно вынесено в отдельную функцию.
  // Текстура внутренности колонии. Возвращает ДЕЛЬТУ к яркости, а не готовое
  // значение: вызывающий домножает её на степень зрелости, поэтому узор
  // проступает постепенно, а не включается скачком, когда пятно доросло.
  function texture(kind, c, dens, age, k1, x, y, dx, dy, sc, rx, ry) {
    var ss = PM.rng.smoothstep;

    switch (kind) {

      // Резкие концентрические зоны мишени. Радиус искажаем шумом, иначе
      // границы зон выходят идеальными окружностями, чего у плесени не бывает.
      case 'zones': {
        var dz = Math.sqrt(dx * dx + dy * dy);
        if (dz < 3 * sc) return 0;
        dz += (PM.rng.fbm(rx / (13 * sc), ry / (13 * sc), c.seed + 205, 3) - 0.5)
              * c.ringPeriod * 1.6;
        var band = dz / c.ringPeriod;
        band -= Math.floor(band);
        var v = ss(0.04, 0.26, band) - ss(0.48, 0.72, band);
        return (v * 2 - 1) * c.a.ringAmp;
      }

      // Крап спороносцев
      case 'speckle': {
        var sp = PM.rng.fbm(rx / (3.9 * sc), ry / (3.9 * sc), c.seed + 77, 2);
        return -74 * ss(0.58, 0.86, sp);
      }

      // Сетка трещин. Координаты сначала искажаются, потом берётся гребень шума,
      // а толщина линии гуляет — иначе это выглядит как начерченная сетка.
      case 'crackle': {
        var w2 = PM.rng.warp(rx, ry, c.seed + 55, 5.5 * sc, 13 * sc);
        var cr = PM.rng.fbm(w2[0] / (9 * sc), w2[1] / (9 * sc), c.seed + 91, 2);
        var ridge = Math.abs(cr - 0.5);
        var thick = (0.020 + 0.042 *
                     PM.rng.fbm(rx / (17 * sc), ry / (17 * sc), c.seed + 133, 1));
        return -82 * (1 - ss(thick * 0.35, thick, ridge));
      }

      default:
        return 0;
    }
  }

  function overlay(lum, f, colonies) {
    var W = f.W, n = f.n;
    var own = f.owner, dens = f.density, birth = f.birth, film = f.film;
    var texBuf = f.texBuf, texSet = f.texSet;
    var mottBuf = f.mottBuf, cavBuf = f.cavBuf;
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

            // Всё, что зависит только от координат, считается один раз и живёт
            // в кэше: трёхоктавный шум на каждый пиксель каждого кадра съедал
            // половину бюджета 60 fps.
            if (!texSet[i]) {
              mottBuf[i] = PM.rng.fbm(x / (16 * sc), y / (16 * sc), c.seed + 863, 3);
              cavBuf[i] = PM.rng.fbm(x / (7 * sc), y / (7 * sc), c.seed + 613, 2);
              if (c.a.texture !== 'smooth') {
                // Координаты повёрнуты на угол колонии: value-шум строится по
                // целочисленной решётке и в резонансе с пиксельной сеткой даёт муар.
                var rx = x * c.rotC - y * c.rotS;
                var ry = x * c.rotS + y * c.rotC;
                texBuf[i] = texture(c.a.texture, c, dens[i], age, k1,
                                    x, y, dx, dy, sc, rx, ry);
              }
              texSet[i] = 1;
            }

            var l = dens[i] * (1 - 0.35 * k1) * (0.88 + 0.24 * mottBuf[i]);

            // Зрелость применяется при чтении: узор набирает силу вместе с
            // колонией, а не включается скачком, когда пятно доросло.
            if (texBuf[i]) {
              var ripe = PM.rng.smoothstep(40 * sc * sc, 620 * sc * sc, c.cells);
              if (ripe > 0.002) l += texBuf[i] * ripe * (1 - k1 * 0.45);
            }

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
            if (k1 > 0.7 && cavBuf[i] > 0.56) {
              l -= (cavBuf[i] - 0.56) * 190 * (k1 - 0.7) / 0.3;
            }

            // активная кромка, но не поверх и без того ярких контуров пузырей
            if (edge && dens[i] < 180) l += 30 * (1 - k1 * 0.6);

            // шов между территориями: тёмная линия делает границы читаемыми
            if (seam) l -= 34 + 18 * (cavBuf[i] - 0.5);

            lum[i] = l;
          }
        }
      }

      // прозрачный слой идёт последним — он и создаёт наслоения
      var fv = film[i];
      if (fv) lum[i] += fv * 0.38;
    }
  }

  // Маркеры посевов до старта: точка в тонком кольце — прицел, который не
  // спорит с картинкой. Номер подписывается шрифтом поверх кадра (см. main.js).
  function markers(lum, f, points) {
    var W = f.W, H = f.H;
    var sc = f.scale || 1;
    var rad = 3.4 * sc;
    var ri = Math.ceil(rad) + 1;
    // кольцо ровно в один пиксель буфера: прицел должен быть тонким
    var inner = (rad - 0.5) * (rad - 0.5), outer = (rad + 0.5) * (rad + 0.5);

    for (var p = 0; p < points.length; p++) {
      var cx = points[p].x, cy = points[p].y;

      for (var y = cy - ri; y <= cy + ri; y++) {
        for (var x = cx - ri; x <= cx + ri; x++) {
          var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
          if (d2 >= inner && d2 <= outer) put(lum, W, H, x, y, 152);
        }
      }
      put(lum, W, H, cx, cy, 238);          // ровно точка клика
    }
  }

  function put(lum, W, H, x, y, v) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    lum[y * W + x] = v;
  }

  return { overlay: overlay, markers: markers };
})();
