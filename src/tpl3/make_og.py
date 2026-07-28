"""
Generate the social-preview card (og:image) from the built dataset.

No basemap is drawn. The sites are ports, so plotting all 1,001 coordinates on an
equirectangular projection traces the world's coastlines on its own — the data is
the illustration. Dots are coloured by vendor bucket and sized by throughput, so
the card carries the same encoding as the app.

Output: 1200x630 PNG (the size LinkedIn / Slack / X / Facebook all crop to).
"""
from __future__ import annotations
import json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (15, 22, 32)
INK = (245, 248, 251)
MUTED = (138, 152, 167)
AMBER = (255, 176, 26)

# Map frame. Cropped to where terminals actually are — the far south is empty
# ocean and spending a third of the card on it just shrinks everything else.
LON0, LON1 = -168.0, 178.0
LAT0, LAT1 = -46.0, 69.0
MAP_TOP, MAP_H = 126, 336
STRIP_Y = 500          # stat values baseline
CAPTION_Y = 592


def _font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()

BOLD = lambda s: _font(["seguisb.ttf", "segoeuib.ttf", "arialbd.ttf"], s)
REG  = lambda s: _font(["segoeui.ttf", "arial.ttf"], s)
MONO = lambda s: _font(["consola.ttf"], s)


def build(data_path: Path, out_path: Path, colors: dict) -> Path:
    sites = json.loads(data_path.read_text(encoding="utf-8"))

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # Faint graticule so the projection reads as a map rather than a scatter.
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for lon in range(-180, 181, 30):
        if LON0 <= lon <= LON1:
            x = (lon - LON0) / (LON1 - LON0) * W
            gd.line([(x, MAP_TOP), (x, MAP_TOP + MAP_H)], fill=(255, 255, 255, 12), width=1)
    for lat in range(-60, 91, 30):
        if LAT0 <= lat <= LAT1:
            y = MAP_TOP + (LAT1 - lat) / (LAT1 - LAT0) * MAP_H
            gd.line([(0, y), (W, y)], fill=(255, 255, 255, 12), width=1)
    img = Image.alpha_composite(img.convert("RGBA"), grid)

    # Sites. Drawn largest-first so big terminals never hide small neighbours.
    dots = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    for t in sorted(sites, key=lambda s: -s.get("volume", 0)):
        lat, lon = t["lat"], t["lon"]
        if not (LAT0 <= lat <= LAT1 and LON0 <= lon <= LON1):
            continue
        x = (lon - LON0) / (LON1 - LON0) * W
        y = MAP_TOP + (LAT1 - lat) / (LAT1 - LAT0) * MAP_H
        r = 1.6 + min(math.sqrt(max(t.get("volume", 0), 1)) / 26.0, 5.0)
        v = t.get("vendor")
        if v in ("TBD (researched)", "Defunct"):
            col, alpha = (150, 162, 175), 110
        else:
            hexc = colors.get(v, "#0b5fff").lstrip("#")
            col = tuple(int(hexc[i:i+2], 16) for i in (0, 2, 4))
            alpha = 235
        dd.ellipse([x-r, y-r, x+r, y+r], fill=col + (alpha,))
    img = Image.alpha_composite(img, dots).convert("RGB")
    d = ImageDraw.Draw(img)

    # Top-left lockup
    d.rectangle([0, 0, W, 5], fill=AMBER)
    d.text((54, 44), "Terminal Intelligence", font=BOLD(46), fill=INK)
    d.text((56, 96), "ANONYMIZED MARKET MAP", font=BOLD(15), fill=AMBER)

    # Bottom stat strip
    named = [t for t in sites if t.get("vendor") not in ("TBD (researched)", "Defunct")]
    white = [t for t in sites if t.get("vendor") == "TBD (researched)"]
    vol = sum(t.get("volume", 0) for t in sites)
    acv = sum(t.get("acv_kusd") or 0 for t in named)
    stats = [
        (f"{len(sites):,}", "terminals"),
        ("66", "fields each"),
        (f"{vol/1000:.0f}M", "moves / yr"),
        (f"${acv/1000:.0f}M", "licence base"),
        (f"{len(white):,}", "whitespace sites"),
    ]
    f_val, f_lab, f_cap = BOLD(36), BOLD(12), REG(16)
    d.line([(54, STRIP_Y - 22), (W - 54, STRIP_Y - 22)], fill=(38, 50, 64), width=1)
    x = 54
    for value, label in stats:
        d.text((x, STRIP_Y), value, font=f_val, fill=INK)
        d.text((x + 2, STRIP_Y + 44), label.upper(), font=f_lab, fill=MUTED)
        x += max(d.textlength(value, font=f_val),
                 d.textlength(label.upper(), font=f_lab)) + 58

    d.text((54, CAPTION_Y), "Coordinates are real  ·  identities removed  ·  attributes are modelled, not observed",
           font=f_cap, fill=(104, 118, 133))

    img.save(out_path, "PNG", optimize=True)
    return out_path


if __name__ == "__main__":
    root = Path(__file__).parent.parent
    html = (root / "index3.html").read_text(encoding="utf-8")
    import re
    colors = json.loads(re.search(r"const VENDOR_COLORS = (\{.*?\});", html).group(1))
    p = build(root / "terminals_anonymized.json", root / "og-preview.png", colors)
    print(f"wrote {p} ({p.stat().st_size/1024:.0f} KB)")
