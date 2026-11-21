"""Builds everything the game needs for the player from the user's own sprites (never edits their pixels except to flip
them and to bake the leg animation / small face overlays):

  assets/characters/chibi/source/body_left.png   body, facing LEFT   (26x38, no arms)
  assets/characters/chibi/source/arms_left.png   both arms on one sheet (29x13)

Output (assets/player/): stand / walk_l / walk_r / jump (body only, flipped to face RIGHT), parts/body.png,
parts/arm_near.png, parts/arm_far.png, blink_half/blink_closed, mouth_half/mouth_open, punch_face, punch_arm.

Usage: python3 tools/build_player.py
"""
import os
from PIL import Image, ImageOps

SRC = 'assets/characters/chibi/source'
OUT = 'assets/player'
os.makedirs(f'{OUT}/parts', exist_ok=True)
CLEAR = (0, 0, 0, 0)
hexc = lambda h: tuple(int(h[i:i+2], 16) for i in (0, 2, 4)) + (255,)

# ---- flip to face right ----
body = ImageOps.mirror(Image.open(f'{SRC}/body_left.png').convert('RGBA'))
W, H = body.size
sheet = Image.open(f'{SRC}/arms_left.png').convert('RGBA')
mid = sheet.width // 2
left_part = sheet.crop((0, 0, mid, sheet.height)); right_part = sheet.crop((mid, 0, sheet.width, sheet.height))
arm_far = ImageOps.mirror(left_part.crop(left_part.getbbox()))     # the sheet's left arm becomes the arm on the far (right) side
arm_near = ImageOps.mirror(right_part.crop(right_part.getbbox()))  # the sheet's right arm becomes the near (left) arm
body.save(f'{OUT}/parts/body.png'); arm_near.save(f'{OUT}/parts/arm_near.png'); arm_far.save(f'{OUT}/parts/arm_far.png')
print('body', body.size, 'arms', arm_near.size, arm_far.size)

