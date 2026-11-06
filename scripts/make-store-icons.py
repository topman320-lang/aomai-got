"""Regenerate square app icons and splash boards from the wordmark.

Requires Pillow (not an app dependency): pip install pillow
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "public" / "brand"
ICONS = ROOT / "public" / "icons"
SPLASH = ROOT / "public" / "splash"
FONT = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"

INK = (17, 17, 17, 255)
PAPER = (255, 255, 255, 255)


def square_mark(size, bg, fg, pad=0.18):
    image = Image.new("RGBA", (size, size), bg)
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT, int(size * (1 - pad * 2) * 0.72))
    text = "澳"
    box = draw.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (size - w) / 2 - box[0]
    y = (size - h) / 2 - box[1]
    draw.text((x, y), text, font=font, fill=fg)
    return image


def fit_logo(canvas, logo_path, max_w_ratio=0.78):
    logo = Image.open(logo_path).convert("RGB")
    max_w = int(canvas.width * max_w_ratio)
    scale = min(max_w / logo.width, (canvas.height * 0.28) / logo.height)
    resized = logo.resize((max(1, int(logo.width * scale)), max(1, int(logo.height * scale))), Image.Resampling.LANCZOS)
    x = (canvas.width - resized.width) // 2
    y = (canvas.height - resized.height) // 2
    # Wordmark JPEGs are full-bleed black or white, so the board uses that same ground.
    canvas.paste(resized, (x, y))
    return canvas


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    SPLASH.mkdir(parents=True, exist_ok=True)
    master = square_mark(1024, INK, PAPER, pad=0.2)
    master.save(ICONS / "icon-1024.png", optimize=True)
    for size, name in ((512, "icon-512.png"), (192, "icon-192.png"), (180, "icon-180.png"), (48, "icon-48.png")):
        master.resize((size, size), Image.Resampling.LANCZOS).save(ICONS / name, optimize=True)
    mask = square_mark(512, INK, PAPER, pad=0.28)
    mask.save(ICONS / "icon-maskable-512.png", optimize=True)
    # Android status-bar glyph: white mark, transparent ground.
    glyph = square_mark(96, (0, 0, 0, 0), PAPER, pad=0.12)
    glyph.save(ICONS / "ic-stat-aomai.png", optimize=True)

    light = Image.new("RGB", (1080, 1920), (255, 255, 255))
    fit_logo(light, BRAND / "logo-light.jpg").save(SPLASH / "splash-light.png", optimize=True)
    dark = Image.new("RGB", (1080, 1920), (0, 0, 0))
    fit_logo(dark, BRAND / "logo-dark.jpg").save(SPLASH / "splash-dark.png", optimize=True)
    print("wrote icons and splash")


if __name__ == "__main__":
    main()
