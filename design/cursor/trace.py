"""Curseur de Claude (planche 33) : reproduction un pour un de main-d-pastille.png (autocollant).

1. couleurs ramenées à la palette (trait sombre, argile, blanc de l'autocollant) ; le fond devient transparent ;
2. recadrage serré sur la main ;
3. vectorisation (vtracer) -> hand.svg, et un PNG net -> hand-512.png.
"""
import pathlib

import numpy as np
import vtracer
from PIL import Image

HERE = pathlib.Path(__file__).parent
img = np.asarray(Image.open(HERE / 'main-d-pastille.png').convert('RGB').resize((1024, 1024), Image.LANCZOS)).astype(int)
h, w, _ = img.shape
lum = img.sum(axis=2)

# Fond : médiane des coins. Blanc de l'autocollant : plus clair que le fond.
corners = np.concatenate([img[:40, :40].reshape(-1, 3), img[:40, -40:].reshape(-1, 3), img[-40:, :40].reshape(-1, 3), img[-40:, -40:].reshape(-1, 3)])
bg = np.median(corners, axis=0)
c = img.reshape(-1, 3)
cl = c.sum(axis=1)
dark = np.median(c[cl < 200], axis=0)
clay = np.median(c[(c[:, 0] > 170) & (c[:, 1] < 150) & (c[:, 2] < 130)], axis=0)
white = np.array([255, 255, 255])
print('fond', bg.round(), 'trait', dark.round(), 'argile', clay.round())

palette = np.stack([dark, clay, white, bg])
d = ((img[:, :, None, :] - palette[None, None, :, :]) ** 2).sum(axis=3)
idx = d.argmin(axis=2)
# Le blanc et le fond sont proches : un pixel n'est « blanc » que s'il est nettement plus clair que le fond.
idx = np.where((idx == 2) & (lum < bg.sum() + 9), 3, idx)

ys, xs = np.where(idx != 3)
top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
pad = 6
top, left = max(0, top - pad), max(0, left - pad)
bottom, right = min(h, bottom + pad), min(w, right + pad)
idx = idx[top:bottom, left:right]
cols = np.stack([dark, clay, white, bg]).astype(np.uint8)
out = np.zeros(idx.shape + (4,), dtype=np.uint8)
out[..., :3] = cols[idx]
out[..., 3] = np.where(idx == 3, 0, 255)
im = Image.fromarray(out, 'RGBA')
side = max(im.size)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2))
sq.resize((512, 512), Image.LANCZOS).save(HERE / 'hand-512.png')
tmp = HERE / '_clean.png'
sq.save(tmp)
vtracer.convert_image_to_svg_py(
    str(tmp), str(HERE / 'hand.svg'),
    colormode='color', hierarchical='stacked', mode='spline',
    filter_speckle=8, color_precision=6, layer_difference=48,
    corner_threshold=60, length_threshold=4.0, splice_threshold=45, path_precision=3,
)
tmp.unlink()
print('recadré', right - left, 'x', bottom - top, '-> carré', side)
