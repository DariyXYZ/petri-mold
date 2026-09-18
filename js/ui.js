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

    // Свой холст на плитке: наведение — серое кольцо, выбор — белое. Оба
    // состояния печёт preview, здесь только подмена картинки.
    var cv = document.createElement('canvas');
    b.appendChild(cv);
    var hover = false;
    b._paint = function () {
      var lit = b.classList.contains('on') ? 2 : (hover ? 1 : 0);
      var src = name ? PM.preview.build(name, lit) : PM.preview.random(lit);
      if (cv.width !== src.width) { cv.width = src.width; cv.height = src.height; }
      // фон превью прозрачный — без очистки прежнее кольцо просвечивало бы
      // из-под нового, и подсветка «залипала»
      var g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(src, 0, 0);
    };
    b.addEventListener('pointerenter', function () { hover = true; b._paint(); });
    b.addEventListener('pointerleave', function () { hover = false; b._paint(); });
    // превью печёт загрузчик по одному (см. main.init), здесь холст пустой

    var cap = document.createElement('span');
    cap.className = 'cap';
    // в подписи видовой эпитет: род длинный и часто повторяется
    cap.textContent = name ? latin.split(' ')[1] : 'random';
    b.appendChild(cap);

    b.addEventListener('click', function () {
      PM.sound.ui('select');
      select(name);
      b.blur();          // иначе пробел «нажимает» плитку, а не запускает рост
    });
    return b;
  }

  function select(name) {
    brush = name;
    var tiles = document.querySelectorAll('#strains .tile');
    for (var i = 0; i < tiles.length; i++) {
      var on = tiles[i].dataset.strain === name;
      var was = tiles[i].classList.contains('on');
      tiles[i].classList.toggle('on', on);
      tiles[i].setAttribute('aria-pressed', String(on));
      if (on !== was && tiles[i]._paint) tiles[i]._paint();
    }
    el('strain-info').innerHTML = name
      ? '<b>' + PM.growth.latin(name) + '</b><br>' + PM.growth.desc(name)
      : '<em>Random — every spore gets a different species.</em>';
  }

  // ---------- статус ----------

  // Тики в часы: номинально 60 тиков в секунду. До минуты — секунды с
  // десятыми, дальше мм:сс.
  function clock(tick) {
    var sec = tick / 60;
    if (sec < 60) return sec.toFixed(1) + ' s';
    var m = Math.floor(sec / 60), r = Math.floor(sec - m * 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

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
      // Короткая латынь: «P. chrysogenum». Внутри имени и перед счётчиком —
      // неразрывные пробелы, чтобы строка ломалась только на разделителях.
      var NB = ' ';
      var list = kinds.map(function (k) {
        var full = PM.growth.latin(k).split(' ');
        var name = full.length > 1 ? full[0].charAt(0) + '.' + NB + full.slice(1).join(NB) : full[0];
        return name + (count[k] > 1 ? NB + '×' + count[k] : '');
      }).join(' · ');

      // пустую чашку тоже можно выжечь — «0 species» тут ни к чему
      el('phase').textContent = (kinds.length ? kinds.length + ' species ' : '')
                              + (LABEL[st] || st) + ' · time ' + clock(api.getTick());
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

  // Уголки выделения: четыре пустых спана с рамкой в каждой кнопке. Рамка,
  // а не маска или картинка: рамку браузер сажает на пиксель экрана, а у
  // маски концы плеч попадали на дробные пиксели и рисовались хвостиками.
  function corners() {
    var b = document.querySelectorAll('button');
    for (var i = 0; i < b.length; i++) {
      for (var c = 0; c < 4; c++) {
        var sp = document.createElement('i');
        sp.className = 'corner c' + c;
        sp.setAttribute('aria-hidden', 'true');
        b[i].appendChild(sp);
      }
    }
  }

  function init(a) {
    api = a;

    buildBrushes();
    corners();
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
      snd.classList.toggle('off', !on);
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
    PM.skin.init();

    // кнопки не держат фокус: клавиши всегда идут к странице
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (b) b.blur();
    });

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
    tiles: function () { return document.querySelectorAll('#strains .tile'); },
    sync: function () { if (api) sync(); },
    brush: function () { return brush || null; }
  };
})();
