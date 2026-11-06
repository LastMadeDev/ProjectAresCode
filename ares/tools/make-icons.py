"""Render the Project Ares app icons from the helm mark in ares/assets/source/ares-mark.svg.

The mark is redrawn here with Pillow (no SVG renderer needed) at 4x supersampling, then
written to ares/assets/icons/. ares/rebrand.mjs copies those files over every upstream icon
path. Run it only when the artwork changes:

    python -P ares/tools/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "icons"

OBSIDIAN = (11, 13, 18, 255)
CRIMSON = (217, 75, 70, 255)
EMBER = (241, 106, 99, 255)

# ares-mark.svg viewBox is "120 60 272 372"; geometry below is in those units.
VIEW_X, VIEW_Y, VIEW_W, VIEW_H = 120, 60, 272, 372


def cubic(p0, p1, p2, p3, steps=48):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        pts.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return pts


def helmet_outline():
    # M150 244 C150 176 196 128 256 124 C316 128 362 176 362 244 L356 330 L286 412 L226 412 L156 330 Z
    pts = cubic((150, 244), (150, 176), (196, 128), (256, 124))
    pts += cubic((256, 124), (316, 128), (362, 176), (362, 244))[1:]
    pts += [(356, 330), (286, 412), (226, 412), (156, 330)]
    return pts


FACE_CUT = [
    (168, 226), (244, 250), (268, 250), (344, 226), (344, 262),
    (284, 318), (284, 420), (228, 420), (228, 318), (168, 262),
]
CREST = [(230, 94), (256, 74), (282, 94), (268, 248), (244, 248)]
SLITS = [((224, 96), (240, 252)), ((288, 96), (272, 252))]
CHEVRON = [(214, 260), (236, 274), (214, 288)]
DASH = [(262, 274), (300, 274)]


def draw_mark(size, mark_height_ratio, background):
    """Draw the helm centred on a size x size canvas, transparent outside the mark."""
    scale = size * mark_height_ratio / VIEW_H
    off_x = (size - VIEW_W * scale) / 2 - VIEW_X * scale
    off_y = (size - VIEW_H * scale) / 2 - VIEW_Y * scale

    def tx(points):
        return [(x * scale + off_x, y * scale + off_y) for x, y in points]

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.polygon(tx(helmet_outline()), fill=CRIMSON)
    cut = background[:3] + (0,)
    # Cuts are punched out to transparent, so the tile shows through as in the SVG mask.
    d.polygon(tx(FACE_CUT), fill=cut)
    for a, b in SLITS:
        d.line(tx([a, b]), fill=cut, width=max(1, round(12 * scale)))
    d.polygon(tx(CREST), fill=CRIMSON)
    stroke = max(1, round(12 * scale))
    d.line(tx(CHEVRON), fill=EMBER, width=stroke, joint="curve")
    d.line(tx(DASH), fill=EMBER, width=stroke)
    return layer


def tile(size, rounded):
    """Obsidian tile with a faint crimson glow behind the helm."""
    base = Image.new("RGBA", (size, size), OBSIDIAN)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    r = size * 0.34
    c = size / 2
    g.ellipse((c - r, c - r * 0.9, c + r, c + r * 1.1), fill=(217, 75, 70, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.12))
    base = Image.alpha_composite(base, glow)
    if rounded:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, size - 1, size - 1), radius=round(size * 0.225), fill=255
        )
        clear = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        base = Image.composite(base, clear, mask)
    return base


def render(final_size, *, rounded, inset, mark_height_ratio):
    ss = 4
    size = final_size * ss
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = round(size * (1 - 2 * inset))
    tile_img = tile(inner, rounded)
    mark = draw_mark(inner, mark_height_ratio, OBSIDIAN)
    tile_img = Image.alpha_composite(tile_img, mark)
    offset = (size - inner) // 2
    canvas.paste(tile_img, (offset, offset), tile_img)
    return canvas.resize((final_size, final_size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # Full-bleed square: iOS and Icon Composer style targets apply their own mask.
    full = render(1024, rounded=False, inset=0.0, mark_height_ratio=0.62)
    full.convert("RGB").save(OUT / "icon-full-1024.png", optimize=True)
    # Rounded tile with the usual ~10% margin for macOS, Linux and Windows.
    rounded = render(1024, rounded=True, inset=0.09, mark_height_ratio=0.64)
    rounded.save(OUT / "icon-rounded-1024.png", optimize=True)
    # Small sizes get a larger mark and less margin so the helm stays legible.
    small = {s: render(s, rounded=True, inset=0.0, mark_height_ratio=0.74) for s in (16, 32, 48, 64, 128)}
    small[16].save(OUT / "favicon-16.png", optimize=True)
    small[32].save(OUT / "favicon-32.png", optimize=True)
    render(180, rounded=False, inset=0.0, mark_height_ratio=0.64).convert("RGB").save(
        OUT / "apple-touch-180.png", optimize=True
    )
    big = render(256, rounded=True, inset=0.06, mark_height_ratio=0.66)
    big.save(
        OUT / "app.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        append_images=[small[16], small[32], small[48], small[64], small[128]],
    )
    small[32].save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32)], append_images=[small[16]])
    print("wrote", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
