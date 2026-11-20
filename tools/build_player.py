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
