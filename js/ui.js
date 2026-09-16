var PM = PM || {};

PM.ui = (function () {
  var api;
  var brush = '';          // '' = random strain

  function el(id) { return document.getElementById(id); }

  // ---------- палитра штаммов ----------

  function buildBrushes() {
    var box = el('brushes');
    var names = PM.growth.names();

    // случайный штамм — первой кнопкой
    box.appendChild(makeTile('', 'Random', 'each spore a different species'));

    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      box.appendChild(makeTile(n, PM.growth.latin(n), PM.growth.desc(n)));
    }
    select('');
  }

  function makeTile(name, latin, desc) {
    var b = document.createElement('button');
    b.className = name ? 'tile' : 'tile tile-random';
    b.dataset.strain = name;
    b.title = latin + ' — ' + desc;

    b.appendChild(name ? PM.preview.build(name) : PM.preview.random());

    var cap = document.createElement('span');
    cap.className = 'cap';
    // в подписи видовой эпитет: род длинный и часто повторяется
    cap.textContent = name ? latin.split(' ')[1] : 'random';
    b.appendChild(cap);

    b.addEventListener('click', function () {
      PM.sound.ui('select');
      select(name);
    });
    return b;
  }

  function select(name) {
    brush = name;
    var tiles = document.querySelectorAll('#strains .tile');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].classList.toggle('on', tiles[i].dataset.strain === name);
      tiles[i].setAttribute('aria-pressed', String(tiles[i].dataset.strain === name));
    }
    el('strain-info').innerHTML = name
      ? '<b>' + PM.growth.latin(name) + '</b><br>' + PM.growth.desc(name)
      : '<em>Random — every spore gets a different species.</em>';
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
                    paused: 'paused', burning: 'burning off', done: 'done' };
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

      // пустую чашку тоже можно выжечь — «0 species» тут ни к чему
      el('phase').textContent = (kinds.length ? kinds.length + ' species ' : '')
                              + (LABEL[st] || st) + ' · t' + api.getTick();
      el('species').textContent = list;
    }

    var s = el('start');
    s.disabled = !(st === 'inoculate' && pts > 0);
    s.textContent = st === 'inoculate' ? 'GROW'
                  : (st === 'done' ? 'DONE'
                  : (st === 'burning' ? 'BURNING…' : 'GROWING…'));

    var p = el('pause');
    p.disabled = !(st === 'growing' || st === 'mature' || st === 'paused');
    p.textContent = st === 'paused' ? 'RESUME' : 'PAUSE';

    // пока горит, повторное нажатие ничего не даёт — кнопка гаснет
    var b = el('reseed');
    if (b) b.disabled = (st === 'burning');

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
    }, function () {
      // экранных точек на пиксель буфера — пинцет печётся под тот же шаг
      return el('stage').getBoundingClientRect().width / api.bufferW;
    });

    var snd = el('sound-toggle');
    function syncSound() {
      var on = PM.sound.isEnabled();
      snd.textContent = on ? 'SOUND ON' : 'SOUND OFF';
      snd.setAttribute('aria-pressed', String(on));
      snd.title = on ? 'Turn sound off' : 'Turn sound on';
    }
    snd.addEventListener('click', function () {
      PM.sound.setEnabled(!PM.sound.isEnabled());
      syncSound();
      if (PM.sound.isEnabled()) PM.sound.ui('press');
    });
    syncSound();

    el('start').addEventListener('click', function () {
      PM.sound.ui('start');
      api.start();
    });
    el('pause').addEventListener('click', function () {
      PM.sound.ui('press');
      api.togglePause();
    });
    el('reseed').addEventListener('click', function () {
      api.burnClean();
    });
    el('save').addEventListener('click', api.exportPNG);

    document.addEventListener('keydown', function (e) {
      var t = e.target.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (api.getState() === 'inoculate') api.start(); else api.togglePause();
      }
      if (e.code === 'KeyP') api.togglePause();
      if (e.code === 'KeyR') api.burnClean();
      if (e.code === 'KeyS') api.exportPNG();
    });
  }

  return {
    init: init,
    sync: function () { if (api) sync(); },
    brush: function () { return brush || null; }
  };
})();
