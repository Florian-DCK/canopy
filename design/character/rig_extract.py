"""Découpe les vues de face (r2-*-face.png) en pièces vectorielles pour le personnage articulé.

Pour chaque pièce : masque (couleur + composante connexe), trous bouchés, tracé vtracer → chemin SVG en coordonnées
1024×1024. Les yeux, joues et bouche ne sont pas tracés : ils sont redessinés dans le composant (formes qui s'animent),
on ne relève ici que leur position et leur taille. Sortie : rig-parts.json."""
import json
import pathlib
import re

import numpy as np
import vtracer
from PIL import Image
from scipy import ndimage

HERE = pathlib.Path(__file__).parent
TMP = HERE / "_mask.png"
OUT_SVG = HERE / "_mask.svg"


def load(name):
    return np.asarray(Image.open(HERE / f"{name}.png").convert("RGB").resize((1024, 1024), Image.LANCZOS)).astype(int)


def comps(mask, min_px=500):
    lab, k = ndimage.label(mask)
    sizes = ndimage.sum(mask, lab, range(1, k + 1))
    out = [(int(s), lab == i + 1) for i, s in enumerate(sizes) if s >= min_px]
    return [m for _, m in sorted(out, key=lambda t: -t[0])]


def trace(mask):
    """Masque → un seul chemin SVG (contour extérieur et trous)."""
    m = ndimage.binary_fill_holes(mask)
    img = np.where(m[..., None], 0, 255).astype(np.uint8).repeat(3, axis=2)
    Image.fromarray(img).save(TMP)
    vtracer.convert_image_to_svg_py(str(TMP.resolve()), str(OUT_SVG.resolve()))
    svg = OUT_SVG.read_text(encoding="utf-8")
    paths = []
    for p in re.findall(r"<path [^>]*/>", svg):
        fill = re.search(r'fill="(#[0-9A-Fa-f]+)"', p).group(1).upper()
        if fill not in ("#000000", "#010101", "#020202"):
            continue
        d = re.search(r' d="([^"]+)"', p).group(1)
        t = re.search(r'translate\(([-\d.]+),([-\d.]+)\)', p)
        paths.append({"d": d, "tx": float(t.group(1)) if t else 0, "ty": float(t.group(2)) if t else 0})
    return paths


def bbox(mask):
    ys, xs = np.where(mask)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def median(a, mask):
    return "#%02X%02X%02X" % tuple(int(v) for v in np.median(a[mask], axis=0))


parts = {}

# ---------- esprit de la forêt ----------
a = load("r2-esprit-face")
r, g, b = a[..., 0], a[..., 1], a[..., 2]
clay = (r > 150) & (r - b > 60) & (g < 150)
canopy, body = comps(clay)[:2]
if bbox(canopy)[1] > bbox(body)[1]:
    canopy, body = body, canopy
# Yeux : petites taches sombres dans le corps (trous du masque argile).
holes = ndimage.binary_fill_holes(body) & ~body
eyes = [bbox(m) for m in comps(holes, 30)[:2]]
parts["esprit"] = {
    "color": median(a, clay),
    "canopy": {"paths": trace(canopy), "bbox": bbox(canopy)},
    "body": {"paths": trace(body), "bbox": bbox(body)},
    "eyes": sorted(eyes),
}

# ---------- gland ----------
a = load("r2-gland-face")
r, g, b = a[..., 0], a[..., 1], a[..., 2]
lum = a.sum(2)
clay = (r > 150) & (r - b > 60) & (g < 150)
cl = comps(clay)
body = cl[0]
limbs = sorted(cl[1:5], key=lambda m: (bbox(m)[1], bbox(m)[0]))  # bras (plus hauts) puis jambes
arms, legs = sorted(limbs[:2], key=lambda m: bbox(m)[0]), sorted(limbs[2:4], key=lambda m: bbox(m)[0])
cap_mask = comps((lum > 100) & (lum < 270) & (abs(r - b) < 35))[0]
cap_dark = ndimage.binary_fill_holes(cap_mask) & ~cap_mask  # les écailles (traits plus sombres)
white = (lum > 600)
eye_whites = sorted([bbox(m) for m in comps(white & ndimage.binary_dilation(ndimage.binary_fill_holes(body), iterations=3), 100)[:2]])
pink = (r > 200) & (g > 160) & (b > 140) & (lum < 620)
cheeks = sorted([bbox(m) for m in comps(pink, 80)[:2]])
parts["gland"] = {
    "color": median(a, clay),
    "capColor": median(a, cap_mask),
    "body": {"paths": trace(body), "bbox": bbox(body)},
    "cap": {"paths": trace(cap_mask), "bbox": bbox(cap_mask)},
    "scales": {"paths": trace(cap_dark) if cap_dark.sum() > 200 else []},
    "armL": {"paths": trace(arms[0]), "bbox": bbox(arms[0])},
    "armR": {"paths": trace(arms[1]), "bbox": bbox(arms[1])},
    "legL": {"paths": trace(legs[0]), "bbox": bbox(legs[0])},
    "legR": {"paths": trace(legs[1]), "bbox": bbox(legs[1])},
    "eyes": eye_whites,
    "cheeks": cheeks,
}
for f in (TMP, OUT_SVG):
    f.unlink(missing_ok=True)
(HERE / "rig-parts.json").write_text(json.dumps(parts), encoding="utf-8")
for k, v in parts.items():
    print(k, {p: (len(x["paths"]) if isinstance(x, dict) and "paths" in x else x) for p, x in v.items()})
