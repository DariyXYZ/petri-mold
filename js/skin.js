var PM = PM || {};

// Поведение кнопок. Уголки при наведении и выборе рисует css (маска на
// рамке псевдоэлемента), здесь только одно: нажатие держится не меньше
// 220 мс через класс .pressed — кнопка «дожимается», даже если клик был
// мгновенным.
PM.skin = (function () {
  function press(btn) {
    var t0 = 0;
    btn.addEventListener('pointerdown', function () {
      if (btn.disabled) return;
      t0 = performance.now();
      btn.classList.add('pressed');
    });
    function up() {
      if (!btn.classList.contains('pressed')) return;
      var left = Math.max(0, 220 - (performance.now() - t0));
      setTimeout(function () { btn.classList.remove('pressed'); }, left);
    }
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  function init() {
    var b = document.querySelectorAll('button:not(.tile)');
    for (var i = 0; i < b.length; i++) press(b[i]);
  }

  return { init: init };
})();
