#!/usr/bin/env python3
"""Regenerates the app icon set from assets-source/app-icon.png (needs Pillow).

Run from the repo root:  python3 tools/gen-app-icons.py

Writes public/icons/{pwa-192,pwa-512,pwa-maskable-512,apple-touch-icon,favicon-32,favicon-16}.png
and public/favicon.ico. The source art sits inside the maskable safe zone (the
central 80 % circle) on its own navy background, so one image serves both the
"any" and the "maskable" icons.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets-source" / "app-icon.png"
OUT = ROOT / "public" / "icons"

src = Image.open(SRC).convert("RGBA")
assert src.size[0] == src.size[1], "source icon must be square"
OUT.mkdir(parents=True, exist_ok=True)


def save(name: str, size: int) -> None:
    img = src.resize((size, size), Image.LANCZOS)
    # fully opaque: the navy square is the icon's own background
    img.convert("RGB").save(OUT / name, optimize=True)
    print("wrote", name, size)


save("pwa-192.png", 192)
save("pwa-512.png", 512)
save("pwa-maskable-512.png", 512)
save("apple-touch-icon.png", 180)
save("favicon-32.png", 32)
save("favicon-16.png", 16)

ico = src.resize((48, 48), Image.LANCZOS).convert("RGBA")
ico.save(ROOT / "public" / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
print("wrote favicon.ico")
