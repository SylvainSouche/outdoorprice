#!/usr/bin/env python3
"""
Generate PNG icons for Electron packaging from the SVG logo.

Why this script exists:
  electron-builder accepts PNG icons for mac/win/linux, but it does NOT
  accept SVG directly on macOS/Windows. We need PNGs at specific sizes:

    - 16x16, 32x32, 64x64, 128x128, 256x256, 512x512, 1024x1024 for mac
    - 256x256 (or larger) for win
    - 512x512 for linux

  We generate ONE big 1024x1024 PNG; electron-builder will downscale as
  needed for the platform. We also keep the SVG as the editable source.

  Output:
    public/icon-1024.png   — main icon used by electron-builder
    public/icon-512.png    — fallback / Linux
    public/icon-256.png    — fallback / Windows
    public/icon-mac.png    — alias of 1024 for clarity in package.json
"""

import sys
from pathlib import Path

try:
    import cairosvg
except ImportError:
    print("ERROR: cairosvg not installed. Run: pip install cairosvg", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "public" / "logo.svg"

if not SVG.exists():
    print(f"ERROR: {SVG} does not exist", file=sys.stderr)
    sys.exit(1)

SIZES = [16, 32, 64, 128, 256, 512, 1024]

for size in SIZES:
    out = ROOT / "public" / f"icon-{size}.png"
    cairosvg.svg2png(
        url=str(SVG),
        write_to=str(out),
        output_width=size,
        output_height=size,
    )
    print(f"  generated {out.relative_to(ROOT)} ({size}x{size})")

# Aliases for clarity in package.json
import shutil
shutil.copy(ROOT / "public" / "icon-1024.png", ROOT / "public" / "icon-mac.png")
shutil.copy(ROOT / "public" / "icon-512.png",  ROOT / "public" / "icon.png")
print(f"  generated public/icon-mac.png (alias of 1024)")
print(f"  generated public/icon.png (alias of 512, default)")

print("\nDone. Update package.json to use these:")
print('  mac.icon:   "public/icon-mac.png"')
print('  win.icon:   "public/icon-256.png"')
print('  linux.icon: "public/icon.png"')
