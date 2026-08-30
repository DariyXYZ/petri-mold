var PM = PM || {};

// Композитинг: фон чашки (кэшируется) + биомасса + полупрозрачный слой + маркеры спор.
PM.scene = (function () {
  var TAU = Math.PI * 2;

  // Текстура внутренности колонии. Форма фронта у видов похожая — на глаз их
  // различает именно заполнение, поэтому оно вынесено в отдельную функцию.
  function texture(kind, c, l, age, k1, x, y, dx, dy, sc) {
    var ss = PM.rng.smoothstep;

    // Мелкая колония + высокочастотный узор = орнамент, которого в природе нет.
    // На маленьких пятнах оставляем только тон.
    if (c.cells < 520 * sc * sc && kind !== 'smooth') {
      if (kind !== 'speckle' && kind !== 'fuzz') return l;
    }

    // Координаты поворачиваем на угол колонии. Value-шум строится по целочисленной
    // решётке и, попадая в резонанс с пиксельной сеткой и матрицей Байера, даёт
    // муар — те самые кружевные решётки. Поворот разрушает это выравнивание.
    var ca = c.rotC, sa = c.rotS;
    var rx = x * ca - y * sa, ry = x * sa + y * ca;

    switch (kind) {

      // Резкие концентрические зоны мишени. Возраст подмешан шумом, иначе
      // границы зон выходят идеальными окружностями, чего у плесени не бывает.
      case 'zones': {
        var dz = Math.sqrt(dx * dx + dy * dy);
        if (dz < 3 * sc) return l;
        // радиус искажаем шумом, иначе зоны выходят циркульными окружностями
        dz += (PM.rng.fbm(rx / (13 * sc), ry / (13 * sc), c.seed + 205, 3) - 0.5)
              * c.ringPeriod * 1.6;
        var band = dz / c.ringPeriod;
        band -= Math.floor(band);
        var v = ss(0.04, 0.26, band) - ss(0.48, 0.72, band);
        return l + (v * 2 - 1) * c.a.ringAmp * (1 - k1 * 0.45);
      }

      // Радиальные борозды. Три поправки против «спиц»: закрутка по радиусу,
      // дрожание угла шумом и переменная толщина.
      case 'grooves': {
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 6 * sc) return l;
        var wob = (PM.rng.fbm(rx / (6 * sc), ry / (6 * sc), c.seed + 311, 2) - 0.5) * 0.55;
        var th = Math.atan2(dy, dx) + dist * c.swirl + wob;
        var off = Math.abs(Math.sin(th * c.lobes)) * dist;
        var wg = (1.0 + 1.1 * PM.rng.fbm(rx / (14 * sc), ry / (14 * sc), c.seed + 7, 1)) * sc;
        return l - 46 * (1 - ss(0, wg, off));
      }

      // Борозда двудольной: изогнута шумом, к краям сходит на нет.
      case 'groove': {
        var pr = dx * Math.cos(c.dirAngle) + dy * Math.sin(c.dirAngle);
        pr += (PM.rng.fbm(rx / (9 * sc), ry / (9 * sc), c.seed + 421, 2) - 0.5) * 7 * sc;
        var w = 1.9 * sc;
        return l - 58 * (1 - ss(0, w, Math.abs(pr)));
      }

      // Крап спороносцев
      case 'speckle': {
        var sp = PM.rng.fbm(rx / (3.9 * sc), ry / (3.9 * sc), c.seed + 77, 2);
        return l - 74 * ss(0.58, 0.86, sp);
      }

      // Сетка трещин. Координаты сначала искажаются, потом берётся гребень шума,
      // а толщина линии гуляет — иначе это выглядит как начерченная сетка.
      case 'crackle': {
        var w2 = PM.rng.warp(rx, ry, c.seed + 55, 5.5 * sc, 13 * sc);
        var cr = PM.rng.fbm(w2[0] / (9 * sc), w2[1] / (9 * sc), c.seed + 91, 2);
        var ridge = Math.abs(cr - 0.5);
        var thick = (0.020 + 0.042 *
                     PM.rng.fbm(rx / (17 * sc), ry / (17 * sc), c.seed + 133, 1));
        return l - 82 * (1 - ss(thick * 0.35, thick, ridge));
      }

      // Рыхлая зернистость
      case 'fuzz': {
        var fz = PM.rng.fbm(rx / (4.2 * sc), ry / (4.2 * sc), c.seed + 37, 3);
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

            var mott = PM.rng.fbm(x / (16 * sc), y / (16 * sc), c.seed + 863, 3);
            var l = dens[i] * (1 - 0.35 * k1) * (0.88 + 0.24 * mott);
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
            if (seam) {
              l -= 34 + 18 * (PM.rng.fbm(x / (5 * sc), y / (5 * sc),
                                         c.seed + 977, 1) - 0.5);
            }

            lum[i] = l;
          }
        }
      }

      // прозрачный слой идёт последним — он и создаёт наслоения
      var fv = film[i];
      if (fv) lum[i] += fv * 0.38;
    }
  }

  // Цифры 3x5 для нумерации посевов
  // Цифры 3x5 для нумерации посевов
  var DIGITS = [
    ['111','101','101','101','111'], ['010','110','010','010','111'],
    ['111','001','111','100','111'], ['111','001','111','001','111'],
    ['101','101','111','001','001'], ['111','100','111','001','111'],
    ['111','100','111','101','111'], ['111','001','010','010','010'],
    ['111','101','111','101','111'], ['111','101','111','001','111']
  ];

  function digit(lum, W, H, d, x0, y0, k, v) {
    var rows = DIGITS[d];
    for (var r = 0; r < 5; r++) {
      for (var c = 0; c < 3; c++) {
        if (rows[r][c] !== '1') continue;
        for (var a = 0; a < k; a++) {
          for (var b = 0; b < k; b++) {
            put(lum, W, H, x0 + c * k + b, y0 + r * k + a, v);
          }
        }
      }
    }
  }

  // Маркеры посевов до старта: крестик и номер. После запуска не рисуются —
  // подписи нужны, пока расставляешь, и мешают, когда смотришь на рост.
  function markers(lum, f, points) {
    var W = f.W, H = f.H;
    var sc = f.scale || 1;
    var r = Math.round(2 * sc);
    var k = Math.max(1, Math.round(sc));

    for (var p = 0; p < points.length; p++) {
      var x = points[p].x, y = points[p].y;
      for (var d = -r; d <= r; d++) {
        put(lum, W, H, x + d, y, d === 0 ? 250 : 190);
        put(lum, W, H, x, y + d, d === 0 ? 250 : 190);
      }

      var num = String(p + 1);
      var gx = x + r + 2 * k;
      var gy = y - 2 * k;
      for (var i = 0; i < num.length; i++) {
        // тёмная подложка, чтобы цифра читалась на любом агаре
        for (var by = -1; by <= 5 * k; by++) {
          for (var bx = -1; bx <= 3 * k; bx++) {
            put(lum, W, H, gx + bx, gy + by, 18);
          }
        }
        digit(lum, W, H, +num[i], gx, gy, k, 245);
        gx += 4 * k;
      }
    }
  }

  function put(lum, W, H, x, y, v) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    lum[y * W + x] = v;
  }

  return { overlay: overlay, markers: markers };
})();
