#!/usr/bin/env python3
"""sheet.py — build 2x2 contact sheet from 4 turntable views.
Usage: python3 sheet.py <previews_dir> <identity> [out.png]
Reads <previews_dir>/final_<identity>_{front,threequarter,side,back}.png,
writes sheet_<identity>.png (2048x2048, labelled quadrants)."""
import os, sys
from PIL import Image, ImageDraw

VIEWS = ["front", "threequarter", "side", "back"]

def main():
    pdir, ident = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(pdir, f"sheet_{ident}.png")
    cells = []
    for v in VIEWS:
        p = os.path.join(pdir, f"final_{ident}_{v}.png")
        if not os.path.exists(p):
            print(f"[sheet] MISSING {p}", flush=True)
            return 1
        cells.append(Image.open(p).convert("RGB").resize((1024, 1024)))
    sheet = Image.new("RGB", (2048, 2048), (12, 12, 16))
    for i, c in enumerate(cells):
        sheet.paste(c, ((i % 2) * 1024, (i // 2) * 1024))
    d = ImageDraw.Draw(sheet)
    for i, v in enumerate(VIEWS):
        d.text((20 + (i % 2) * 1024, 20 + (i // 2) * 1024), v.upper(), fill=(255, 255, 255))
    sheet.save(out)
    print(f"[sheet] wrote {out}", flush=True)

main()
