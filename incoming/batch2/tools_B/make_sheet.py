#!/usr/bin/env python3
"""Compose 2x2 contact sheet from 4 turntable views."""
import sys
from PIL import Image

outdir, identity = sys.argv[1], sys.argv[2]
views = ["front", "threequarter", "side", "back"]
imgs = [Image.open(f"{outdir}/final_{identity}_{v}.png") for v in views]
w, h = imgs[0].size
sheet = Image.new("RGB", (w * 2, h * 2), (10, 10, 14))
for i, im in enumerate(imgs):
    sheet.paste(im, ((i % 2) * w, (i // 2) * h))
sheet.save(f"{outdir}/sheet_{identity}.png")
print(f"wrote {outdir}/sheet_{identity}.png", sheet.size)
