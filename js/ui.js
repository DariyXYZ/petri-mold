var PM = PM || {};

PM.ui = (function () {
  var api, forced = '';

  function el(id) { return document.getElementById(id); }

  function bindRange(id, get, set, onChange) {
    var e = el(id), out = el(id + '-val');
    if (!e) return;
    e.value = get();
    if (out) out.textContent = get();
    e.addEventListener('input', function () {
      set(parseFloat(e.value));
      if (out) out.textContent = e.value;
      (onChange || api.redraw)();
    });
  }

  function syncAmp() {
    el('amp').value = PM.render.getAmp();
    el('amp-val').textContent = Math.round(PM.render.getAmp());
  }

  // Статусная строка под чашкой
  function sync() {
    var st = api.getState();
    var pts = api.getPoints().length;
    var LABEL = {
      inoculate: 'поставь споры кликами внутри чашки · ' + pts + '/' + api.MAX_SPORES,
      growing: 'растёт',
      mature: 'созревает',
      done: 'готово'
    };
    var line = LABEL[st] || st;
    if (st === 'growing' || st === 'mature' || st === 'done') {
      var cs = api.getColonies().map(function (c) { return c.archetype; });
      var count = {};
      cs.forEach(function (a) { count[a] = (count[a] || 0) + 1; });
      line += ' · ' + Object.keys(count).map(function (k) {
        return k + (count[k] > 1 ? '×' + count[k] : '');
      }).join(' ');
      line += ' · tick ' + api.getTick();
    }
    el('status').textContent = line;

    var s = el('start');
    s.disabled = !(st === 'inoculate' && pts > 0);
    s.textContent = st === 'inoculate' ? 'ЗАПУСТИТЬ'
                  : (st === 'done' ? 'ГОТОВО' : 'РАСТЁТ…');
  }

  function init(a) {
    api = a;

    // палитра
    var pal = el('pal');
    var PLAB = { grey8: '8 нейтр.', tint6: '6 тониров.', grey5: '5 грубо' };
    PM.palette.names().forEach(function (n) {
      var o = document.createElement('option');
      o.value = n; o.textContent = PLAB[n] || n;
      pal.appendChild(o);
    });
    pal.value = PM.palette.getName();
    pal.addEventListener('change', function () {
      PM.palette.setName(pal.value);
      PM.render.setAmp(PM.palette.autoAmp());
      syncAmp();
      api.redraw();
    });

    // принудительный архетип (по умолчанию — случайный)
    var arch = el('arch');
    var ALAB = { velvet: 'бархат', bubble: 'пузыри', hyphal: 'гифы',
                 lobed: 'лопасти', rings: 'кольца', rosette: 'розетка',
                 dendrite: 'дендрит', film: 'плёнка', halo: 'облако',
                 crater: 'призрак' };
    PM.growth.names().forEach(function (n) {
      var o = document.createElement('option');
      o.value = n; o.textContent = ALAB[n] || n;
      arch.appendChild(o);
    });
    arch.value = '';
    arch.addEventListener('change', function () { forced = arch.value; });

    // дизеринг
    var dith = el('dither');
    dith.checked = PM.render.getDither();
    dith.addEventListener('change', function () {
      PM.render.setDither(dith.checked);
      api.redraw();
    });
    bindRange('amp', PM.render.getAmp, PM.render.setAmp);

    bindRange('speed', api.getSpeed, api.setSpeed, function () {});

    // параметры чашки — требуют перепечь фон
    var G = PM.dish.GEO;
    var bgKeys = [
      ['agar-c', 'agarCenter'], ['agar-f', 'agarFalloff'],
      ['noise', 'agarNoiseAmp'], ['nscale', 'agarNoiseScale'],
      ['grid', 'gridBoost'], ['rim-b', 'rimBase'], ['rim-s', 'rimSwing'],
      ['rim-k', 'rimBreaks'], ['glare', 'glareCount']
    ];
    bgKeys.forEach(function (p) {
      bindRange(p[0],
        function () { return G[p[1]]; },
        function (v) { G[p[1]] = v; },
        api.redrawBackground);
    });

    el('start').addEventListener('click', api.start);
    el('reseed').addEventListener('click', function () { api.reseed(); });
    el('again').addEventListener('click', api.sameSeed);
    el('save').addEventListener('click', function () {
      var link = document.createElement('a');
      link.download = 'petri-' + api.dims() + '-' + api.getSeed() + '.png';
      link.href = el('stage').toDataURL('image/png');
      link.click();
    });

    document.addEventListener('keydown', function (e) {
      var t = e.target.tagName;
      if (t === 'INPUT' || t === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); api.start(); }
      if (e.key === 'r' || e.key === 'R') api.reseed();
      if (e.key === 'a' || e.key === 'A') api.sameSeed();
      if (e.key === 'd' || e.key === 'D') el('panel').classList.toggle('hidden');
      if (e.key === 's' || e.key === 'S') el('save').click();
    });
  }

  return {
    init: init,
    sync: function () { if (api) sync(); },
    forcedArchetype: function () { return forced || null; }
  };
})();