# ---- legs: bake body-only frames (the game draws the arms live and rotates them about the shoulder) ----
BR = max(y for y in range(H) if any(body.getpixel((x, y))[3] for x in range(W)))   # bottom row of the feet
LEFT_LEG, RIGHT_LEG = range(0, W // 2), range(W // 2, W)

def lift_leg(img, cols, n=1):
    out = img.copy(); px = img.load(); o = out.load()
    for x in cols:
        if n == 1:   # drop one shaft row, foot rises 1px
            o[x, BR - 2] = px[x, BR - 1]; o[x, BR - 1] = px[x, BR]; o[x, BR] = CLEAR
        else:        # jump: foot rises 2px
            o[x, BR - 3] = px[x, BR - 1]; o[x, BR - 2] = px[x, BR]; o[x, BR - 1] = CLEAR; o[x, BR] = CLEAR
    return out

def frame(ll=False, rl=False, lift=1):
    f = body
    if ll: f = lift_leg(f, LEFT_LEG, lift)
    if rl: f = lift_leg(f, RIGHT_LEG, lift)
    return f.copy()

frames = {'stand': frame(), 'walk_l': frame(ll=True), 'walk_r': frame(rl=True), 'jump': frame(ll=True, rl=True, lift=2)}
order = ['stand', 'walk_l', 'walk_r', 'jump']
for n in order: frames[n].save(f'{OUT}/{n}.png')
sh = Image.new('RGBA', (W * 4, H), CLEAR)
for i, n in enumerate(order): sh.paste(frames[n], (i * W, 0))
sh.save(f'{OUT}/player_sheet.png')

# ---- find the face parts from the body's own colours ----
PUPIL, WHITE, WEDGE, MOUTH = hexc('16161a'), hexc('ffffff'), hexc('dfe4ea'), hexc('7a3828')
LID, LINE, SKIN, SHADE = hexc('ffdaae'), hexc('d7ae8a'), hexc('f2c39b'), hexc('d7ae8a')
bp = body.load()
ball = [(x, y) for y in range(H) for x in range(W) if bp[x, y] in (PUPIL, WHITE, WEDGE) and 9 <= y <= 14]   # eyeball pixels
mouth = [(x, y) for y in range(H) for x in range(W) if bp[x, y] == MOUTH]
eye_top = min(y for _, y in ball)
print('eyeball rows', eye_top, '-', max(y for _, y in ball), '| eyeball px', len(ball), '| mouth px', len(mouth))

def overlay(): return Image.new('RGBA', (W, H), CLEAR)

# ---- blink: half = a light lid over the top row of the eyeball, closed = a thin line with skin under it ----
def blink(stage):
    o = overlay()
    for x, y in ball:
        if y == eye_top:
            o.putpixel((x, y), LID if stage == 'half' else LINE)
        elif stage == 'closed':
            o.putpixel((x, y), SKIN)
    return o
blink('half').save(f'{OUT}/blink_half.png'); blink('closed').save(f'{OUT}/blink_closed.png')

# ---- talking / jumping mouth: wipe the drawn mouth, draw a small dark open mouth in its middle ----
mx0, mx1 = min(x for x, _ in mouth), max(x for x, _ in mouth)
my0, my1 = min(y for _, y in mouth), max(y for _, y in mouth)
mcx = (mx0 + mx1) // 2
def mouth_overlay(stage):
    o = overlay()
    for p in mouth: o.putpixel(p, SKIN)
    rows = (my1 - 1, my1) if stage == 'open' else (my1,)          # open = 3x2 dark mouth, half = 3x1
    for y in rows:
        for x in (mcx - 1, mcx, mcx + 1): o.putpixel((x, y), PUPIL)
    return o
mouth_overlay('half').save(f'{OUT}/mouth_half.png'); mouth_overlay('open').save(f'{OUT}/mouth_open.png')

# ---- punch face: angry lids slanting down toward the nose over the eyes' inner corners ----
xs = sorted(set(x for x, _ in ball))
groups, cur = [], [xs[0]]
for x in xs[1:]:
    if x - cur[-1] > 1: groups.append(cur); cur = [x]
    else: cur.append(x)
groups.append(cur)                                                   # one x-range per eye, left to right
def punch_face():
    o = overlay()
    for gi, g in enumerate(groups):
        inner = g[-3:] if gi == 0 else g[:3]                         # toward the middle of the face
        # the lid is lowest at the corner nearest the nose bridge
        for x in inner: o.putpixel((x, eye_top), LINE)
        for x in (inner[-2:] if gi == 0 else inner[:2]): o.putpixel((x, eye_top + 1), LINE)
    return o
punch_face().save(f'{OUT}/punch_face.png')

# ---- chunky punching arm (15 wide) in the body's own skin tones: shoulder rows, one repeatable middle row, fist rows ----
EDGE, BASE, HI, SHD, CRE = hexc('d7ae8a'), hexc('f2c39b'), hexc('ffdaae'), hexc('d7ae8a'), hexc('c29c7c')
PAL = {'d': EDGE, 'b': BASE, 'h': HI, 's': SHD, 'k': CRE}
AW = 15
def body_row(gaps=(), hi=(1, 2), sh=(AW - 3, AW - 2)):
    r = ['b'] * AW; r[0] = r[-1] = 'd'
    for x in hi: r[x] = 'h'
    for x in sh: r[x] = 's'
    for x in gaps: r[x] = 'k'
    return ''.join(r)
def cap(top, n): return ''.join('.' if i < n or i >= AW - n else ch for i, ch in enumerate(top))
MID = body_row()
ROWS = [cap(body_row(hi=(), sh=()).replace('b', 'd'), 3), cap(body_row(), 1), MID, MID, MID, MID,
        body_row(gaps=(5, 8, 11)), body_row(gaps=(5, 8, 11)), body_row(gaps=(5, 8, 11)), body_row(),
        body_row(hi=(), sh=(AW - 4, AW - 3, AW - 2)), cap(body_row(hi=(), sh=(AW - 4, AW - 3, AW - 2)), 1),
        cap(body_row(hi=(), sh=(AW - 4, AW - 3, AW - 2)), 2), cap(body_row(hi=(), sh=()).replace('b', 'd'), 3)]
pa = Image.new('RGBA', (AW, len(ROWS)), CLEAR)
for y, row in enumerate(ROWS):
    for x, ch in enumerate(row):
        if ch != '.': pa.putpixel((x, y), PAL[ch])
pa.save(f'{OUT}/punch_arm.png')
print('done')
