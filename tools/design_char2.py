"""Character #2 in the proportions of the chibi reference: a very big square head on a small body. Bald and shirtless
(blue shorts) like the current character, same 26x35 canvas, same skin palette and flat shading, no outline.
Writes body.png (no arms), arm.png (4x8, shorter to match the small body) and preview.png.
Usage: python3 tools/design_char2.py assets/characters/char2
"""
import sys
from PIL import Image

out = sys.argv[1]
W, H = 26, 35
hexc = lambda h: tuple(int(h[i:i+2], 16) for i in (0, 2, 4)) + (255,)
EDGE, SHADE, SKIN, TOP, LIGHT = hexc('c29c7c'), hexc('d7ae8a'), hexc('f2c39b'), hexc('ffcfa4'), hexc('ffdaae')
LASH, BROW = hexc('3b2622'), hexc('b88a66')
WHITE, WEDGE = hexc('ffffff'), hexc('dfe4ea')
IRIS, IRIS_D, IRIS_L, PUPIL = hexc('3fa3ae'), hexc('2a7482'), hexc('8fd6dc'), hexc('16161a')
BLUSH, MOUTH, NOSE = hexc('ee9b8c'), hexc('7a3828'), hexc('e2b08e')
SH1, SH2, SH3 = hexc('437ec1'), hexc('3a6ea8'), hexc('2e5886')

im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
px = im.load()
def put(x, y, c): px[x, y] = c
def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1): put(x, y, c)

# ---- head: 24 x 20, rounded corners, light top, shaded left/bottom ----
HX0, HX1, HY0, HY1 = 1, 24, 1, 20
rect(HX0, HY0, HX1, HY1, SKIN)
for x in range(HX0, HX1 + 1): put(x, HY0, EDGE); put(x, HY1, EDGE)
for y in range(HY0, HY1 + 1): put(HX0, y, EDGE); put(HX1, y, EDGE)
for x in range(HX0 + 1, HX1): put(x, HY0 + 1, TOP)           # lit top
for y in range(HY0 + 1, HY1): put(HX0 + 1, y, SHADE)          # shaded left side
for x in range(HX0 + 1, HX1): put(x, HY1 - 1, SHADE)          # shaded under the chin
for (x, y) in ((HX0, HY0), (HX1, HY0), (HX0, HY1), (HX1, HY1)): put(x, y, (0, 0, 0, 0))   # round the corners

# ---- face: three-quarter view turned to the right (like the reference). The nearer (left) eye is wide, the far (right)
# eye is narrower, the pupils look to the right, the nose and mouth sit right of centre and an ear shows on the left ----
def draw_eye(x0, rows):
    for r, row in enumerate(rows):
        for c, col in enumerate(row): put(x0 + c, 8 + r, col)
NEAR = [
    [LASH] * 7,
    [WEDGE, WHITE, IRIS_D, IRIS, IRIS, IRIS_D, WEDGE],
    [WHITE, WHITE, IRIS_L, PUPIL, PUPIL, IRIS, WHITE],
    [WHITE, WHITE, IRIS, PUPIL, PUPIL, IRIS, WHITE],
    [WHITE, WHITE, IRIS_D, IRIS, IRIS, IRIS_D, WHITE],
    [SKIN, WEDGE, WEDGE, IRIS_D, IRIS_D, WEDGE, SKIN],
]
FAR = [
    [LASH] * 5,
    [WEDGE, IRIS_D, IRIS, IRIS, IRIS_D],
    [WHITE, IRIS, PUPIL, PUPIL, IRIS],
    [WHITE, IRIS, PUPIL, PUPIL, IRIS],
    [WHITE, IRIS_D, IRIS, IRIS, IRIS_D],
    [SKIN, WEDGE, IRIS_D, IRIS_D, WEDGE],
]
draw_eye(6, NEAR); draw_eye(16, FAR)
put(5, 8, LASH); put(5, 9, LASH)                      # lash flick, near eye
put(21, 8, LASH)                                      # lash flick, far eye
for x in range(6, 12): put(x, 6, BROW)                # brows
for x in range(16, 21): put(x, 6, BROW)
for x in (5, 6, 7): put(x, 14, BLUSH)                 # blush: bigger on the near cheek
for x in (19, 20): put(x, 14, BLUSH)
put(14, 12, NOSE); put(15, 13, NOSE); put(15, 14, SHADE); put(14, 14, SHADE)   # nose pointing right
for x in range(12, 18): put(x, 17, MOUTH)             # smile, nearer to the front edge
put(11, 16, MOUTH); put(18, 16, MOUTH)
for y in range(11, 15): put(3, y, SHADE); put(4, y, SHADE)   # ear on the near side of the head
put(3, 12, EDGE); put(3, 13, EDGE); put(4, 12, EDGE)

# ---- small body: neck, torso, shorts, legs ----
rect(10, 21, 15, 21, SHADE)                                              # neck
rect(8, 22, 17, 27, SKIN)
for y in range(22, 28): put(8, y, SHADE); put(17, y, SHADE)              # torso sides
rect(8, 28, 17, 28, SH1); rect(8, 29, 17, 29, SH2)                       # shorts
for x in (12, 13): put(x, 29, SH3)
for x0 in (8, 14):                                                       # legs, 4 wide each, gap in the middle
    rect(x0, 30, x0 + 3, 33, SKIN)
    put(x0, 30, SH3); put(x0 + 1, 30, SH3); put(x0 + 2, 30, SH3); put(x0 + 3, 30, SH3)
    for y in range(31, 34): put(x0, y, SHADE)
    rect(x0, 34, x0 + 4 if x0 == 14 else x0 + 3, 34, SHADE)               # feet (right foot points a pixel further, like the original)
rect(7, 34, 7, 34, SHADE)
im.save(f'{out}/body.png')

# ---- short arm for the small body ----
arm = Image.new('RGBA', (4, 8), (0, 0, 0, 0))
ap = arm.load()
for y in range(8):
    for x in range(4):
        ap[x, y] = SKIN
    ap[0, y] = SHADE; ap[3, y] = SHADE
ap[1, 1] = LIGHT; ap[1, 2] = LIGHT; ap[1, 3] = LIGHT
ap[0, 0] = ap[3, 0] = (0, 0, 0, 0)
for x in range(4): ap[x, 7] = SHADE
arm.save(f'{out}/arm.png')

# ---- preview: new character, with the current one for scale ----
def full(body, a, ax_l, ax_r, ay):
    c = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    c.alpha_composite(a, (ax_r, ay)); c.alpha_composite(body); c.alpha_composite(a, (ax_l, ay))
    return c
S = 10
cur_b = Image.open('assets/player/parts/body.png').convert('RGBA'); cur_a = Image.open('assets/player/parts/arm.png').convert('RGBA')
bg = Image.new('RGBA', (W * S * 2 + 60, H * S + 20), (126, 200, 255, 255))
bg.alpha_composite(full(cur_b, cur_a, 3, 18, 19).resize((W * S, H * S), Image.NEAREST), (20, 10))
bg.alpha_composite(full(im, arm, 4, 18, 22).resize((W * S, H * S), Image.NEAREST), (W * S + 40, 10))
bg.save(f'{out}/preview.png')
