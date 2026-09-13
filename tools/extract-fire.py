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
