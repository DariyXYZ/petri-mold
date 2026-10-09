# Фото чашки -> буфер игры 380x389.
#   python tools/pixelize-dish.py petri.jpg assets/dish-photo.js  -> ассет
#   python tools/pixelize-dish.py petri.jpg out                   -> out-380.png, out-x3.png
import sys, numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
# внутренняя стенка на фото, доли внешнего радиуса (радиальный профиль)
R_AGAR = 0.85
a = np.asarray(Image.open(src).convert('L')).astype(np.float64)
h, w = a.shape
# контур: крайние точки по строкам и столбцам -> МНК-окружность
pts = []
for y in range(0, h, 4):
    r = np.nonzero(a[y] > 30)[0]
    if len(r): pts += [(r[0], y), (r[-1], y)]
for x in range(0, w, 4):
    r = np.nonzero(a[:, x] > 30)[0]
    if len(r): pts += [(x, r[0]), (x, r[-1])]
P = np.array(pts, float)
A = np.c_[2*P[:,0], 2*P[:,1], np.ones(len(P))]
b = (P**2).sum(1)
cx, cy, c = np.linalg.lstsq(A, b, rcond=None)[0]
R = np.sqrt(c + cx*cx + cy*cy)
print('circle', cx, cy, R)
# буфер игры
W, H = 380, 389
Rt = 0.436 * W
gx, gy = 0.5 * W, 0.5 * H
s = R / Rt  # px исходника на px буфера
# усреднение: уменьшаем всю картинку до масштаба, потом вклеиваем
sw, sh = round(w / s), round(h / s)
small = np.asarray(Image.fromarray(a.astype(np.uint8)).resize((sw, sh), Image.LANCZOS)).astype(np.float64)
lum = np.zeros((H, W))
ox, oy = round(gx - cx / s), round(gy - cy / s)
for y in range(sh):
    ty = y + oy
    if 0 <= ty < H:
        x0, x1 = max(0, ox), min(W, ox + sw)
        lum[ty, x0:x1] = small[y, x0 - ox:x1 - ox]
yy, xx = np.mgrid[0:H, 0:W]
d = np.hypot(xx + 0.5 - gx, yy + 0.5 - gy) / Rt
lum[d > 1.0] = 0
# ассет для игры: яркости буфера до дизера, дизер и палитру даёт render.js
if out.endswith('.js'):
    import base64
    raw = np.clip(np.round(lum), 0, 255).astype(np.uint8).tobytes()
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('var PM = PM || {};\n')
        f.write('// Фото чашки (tools/pixelize-dish.py): яркости буфера %dx%d до дизера,\n' % (W, H))
        f.write('// сырые байты в base64. Читается синхронно: PNG с диска пятнает холст.\n')
        f.write('PM.dishPhoto = { w: %d, h: %d, rAgar: %s, data: "%s" };\n'
                % (W, H, R_AGAR, base64.b64encode(raw).decode()))
    sys.exit()
# render.js: Bayer4 + хеш-шум, amp 33, grey8, l<=1 -> чёрный без дизера
B = np.array([0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5], float).reshape(4, 4)
def imul(a, b): return (a.astype(np.uint64) * b) & 0xFFFFFFFF
X = (xx + 1).astype(np.uint64); Y = (yy + 1).astype(np.uint64)
hh = imul(X, 374761393) ^ imul(Y, 668265263)
hh = imul(hh ^ (hh >> 13), 1274126177) / 4294967296.0
l = lum + ((B[yy & 3, xx & 3] / 16 - 0.46875) * 0.72 + (hh - 0.5) * 0.55) * 33
ramp = np.array([0, 26, 51, 77, 102, 140, 179, 230], float)
q = np.clip(np.floor(l), -64, 447)
idx = np.abs(q[..., None] - ramp).argmin(-1)
o = ramp[idx]
o[lum <= 1] = 0
img = Image.fromarray(o.astype(np.uint8))
img.save(out + '-380.png')
img.resize((W * 3, H * 3), Image.NEAREST).save(out + '-x3.png')
