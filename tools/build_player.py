import sys
from PIL import Image
BODY, ARM, OUT, MODE, A = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5])
body = Image.open(BODY).convert('RGBA'); arm = Image.open(ARM).convert('RGBA')
W, H = body.size                       # 26 x 35
CLEAR = (0, 0, 0, 0)
SHOULDER_Y = 19                        # arm top row; arm hangs along the torso (rows 19-28)
LX, RX = 3, 18                         # arm outer edges line up with the head's edges (x=3 and x=22)
LEFT_LEG = range(5, 13); RIGHT_LEG = range(13, 22)

def lift_leg(img, cols, n=1):
    out = img.copy(); px = img.load(); o = out.load()
    for x in cols:
        if n == 1:   # drop one shaft row, foot rises 1px
            o[x,32]=px[x,33]; o[x,33]=px[x,34]; o[x,34]=CLEAR
        else:        # jump: foot rises 2px
            o[x,31]=px[x,33]; o[x,32]=px[x,34]; o[x,33]=CLEAR; o[x,34]=CLEAR
    return out

def place(ax, k):
    """The untouched arm sprite at its shoulder, moved/rotated as one rigid piece."""
    layer = Image.new('RGBA', (W, H), CLEAR)
    if MODE == 'shift':
        layer.alpha_composite(arm, (ax + int(k), SHOULDER_Y))
    else:
        layer.alpha_composite(arm, (ax, SHOULDER_Y))
        layer = layer.rotate(k, resample=Image.NEAREST, center=(ax + 2.5, SHOULDER_Y + 0.5))
    return layer

def frame(ll=False, rl=False, kl=0, kr=0, lift=1):
    f = body
    if ll: f = lift_leg(f, LEFT_LEG, lift)
    if rl: f = lift_leg(f, RIGHT_LEG, lift)
    f = f.copy()
    if MODE == 'none':          # body only: the game draws the arms live and rotates them
        return f
    f.alpha_composite(place(LX, kl)); f.alpha_composite(place(RX, kr))
    return f

frames = {
    'stand':  frame(),
    'walk_l': frame(ll=True, kl=-A, kr=-A),
    'walk_r': frame(rl=True, kl=A, kr=A),
    'jump':   frame(ll=True, rl=True, kl=-A, kr=A, lift=2),
}
order = ['stand', 'walk_l', 'walk_r', 'jump']
import os; os.makedirs(OUT, exist_ok=True)
for n in order: frames[n].save(f'{OUT}/{n}.png')
sheet = Image.new('RGBA', (W*4, H), CLEAR)
for i, n in enumerate(order): sheet.paste(frames[n], (i*W, 0))
sheet.save(f'{OUT}/player_sheet.png')

# ---- blink overlays (transparent 26x35 images holding only the changed eye pixels, built from the body's own colours) ----
LID   = body.getpixel((8, 7))     # the light lid colour already used above the eyes
LINE  = body.getpixel((3 + 1, 9)) # a mid skin tone for the closed-eye line
SKIN  = body.getpixel((7, 9))     # plain face skin
EYES  = [range(8, 14), range(16, 22)]

def blink(stage):
    o = Image.new('RGBA', (W, H), CLEAR)
    for xs in EYES:
        for x in xs:
            o.putpixel((x, 9), LID)                      # lid comes down over the top of the eyeball
            if stage == 'closed':
                o.putpixel((x, 10), LINE)                # closed eye = thin line
                o.putpixel((x, 11), SKIN)
    if stage == 'closed':                                # row 11 of the eyeball is only 4 wide; clear the two edge pixels back to nothing
        for x in (8, 13, 16, 21):
            o.putpixel((x, 11), CLEAR)
    return o

blink('half').save(f'{OUT}/blink_half.png')
blink('closed').save(f'{OUT}/blink_closed.png')

# ---- mouth overlays (talking / jumping): the drawn mouth line is covered with skin and replaced by a small dark square ----
SKIN_FACE = body.getpixel((7, 14))   # plain face skin under the mouth
DARK = body.getpixel((11, 9))        # the same near-black as the pupils
MOUTH_LINE = [(12, 15)] + [(x, 16) for x in range(13, 18)]

def mouth(stage):
    o = Image.new('RGBA', (W, H), CLEAR)
    for p in MOUTH_LINE: o.putpixel(p, SKIN_FACE)          # wipe the closed-mouth line
    rows = (15, 16) if stage == 'open' else (16,)          # open = 2x2 square, half = 2x1
    for y in rows:
        for x in (14, 15): o.putpixel((x, y), DARK)
    return o

mouth('half').save(f'{OUT}/mouth_half.png')
mouth('open').save(f'{OUT}/mouth_open.png')

# ---- punch face overlay: angry, focused eyes (slanted lids over the inner top corners), drawn from the body's own shade tone ----
LIDP = body.getpixel((4, 9))   # skin shade used for the lids
def punch_face():
    o = Image.new('RGBA', (W, H), CLEAR)
    for x in range(10, 14): o.putpixel((x, 9), LIDP)           # left eye: lid slopes down toward the nose
    for x in range(12, 14): o.putpixel((x, 10), LIDP)
    for x in range(16, 20): o.putpixel((x, 9), LIDP)           # right eye (mirror)
    for x in range(16, 18): o.putpixel((x, 10), LIDP)
    return o
punch_face().save(f'{OUT}/punch_face.png')
