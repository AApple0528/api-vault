"""Rebuild Android launcher resources from assets/app-icon.png.

Run with Python + Pillow + NumPy (asset tooling only; no app dependencies).
The edge-connected blue/white background is removed without touching enclosed
white features. Artwork fits inside Android's central 66 dp safe circle.
"""
from collections import deque
from pathlib import Path
import hashlib

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android/app/src/main/res"
SOURCE = ROOT / "assets/app-icon.png"
PREVIEW = ROOT / "android/app/build/icon-preview.png"
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def main():
    original_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    source = Image.open(SOURCE).convert("RGB")
    pixels = np.array(source).astype(np.int16)
    red, green, blue = pixels.transpose(2, 0, 1)
    # This source has a blue background and an almost-white outside border.
    candidate = ((blue > red + 20) & (blue > green + 8) & (blue > 120)) | (
        (red > 235) & (green > 235) & (blue > 235)
    )
    height, width = candidate.shape
    background = np.zeros(candidate.shape, dtype=bool)
    pending = deque()
    for x in range(width):
        pending.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        pending.extend(((0, y), (width - 1, y)))
    while pending:
        x, y = pending.popleft()
        if x < 0 or y < 0 or x >= width or y >= height or background[y, x] or not candidate[y, x]:
            continue
        background[y, x] = True
        pending.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))

    # Sample the clear blue band near the top, away from the white border.
    sample = pixels[60:180, width // 3:width * 2 // 3]
    color = tuple(int(v) for v in np.median(sample.reshape(-1, 3), axis=0))
    rgba = np.dstack((pixels.astype(np.uint8), np.where(background, 0, 255).astype(np.uint8)))
    artwork = Image.fromarray(rgba)
    bounds = artwork.getbbox()
    if bounds is None:
        raise ValueError("No foreground detected")
    artwork = artwork.crop(bounds)
    alpha = np.array(artwork.getchannel("A"))
    ys, xs = np.nonzero(alpha)
    center_x, center_y = artwork.width / 2, artwork.height / 2
    radius = np.sqrt((xs - center_x) ** 2 + (ys - center_y) ** 2).max()
    # 64 dp diameter leaves a 1 dp margin inside the 66 dp guaranteed circle.
    scale = 32 / radius
    working_size = 1296  # 108 dp at 12x for clean downsampling.
    foreground = Image.new("RGBA", (working_size, working_size))
    scaled = artwork.resize((round(artwork.width * scale * 12), round(artwork.height * scale * 12)), Image.Resampling.LANCZOS)
    foreground.alpha_composite(scaled, ((working_size - scaled.width) // 2, (working_size - scaled.height) // 2))
    composite = Image.new("RGBA", foreground.size, (*color, 255))
    composite.alpha_composite(foreground)
    # Standard launcher viewport shows the central 72 dp of the 108 dp layers.
    viewport = composite.crop((216, 216, 1080, 1080))
    for density, factor in DENSITIES.items():
        folder = RES / f"mipmap-{density}"
        if not folder.is_dir():
            raise ValueError(f"Expected existing resource folder: {folder}")
        foreground.resize((round(108 * factor),) * 2, Image.Resampling.LANCZOS).save(folder / "ic_launcher_foreground.png")
        for name, rounded in (("ic_launcher.png", False), ("ic_launcher_round.png", True)):
            mask = Image.new("L", viewport.size)
            draw = ImageDraw.Draw(mask)
            if rounded:
                draw.ellipse((0, 0, 863, 863), fill=255)
            else:
                draw.rounded_rectangle((0, 0, 863, 863), radius=172, fill=255)
            legacy = viewport.copy()
            legacy.putalpha(mask)
            legacy.resize((round(48 * factor),) * 2, Image.Resampling.LANCZOS).save(folder / name)

    # Preview is a build artifact, not another packaged icon resource.
    preview = Image.new("RGB", (1080, 330), "#ececec")
    draw = ImageDraw.Draw(preview)
    for i, (label, shape) in enumerate((("Adaptive circle", "circle"), ("Adaptive squircle", "squircle"), ("Legacy rounded square", "rounded"))):
        tile = viewport.resize((288, 288), Image.Resampling.LANCZOS)
        mask = Image.new("L", (288, 288))
        painter = ImageDraw.Draw(mask)
        if shape == "circle":
            painter.ellipse((0, 0, 287, 287), fill=255)
        elif shape == "squircle":
            yy, xx = np.mgrid[:288, :288]
            values = (np.abs((xx - 143.5) / 143.5) ** 4 + np.abs((yy - 143.5) / 143.5) ** 4 <= 1)
            mask = Image.fromarray((values * 255).astype(np.uint8))
        else:
            painter.rounded_rectangle((0, 0, 287, 287), radius=57, fill=255)
        preview.paste(tile, (i * 360 + 36, 10), mask)
        draw.text((i * 360 + 36, 310), label, fill="#222222")
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    preview.save(PREVIEW)
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == original_hash
    print(f"Background: #{color[0]:02X}{color[1]:02X}{color[2]:02X}")
    print(f"Foreground source bounds: {bounds}; scaled to {artwork.width * scale:.2f} x {artwork.height * scale:.2f} dp")
    print("15 PNG resources generated; foreground diameter <= 64 dp (66 dp safe circle).")
    print(f"Preview: {PREVIEW}")


if __name__ == "__main__":
    main()
