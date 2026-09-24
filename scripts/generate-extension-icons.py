#!/usr/bin/env python3
"""Generate simple PNG icons for the Shop Protocol Recorder Chrome extension.
Icons are simple dark circles with a magnifier + arrow motif, drawn with PIL."""
from PIL import Image, ImageDraw

def draw_icon(size: int, output: str) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Dark rounded background
    margin = max(1, size // 16)
    d.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=size // 5,
        fill=(31, 41, 55, 255),  # stone-900
    )
    # Magnifier circle (top-left)
    cx, cy = size // 3, size // 3
    r = max(2, size // 5)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 255), width=max(1, size // 32))
    # Magnifier handle (bottom-right)
    hx1, hy1 = cx + r - 1, cy + r - 1
    hx2, hy2 = size - margin - r // 2, size - margin - r // 2
    d.line([hx1, hy1, hx2, hy2], fill=(255, 255, 255, 255), width=max(1, size // 32))
    # Small arrow pointing down (network capture hint)
    ax = size // 2 + r
    ay = cy - r // 2
    d.line([ax, ay, ax, ay + r // 2], fill=(16, 185, 129, 255), width=max(1, size // 24))
    d.polygon(
        [(ax - r // 4, ay + r // 2 - 1), (ax + r // 4, ay + r // 2 - 1), (ax, ay + r // 2 + r // 4)],
        fill=(16, 185, 129, 255),
    )
    img.save(output)
    print(f"Generated {output} ({size}x{size})")

if __name__ == "__main__":
    for size in [16, 48, 128]:
        draw_icon(size, f"/home/z/my-project/extension/icons/icon-{size}.png")
