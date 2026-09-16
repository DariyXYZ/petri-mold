"""Preserve the source GIF's composited frames for deterministic canvas playback."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'assets/kostyor-19.gif')
atlas = Image.new('RGB', (source.width * source.n_frames, source.height))
for frame in range(source.n_frames):
    source.seek(frame)
    assert source.info.get('duration') == 40
    atlas.paste(source.convert('RGB'), (frame * source.width, 0))
atlas.save(root / 'assets/fire-frames.png', optimize=True)

# Тот же атлас как data-URI в JS: с диска (file://) картинка через <img src>
# пятнает холст и getImageData бросает SecurityError. См. js/burn.js.
import base64
png = (root / 'assets/fire-frames.png').read_bytes()
header = (
    "var PM = PM || {};\n"
    "// Атлас кадров пламени (assets/fire-frames.png) как data-URI. Через <img src>\n"
    "// с диска (file://) холст становится «tainted» и getImageData бросает\n"
    "// SecurityError — выжигание зависало навсегда. data-URI не пятнает холст и\n"
    "// работает одинаково с диска и с сервера. Файл генерируется\n"
    "// tools/extract-fire.py, руками не править.\n"
)
(root / 'assets/fire-frames.js').write_text(
    header + "PM.burnAtlas = 'data:image/png;base64," + base64.b64encode(png).decode('ascii') + "';\n",
    encoding='utf-8', newline='\n')
