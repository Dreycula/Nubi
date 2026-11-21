"""Builds the fist and wrench hotbar icons (32x32) in the same flat 3-tone pixel style as the character.
Usage: python3 tools/build_tools.py assets/ui
"""
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/ui'
N = 32
hexc = lambda h: tuple(int(h[i:i+2], 16) for i in (0, 2, 4)) + (255,)

def layer(draw_fn, pal):
    """Paint one shape: fill, then edge, light top rows and shaded bottom rows, all from the shape's own mask."""
    m = Image.new('L', (N, N), 0)
    draw_fn(ImageDraw.Draw(m))
    px = m.load()
    inside = lambda x, y: 0 <= x < N and 0 <= y < N and px[x, y] > 0
    out = Image.new('RGBA', (N, N), (0, 0, 0, 0)); o = out.load()
    for y in range(N):
        for x in range(N):
            if not inside(x, y): continue
            edge = not (inside(x-1, y) and inside(x+1, y) and inside(x, y-1) and inside(x, y+1))
            if edge: o[x, y] = pal['edge']
            elif not inside(x, y-2) and not inside(x-1, y-1): o[x, y] = pal['light']
            elif not inside(x, y-1): o[x, y] = pal['light']
            elif not inside(x, y+2) or not inside(x+1, y+1): o[x, y] = pal['shade']
            elif not inside(x+2, y): o[x, y] = pal['shade']
            else: o[x, y] = pal['base']
    return out

def stack(layers):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    for l in layers: img.alpha_composite(l)
    return img

# ---------------- fist (the character's own skin tones) ----------------
SKIN = dict(edge=hexc('a9805f'), light=hexc('ffdaae'), base=hexc('f2c39b'), shade=hexc('d7ae8a'))
CREASE = hexc('c29c7c')
def rr(box, r): return lambda d: d.rounded_rectangle(box, radius=r, fill=255)

fist = [
    layer(rr((9, 22, 23, 29), 2), SKIN),                       # wrist
    layer(rr((6, 12, 25, 25), 4), SKIN),                       # palm / back of the hand
]
for x0 in (6, 11, 16, 21):                                     # four fingers, knuckles up
    fist.append(layer(rr((x0, 5, x0 + 5, 17), 2), SKIN))
fist.append(layer(lambda d: d.rounded_rectangle((3, 15, 17, 22), radius=3, fill=255), SKIN))   # thumb across the fingers
img = stack(fist)
px = img.load()
for x in (11, 16, 21):                                         # finger gaps stay readable
    for y in range(8, 15):
        if px[x, y][3] and px[x, y] != SKIN['edge']: px[x, y] = CREASE
img.save(f'{OUT}/fist.png')

# ---------------- wrench (steel, same flat shading) ----------------
STEEL = dict(edge=hexc('3f4452'), light=hexc('e3e8f0'), base=hexc('a9b1c0'), shade=hexc('7b8396'))
def handle(d): d.line([(8, 24), (21, 11)], fill=255, width=8)
def head(d):
    d.ellipse((15, 2, 29, 16), fill=255)
    d.polygon([(21, 2), (26, 2), (25, 9), (20, 8)], fill=0)    # the jaw notch of the open end
def tail(d):
    d.ellipse((2, 19, 13, 30), fill=255)
    d.ellipse((6, 23, 9, 26), fill=0)                          # hanging hole
img = stack([layer(handle, STEEL), layer(head, STEEL), layer(tail, STEEL)])
img.save(f'{OUT}/wrench.png')
