var PM = PM || {};

// Палитры. Уровень = {l, r, g, b}: l — яркость для выбора ближайшего,
// rgb — что реально пишем в пиксель (может быть тонированным).
PM.palette = (function () {

  function grey(l) { return { l: l, r: l, g: l, b: l }; }

  function tint(hex) {
    var r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    return { l: r * 0.299 + g * 0.587 + b * 0.114, r: r, g: g, b: b };
  }

  var SETS = {
    // 8 нейтральных уровней, замерены по референсу (см. 02 - Visual Spec)
    grey8: [0, 26, 51, 77, 102, 140, 179, 230].map(grey),
    // 6 слегка тонированных: тени в холод, света в тепло (вариант Codex)
    tint6: [0x000000, 0x111314, 0x303436, 0x666b6b, 0xb8bdbc, 0xf0f1ed].map(tint),
    // грубый вариант для проверки, насколько далеко можно уйти
    grey5: [0, 45, 96, 158, 224].map(grey)
  };

  var current = 'grey8';

  // Bayer 4x4 — упорядоченный дизеринг
  var BAYER4 = [
     0,  8,  2, 10,
    12,  4, 14,  6,
     3, 11,  1,  9,
    15,  7, 13,  5
  ];

  // Таблица «яркость -> индекс уровня». Без неё на 148k пикселей поиск
  // ближайшего уровня перебором съедает кадр.
  var LUT_OFF = 64, LUT_N = 512;
  var lut = null;

  function buildLUT() {
    var r = SETS[current];
    lut = new Uint8Array(LUT_N);
    for (var v = 0; v < LUT_N; v++) {
      var l = v - LUT_OFF, best = 0, bd = 1e9;
      for (var k = 0; k < r.length; k++) {
        var d = r[k].l - l; if (d < 0) d = -d;
        if (d < bd) { bd = d; best = k; }
      }
      lut[v] = best;
    }
  }

  function ramp() { return SETS[current]; }
  function table() { if (!lut) buildLUT(); return lut; }

  // средний шаг текущей палитры — разумный дефолт для силы дизера
  function autoAmp() {
    var r = ramp();
    return (r[r.length - 1].l - r[0].l) / (r.length - 1);
  }

  return {
    SETS: SETS,
    BAYER4: BAYER4,
    ramp: ramp,
    autoAmp: autoAmp,
    names: function () { return Object.keys(SETS); },
    getName: function () { return current; },
    table: table,
    LUT_OFF: LUT_OFF,
    LUT_N: LUT_N,
    setName: function (n) { if (SETS[n]) { current = n; buildLUT(); } }
  };
})();
