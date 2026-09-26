#!/usr/bin/env python3
"""Build 2x2 contact sheets from final turntable renders."""
import os, sys
from PIL import Image, ImageDraw

PREV = os.path.expanduser('~/workspace/rpg-crawler-game/art-work/previews/incoming/batch2')
VIEWS = ['front', 'threequarter', 'side', 'back']

def sheet(identity):
    tiles = []
    for v in VIEWS:
        p = os.path.join(PREV, f'final_{identity}_{v}.png')
        if not os.path.exists(p):
            print(f'MISSING {p}')
            return False
        tiles.append((v, Image.open(p).convert('RGB')))
    w, h = tiles[0][1].size
    sh = Image.new('RGB', (w * 2, h * 2), (10, 10, 14))
    d = ImageDraw.Draw(sh)
    for i, (v, im) in enumerate(tiles):
        x, y = (i % 2) * w, (i // 2) * h
        sh.paste(im, (x, y))
        d.text((x + 12, y + 12), v, fill=(255, 220, 120))
    out = os.path.join(PREV, f'sheet_{identity}.png')
    sh.save(out)
    print('wrote', out, sh.size)
    return True

ok = True
for ident in sys.argv[1:]:
    ok = sheet(ident) and ok
sys.exit(0 if ok else 1)
