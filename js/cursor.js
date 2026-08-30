var PM = PM || {};

// Пиксельный пинцет вместо курсора. Два состояния: разомкнутый и сомкнутый —
// сомкнутый означает, что спора взята и её осталось посадить.
// Инструмент лежит по диагонали, кончики смотрят влево-вверх, как на снимке
// анатомического пинцета: рабочая точка — там, куда приходится клик.
PM.cursor = (function () {
  var N = 18;          // сетка рисунка
  var PX = 2;          // сколько экранных точек в одном «пикселе»
  var TIP = [2, 5];    // кончик нижней бранши — сюда приходится клик

  // Ручка: толстая полоса от развилки к пятке
  var HANDLE = [
    [8, 8], [9, 8], [9, 9], [10, 9], [10, 10], [11, 10], [11, 11], [12, 11],
    [12, 12], [13, 12], [13, 13], [14, 13], [14, 14], [15, 14], [15, 15], [16, 15]
  ];

  // Нижняя бранша — общая для обоих состояний
  var LOWER = [[8, 8], [7, 8], [6, 7], [5, 7], [4, 6], [3, 6], [2, 5]];

  // Верхняя: в разомкнутом уходит вверх, в сомкнутом ложится на нижнюю
  var UPPER_OPEN = [[8, 8], [8, 7], [7, 6], [7, 5], [6, 4], [6, 3], [5, 2]];
  var UPPER_SHUT = [[8, 8], [8, 7], [7, 7], [6, 6], [5, 6], [4, 5], [3, 5], [2, 4]];

  var cache = {};

  function render(open) {
    var key = open ? 'open' : 'shut';
    if (cache[key]) return cache[key];

    var grid = new Uint8Array(N * N);

    function set(pts) {
      for (var k = 0; k < pts.length; k++) {
        var x = pts[k][0], y = pts[k][1];
        if (x >= 0 && y >= 0 && x < N && y < N) grid[y * N + x] = 1;
      }
    }
    set(HANDLE);
    set(LOWER);
    set(open ? UPPER_OPEN : UPPER_SHUT);

    // Обводка: пустая клетка рядом с металлом чернеет, чтобы инструмент
    // читался и на светлой колонии, и на чёрном фоне.
    var out = grid.slice();
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        if (grid[y * N + x]) continue;
        var near = false;
        for (var dy = -1; dy <= 1 && !near; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            if (grid[ny * N + nx]) { near = true; break; }
          }
        }
        if (near) out[y * N + x] = 2;
      }
    }

    var rects = '';
    for (var q = 0; q < out.length; q++) {
      if (!out[q]) continue;
      rects += "%3Crect x='" + (q % N) + "' y='" + ((q / N) | 0) +
               "' width='1' height='1' fill='" +
               (out[q] === 1 ? '%23f2f2f2' : '%23000') + "'/%3E";
    }

    var svg = "%3Csvg xmlns='http://www.w3.org/2000/svg' width='" + (N * PX) +
              "' height='" + (N * PX) + "' viewBox='0 0 " + N + " " + N +
              "' shape-rendering='crispEdges'%3E" + rects + "%3C/svg%3E";

    cache[key] = 'url("data:image/svg+xml;utf8,' + svg + '") ' +
                 (TIP[0] * PX) + ' ' + (TIP[1] * PX) + ', crosshair';
    return cache[key];
  }

  function apply(el, holding) {
    el.style.cursor = render(!holding);
  }

  return { apply: apply, render: render };
})();
