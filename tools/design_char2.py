"""Character #2: front-facing, big teal eyes with lashes, small nose, smile and blush. Bald and shirtless like the current
character, same 26x35 canvas, same skin/shorts palette and flat shading, so it drops into the same pipeline
(body.png + arm.png). Usage: python3 tools/design_char2.py assets/player/parts/body.png assets/player/parts/arm.png assets/characters/char2
"""
import sys, shutil
from PIL import Image
src_body, src_arm, out = sys.argv[1:4]
im = Image.open(src_body).convert('RGBA')
px = im.load()
hexc = lambda h: tuple(int(h[i:i+2], 16) for i in (0, 2, 4)) + (255,)
SKIN, SHADE, LIGHT = hexc('f2c39b'), hexc('d7ae8a'), hexc('ffdaae')
LASH, BROW = hexc('3b2622'), hexc('b88a66')
WHITE, WEDGE = hexc('ffffff'), hexc('dfe4ea')
IRIS, IRIS_D, IRIS_L, PUPIL = hexc('3fa3ae'), hexc('2a7482'), hexc('8fd6dc'), hexc('16161a')
BLUSH, MOUTH, NOSE = hexc('ee9b8c'), hexc('7a3828'), hexc('e2b08e')

# clear the old face (inside the head box, x4..21 interior / rows 5..17), keep outline and shading of the head itself
for y in range(5, 18):
    for x in range(5, 22):
        px[x, y] = SKIN

def put(x, y, c): px[x, y] = c

def eye(x0, mirror):
    """6 wide x 5 tall: lash line, sclera with a teal iris, a pupil and a highlight."""
    cols = range(x0, x0 + 6)
    rows = [
        [LASH] * 6,
        [WEDGE, IRIS_L, IRIS, IRIS, IRIS, WEDGE],
        [WHITE, IRIS, PUPIL, PUPIL, IRIS, WHITE],
        [WHITE, IRIS_D, IRIS, IRIS, IRIS_D, WHITE],
        [SKIN, WEDGE, IRIS_D, IRIS_D, WEDGE, SKIN],
    ]
    for r, row in enumerate(rows):
        row = row[::-1] if mirror else row
        for c, col in zip(cols, row):
            put(c, 8 + r, col)

eye(6, False)          # left eye  x6..11  rows 8..12
eye(14, True)          # right eye x14..19 (mirrored so the highlights sit on the same side of each iris)
put(5, 8, LASH); put(5, 9, LASH)         # lash flicks at the outer corners
put(20, 8, LASH); put(20, 9, LASH)
for x in range(6, 11): put(x, 6, BROW)   # thin arched brows
put(5, 7, BROW)
for x in range(15, 20): put(x, 6, BROW)
put(20, 7, BROW)
for x in (6, 7, 8): put(x, 13, BLUSH)    # blush under the eyes
for x in (17, 18, 19): put(x, 13, BLUSH)
put(12, 13, NOSE); put(13, 13, NOSE); put(12, 14, SHADE)    # small nose
for x in (11, 12, 13, 14): put(x, 16, MOUTH)                # smile
put(10, 15, MOUTH); put(15, 15, MOUTH)
im.save(f'{out}/body.png')
shutil.copy(src_arm, f'{out}/arm.png')

# preview next to the current character
old = Image.open(src_body).convert('RGBA'); arm = Image.open(src_arm).convert('RGBA')
def full(body):
    c = Image.new('RGBA', (26, 35), (0, 0, 0, 0))
    c.alpha_composite(arm, (18, 19)); c.alpha_composite(body); c.alpha_composite(arm, (3, 19))
    return c
S = 10
bg = Image.new('RGBA', (26 * S * 2 + 60, 35 * S + 20), (126, 200, 255, 255))
bg.alpha_composite(full(old).resize((26 * S, 35 * S), Image.NEAREST), (20, 10))
bg.alpha_composite(full(im).resize((26 * S, 35 * S), Image.NEAREST), (26 * S + 40, 10))
bg.save(f'{out}/preview.png')
