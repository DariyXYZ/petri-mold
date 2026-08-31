var PM = PM || {};

PM.ui = (function () {
  var api;
  var brush = '';          // '' = random strain

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

  // ---------- палитра штаммов ----------

  function buildBrushes() {
    var box = el('brushes');
    var names = PM.growth.names();

    // случайный штамм — первой кнопкой
    box.appendChild(makeTile('', 'Random strain', 'any of the fifteen'));

    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      box.appendChild(makeTile(n, PM.growth.latin(n), PM.growth.desc(n)));
    }
    select('');
  }

  function makeTile(name, latin, desc) {
    var b = document.createElement('button');
    b.className = 'tile';
    b.dataset.strain = name;
    b.title = latin + ' — ' + desc;

    if (name) {
      b.appendChild(PM.preview.build(name));
    } else {
      var q = document.createElement('span');
      q.className = 'anymark';
      q.textContent = '?';
      b.appendChild(q);
    }

    var cap = document.createElement('span');
    cap.className = 'cap';
    // в подписи видовой эпитет: род длинный и часто повторяется
    cap.textContent = name ? latin.split(' ')[1] : 'random';
    b.appendChild(cap);

    b.addEventListener('click', function () { select(name); });
    return b;
  }

  function select(name) {
    brush = name;
    var tiles = document.querySelectorAll('#strains .tile');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].classList.toggle('on', tiles[i].dataset.strain === name);
    }
    el('strain-info').innerHTML = name
      ? '<b>' + PM.growth.latin(name) + '</b><br>' + PM.growth.desc(name)
      : '<em>Random strain — a different species each time.</em>';
  }

  // ---------- статус ----------

  function sync() {
    var st = api.getState();
    var pts = api.getPoints().length;

    if (st === 'inoculate') {
      el('phase').textContent = 'click inside the dish to place spores · '
                              + pts + '/' + api.MAX_SPORES;
      el('species').textContent = '';
    } else {
      var LABEL = { growing: 'growing', mature: 'maturing',
                    paused: 'paused', done: 'done' };
      var count = {};
      api.getColonies().forEach(function (c) {
        count[c.archetype] = (count[c.archetype] || 0) + 1;
      });
      var kinds = Object.keys(count);
      // Полные латинские имена, а не эпитеты: иначе непонятно, что это виды,
      // а не просто набор слов.
      var list = kinds.map(function (k) {
        return PM.growth.latin(k) + (count[k] > 1 ? ' ×' + count[k] : '');
      }).join('   ·   ');

      el('phase').textContent = kinds.length + (kinds.length === 1 ? ' species ' : ' species ')
                              + (LABEL[st] || st) + ' · t' + api.getTick();
      el('species').textContent = list;
    }

    var s = el('start');
    s.disabled = !(st === 'inoculate' && pts > 0);
    s.textContent = st === 'inoculate' ? 'GROW'
                  : (st === 'done' ? 'DONE' : 'GROWING…');

    var p = el('pause');
    p.disabled = !(st === 'growing' || st === 'mature' || st === 'paused');
    p.textContent = st === 'paused' ? 'RESUME' : 'PAUSE';

    var e = el('exp-val');
    if (e) e.textContent = api.exportSize();

    document.body.classList.toggle('running', st !== 'inoculate');
    if (st !== 'inoculate') PM.cursor.show(false);
  }

  // ---------- инициализация ----------

  function init(a) {
    api = a;

    buildBrushes();
    // пинцет виден только пока расставляют споры
    PM.cursor.attach(el('stage'), function () {
      return api.getState() === 'inoculate';
    });

    var pal = el('pal');
    var PLAB = { grey8: '8 neutral', tint6: '6 tinted', grey5: '5 coarse' };
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

    var dith = el('dither');
    dith.checked = PM.render.getDither();
    dith.addEventListener('change', function () {
      PM.render.setDither(dith.checked);
      api.redraw();
    });
    bindRange('amp', PM.render.getAmp, PM.render.setAmp);
    bindRange('speed', api.getSpeed, api.setSpeed, function () {});

    var G = PM.dish.GEO;
    [['agar-c', 'agarCenter'], ['agar-f', 'agarFalloff'],
     ['noise', 'agarNoiseAmp'], ['nscale', 'agarNoiseScale'],
     ['grid', 'gridBoost'], ['rim-b', 'rimBase'], ['rim-s', 'rimSwing'],
     ['rim-k', 'rimBreaks'], ['glare', 'glareCount']
    ].forEach(function (p) {
      bindRange(p[0],
        function () { return G[p[1]]; },
        function (v) { G[p[1]] = v; },
        api.redrawBackground);
    });

    el('start').addEventListener('click', api.start);
    el('pause').addEventListener('click', api.togglePause);
    el('reseed').addEventListener('click', function () { api.reseed(); });
    el('save').addEventListener('click', api.exportPNG);

    bindRange('exp', api.getExportScale, function (v) {
      api.setExportScale(v);
      el('exp-val').textContent = api.exportSize();
    }, function () {});

    // панель как выдвижной ящик
    var panel = el('panel'), backdrop = el('backdrop');
    function setPanel(open) {
      panel.classList.toggle('open', open);
      backdrop.classList.toggle('on', open);
    }
    el('menu').addEventListener('click', function () {
      setPanel(!panel.classList.contains('open'));
    });
    backdrop.addEventListener('click', function () { setPanel(false); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setPanel(false);
      var t = e.target.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (api.getState() === 'inoculate') api.start(); else api.togglePause();
      }
      if (e.key === 'p' || e.key === 'P') api.togglePause();
      if (e.key === 'r' || e.key === 'R') api.reseed();
      if (e.key === 'd' || e.key === 'D') setPanel(!panel.classList.contains('open'));
      if (e.key === 's' || e.key === 'S') api.exportPNG();
    });
  }

  return {
    init: init,
    sync: function () { if (api) sync(); },
    brush: function () { return brush || null; }
  };
})();
