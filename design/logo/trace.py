"""Canopy : reproduction un pour un de l'image retenue (r2-lumiere3-b-trois-arbres.png).

1. recadre exactement sur le carré sombre (sans le cadre clair ajouté par le modèle) ;
2. ramène chaque pixel à la plus proche des couleurs de la marque (ardoise, argile) et rend transparent l'extérieur du carré ;
3. vectorise par traçage (vtracer) -> canopy.svg ; garde aussi le PNG net -> canopy-1024.png.
"""
import pathlib

import numpy as np
import vtracer
from PIL import Image

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / 'logo-fal' / 'r2-lumiere3-b-trois-arbres.png'

img = np.asarray(Image.open(SRC).convert('RGB')).astype(int)
h, w, _ = img.shape
lum = img.sum(axis=2)

# Carré sombre : lignes / colonnes dont une bonne part des pixels est sombre.
dark = lum < 200
rows = np.where(dark.mean(axis=1) > 0.3)[0]
cols = np.where(dark.mean(axis=0) > 0.3)[0]
top, bottom, left, right = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
side = max(bottom - top, right - left)
crop = img[top:top + side, left:left + side]
print(f'image {w}x{h}, carré sombre {left},{top} -> {side}px')

# Couleurs de la marque, mesurées dans l'image (médianes), pour rester fidèle.
c = crop.reshape(-1, 3)
cl = c.sum(axis=1)
slate = np.median(c[cl < 200], axis=0)
clay = np.median(c[(c[:, 0] > 150) & (c[:, 2] < 140)], axis=0)
light = np.median(c[cl > 600], axis=0) if (cl > 600).any() else np.array([240, 238, 230])
print('ardoise', slate.round(), 'argile', clay.round(), 'cadre', light.round())

palette = np.stack([slate, clay, light])
d = ((crop[:, :, None, :] - palette[None, None, :, :]) ** 2).sum(axis=3)
idx = d.argmin(axis=2)
out = np.zeros((side, side, 4), dtype=np.uint8)
out[..., :3] = np.where(idx[..., None] == 1, clay, slate).astype(np.uint8)
out[..., 3] = np.where(idx == 2, 0, 255)  # le clair hors du carré devient transparent
Image.fromarray(out, 'RGBA').resize((1024, 1024), Image.LANCZOS).save(HERE / 'canopy-1024.png')

# Traçage vectoriel sur une version propre à deux couleurs (+ transparence).
tmp = HERE / '_clean.png'
Image.fromarray(out, 'RGBA').save(tmp)
vtracer.convert_image_to_svg_py(
    str(tmp), str(HERE / 'canopy.svg'),
    colormode='color', hierarchical='stacked', mode='spline',
    filter_speckle=8, color_precision=6, layer_difference=48,
    corner_threshold=60, length_threshold=4.0, splice_threshold=45, path_precision=3,
)
tmp.unlink()
print('ok : canopy.svg, canopy-1024.png')
