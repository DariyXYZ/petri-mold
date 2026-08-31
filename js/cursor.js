var PM = PM || {};

// Большой пинцет вместо курсора. Картинка — фотография анатомического пинцета,
// прогнанная через ту же пикселизацию, что и вся сцена: даунсемпл, квантование
// в палитру проекта, жёсткая альфа. Иначе фотоинструмент выпадал бы из кадра.
//
// Пинцет всё время держит спору (сомкнут) и разжимается в момент клика —
// это и есть жест «отпустили спору над чашкой». Точка, где сходятся бранши,
// приходится ровно на курсор.
PM.cursor = (function () {
  var W = 320;                       // ширина инструмента на экране
  // Рабочая точка — там, где сходятся бранши, а не левый угол картинки:
  // слева от него идёт загнутая верхняя бранша.
  var HOT = {
    open: [0.135, 0.055],
    shut: [0.065, 0.020]
  };

  var img = null, host = null, shown = false;
  var openNow = false, relaxTimer = 0;

  function ensure() {
    if (img) return;
    img = document.createElement('img');
    img.id = 'tool';
    img.alt = '';
    img.src = 'assets/tweezers-shut.png';
    document.body.appendChild(img);
  }

  function place(x, y) {
    var hot = HOT[openNow ? 'open' : 'shut'];
    var h = img.naturalHeight && img.naturalWidth
          ? W * img.naturalHeight / img.naturalWidth
          : W;
    img.style.width = W + 'px';
    img.style.left = (x - hot[0] * W) + 'px';
    img.style.top = (y - hot[1] * h) + 'px';
  }

  function setOpen(v, x, y) {
    if (openNow === v) return;
    openNow = v;
    if (!img) return;
    img.src = 'assets/tweezers-' + (v ? 'open' : 'shut') + '.png';
    if (x !== undefined) place(x, y);
  }

  // Короткий разжим на клике: спора выпала, бранши сомкнулись обратно.
  function release(x, y) {
    setOpen(true, x, y);
    clearTimeout(relaxTimer);
    relaxTimer = setTimeout(function () { setOpen(false, x, y); }, 260);
  }

  function show(on) {
    if (!img) return;
    shown = on;
    img.style.display = on ? 'block' : 'none';
  }

  // Инструмент живёт только там, где им работают: над чашкой и только пока
  // расставляются споры. На сенсорном экране курсора нет вовсе.
  function attach(canvas, isActive) {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    ensure();
    host = canvas;
    canvas.classList.add('has-tool');

    canvas.addEventListener('pointermove', function (e) {
      if (!isActive()) { show(false); return; }
      show(true);
      place(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerleave', function () { show(false); });
    canvas.addEventListener('pointerdown', function (e) {
      if (!isActive()) return;
      place(e.clientX, e.clientY);
      release(e.clientX, e.clientY);
    });
  }

  return { attach: attach, release: release, show: show };
})();
