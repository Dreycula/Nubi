"""Builds the player frames from the blank base body (assets/characters/base2/source/body.png, 26x38, arms baked in).

The old chibi pipeline is tools/build_player.py (sources kept in assets/characters/chibi). This one replaces the
character with the base: outline gaps are repaired, walk/jump frames are baked, the separate arm sprites are empty
(arms are part of the body now) and the face overlays are blank except the punch brows.

Usage: python3 tools/build_player_base.py
"""
import os
from PIL import Image

SRC = 'assets/characters/base2/source/body.png'
OUT = 'assets/player'
os.makedirs(f'{OUT}/parts', exist_ok=True)
CLEAR = (0, 0, 0, 0)
OUTLINE = (194, 156, 124, 255)
BROW = (184, 138, 102, 255)

body = Image.open(SRC).convert('RGBA')
W, H = body.size
px = body.load()
# repair the silhouette: every pixel on the edge of the shape is the outline colour (closes the gaps left by shrinking)
mask = [[px[x, y][3] > 0 for x in range(W)] for y in range(H)]
def solid(x, y): return 0 <= x < W and 0 <= y < H and mask[y][x]
for y in range(H):
    for x in range(W):
        if mask[y][x] and not (solid(x + 1, y) and solid(x - 1, y) and solid(x, y + 1) and solid(x, y - 1)):
            px[x, y] = OUTLINE

BR = max(y for y in range(H) if any(px[x, y][3] for x in range(W)))
SPLIT = 13
def lift_leg(img, cols, n):
    out = img.copy(); p = img.load(); o = out.load()
    for x in cols:
        if n == 1: o[x, BR - 2] = p[x, BR - 1]; o[x, BR - 1] = p[x, BR]; o[x, BR] = CLEAR
        else: o[x, BR - 3] = p[x, BR - 1]; o[x, BR - 2] = p[x, BR]; o[x, BR - 1] = CLEAR; o[x, BR] = CLEAR
    return out
frames = {'stand': body.copy(), 'walk_l': lift_leg(body, range(0, SPLIT), 1), 'walk_r': lift_leg(body, range(SPLIT, W), 1),
          'jump': lift_leg(lift_leg(body, range(0, SPLIT), 2), range(SPLIT, W), 2)}
for n, f in frames.items(): f.save(f'{OUT}/{n}.png')
sh = Image.new('RGBA', (W * 4, H), CLEAR)
for i, n in enumerate(['stand', 'walk_l', 'walk_r', 'jump']): sh.paste(frames[n], (i * W, 0))
sh.save(f'{OUT}/player_sheet.png')
body.save(f'{OUT}/parts/body.png')

blank = lambda w, h: Image.new('RGBA', (w, h), CLEAR)
blank(6, 10).save(f'{OUT}/parts/arm_near.png'); blank(6, 10).save(f'{OUT}/parts/arm_far.png')
for n in ('blink_half', 'blink_closed', 'mouth_half', 'mouth_open'): blank(W, H).save(f'{OUT}/{n}.png')

pf = blank(W, H); o = pf.load()
for x, y in [(5, 12), (6, 12), (7, 13), (8, 13), (9, 13), (13, 13), (14, 13), (15, 13), (16, 12), (17, 12)]: o[x, y] = BROW
pf.save(f'{OUT}/punch_face.png')
print('done', W, H, 'feet row', BR)
