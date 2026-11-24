"""Builds the player frames from the user's base body, used EXACTLY as drawn (assets/characters/base2/source/original_43x68.png).

The game draws the sprite at half scale (see SPK in game.js), so the 43x68 body is one tile tall. Nothing is resized or
repainted: the walk / jump frames only lift the feet, the arms are part of the body (the separate arm sprites are empty),
and the face overlays are blank except the punch brows.

Usage: python3 tools/build_player_base.py
"""
import os
from PIL import Image

SRC = 'assets/characters/base2/source/original_43x68.png'
OUT = 'assets/player'
os.makedirs(f'{OUT}/parts', exist_ok=True)
CLEAR = (0, 0, 0, 0)
BROW = (184, 138, 102, 255)

body = Image.open(SRC).convert('RGBA')
W, H = body.size
px = body.load()
BR = max(y for y in range(H) if any(px[x, y][3] for x in range(W)))      # bottom row of the feet
SPLIT = 21                                                                # column between the two legs
def lift_leg(img, cols, n):
    """raise a foot by n pixels: drop n rows from the shaft and shift everything below up"""
    out = img.copy(); p = img.load(); o = out.load()
    top = BR - 9
    for x in cols:
        for y in range(top, BR + 1):
            o[x, y] = p[x, y + n] if y + n <= BR else CLEAR
    return out
frames = {'stand': body.copy(),
          'walk_l': lift_leg(body, range(0, SPLIT), 2), 'walk_r': lift_leg(body, range(SPLIT, W), 2),
          'jump': lift_leg(lift_leg(body, range(0, SPLIT), 4), range(SPLIT, W), 4)}
for n, f in frames.items(): f.save(f'{OUT}/{n}.png')
sh = Image.new('RGBA', (W * 4, H), CLEAR)
for i, n in enumerate(['stand', 'walk_l', 'walk_r', 'jump']): sh.paste(frames[n], (i * W, 0))
sh.save(f'{OUT}/player_sheet.png')
body.save(f'{OUT}/parts/body.png')

blank = lambda w, h: Image.new('RGBA', (w, h), CLEAR)
blank(6, 10).save(f'{OUT}/parts/arm_near.png'); blank(6, 10).save(f'{OUT}/parts/arm_far.png')
for n in ('blink_half', 'blink_closed', 'mouth_half', 'mouth_open'): blank(W, H).save(f'{OUT}/{n}.png')

pf = blank(W, H); o = pf.load()
brows = [(8, 18), (9, 18), (10, 19), (11, 19), (12, 20), (13, 20), (14, 20)]          # left brow slopes down toward the nose
for x, y in brows: o[x, y] = BROW
for x, y in brows: o[33 - x, y] = BROW                                              # mirrored for the right eye (nose at x=16.5)
pf.save(f'{OUT}/punch_face.png')
print('done', W, H, 'feet row', BR)
