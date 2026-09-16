"""Исходник пинцета для курсора: кроп фотографий по альфе, серый + альфа,
400 px по ширине, и всё это data-URI в assets/tweezers.js.

Пикселизация делается в рантайме (js/cursor.js) под текущий масштаб чашки,
поэтому здесь только подготовка источника, без квантования.
"""
import base64
from io import BytesIO
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
src = Path.home() / 'Downloads'
FILES = {'open': 'открытый.png', 'shut': 'закрытй.png'}
WIDTH = 400

parts = []
for key, name in FILES.items():
    im = Image.open(src / name).convert('RGBA')
    # рамка по плотной альфе: полупрозрачная бахрома сглаживания раздувает кроп
    mask = im.getchannel('A').point(lambda a: 255 if a > 160 else 0)
    box = mask.getbbox()
    im = im.crop(box)
    h = round(im.height * WIDTH / im.width)
    im = im.resize((WIDTH, h), Image.LANCZOS)
    la = Image.merge('LA', (im.convert('L'), im.getchannel('A')))
    buf = BytesIO()
    la.save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    parts.append("  %s: 'data:image/png;base64,%s'" % (key, b64))
    print(key, box, la.size, len(buf.getvalue()), 'bytes')

out = (
    "var PM = PM || {};\n"
    "// Фотографии пинцета (серый + альфа, 400 px) как data-URI: с диска (file://)\n"
    "// <img> пятнает холст и getImageData бросает. Пикселизует js/cursor.js под\n"
    "// масштаб чашки. Генерирует tools/tweezers-src.py, руками не править.\n"
    "PM.tweezersSrc = {\n" + ",\n".join(parts) + "\n};\n"
)
(root / 'assets/tweezers.js').write_text(out, encoding='utf-8', newline='\n')
print('assets/tweezers.js', len(out))
