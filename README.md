# Nubi

A Growtopia / Pixel Worlds-inspired 2D block game that runs in the browser (plain HTML5 canvas + JavaScript, no build step).

## Play

Open `index.html` through any web server, or enable GitHub Pages (Settings → Pages → Deploy from branch → `main` / root) and open the link it gives you.

Quick local server:

```
python3 -m http.server 8000
```

then visit http://localhost:8000

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | A / D or ← / → | ◀ ▶ buttons |
| Jump | W, ↑ or Space | ▲ button |
| Break block | Left click (hold to keep punching) | Tap block in Break mode |
| Place block | Right click | Tap empty space in Place mode |
| Switch break/place mode | Q | ⛏ / ▣ button |
| Select block | 1-6 or mouse wheel | Tap the hotbar |

Blocks take several punches to break (a crack shows your progress), and broken blocks go into your hotbar. Your world, inventory and position are saved in the browser automatically. "New world" resets everything.

## Art

- Everything uses a **32x32** tile size.
- Player frames are in `assets/player/` (`stand`, `walk_l`, `walk_r`, `jump`, each 39x43, plus `player_sheet.png` with all four side by side).
- Block tiles are in `assets/tiles/` (`dirt`, `grass`, `stone`, `wood`, `brick`, `glass`, `bedrock`) and `crack_1-4` overlays. These are placeholders: replace a PNG with your own 32x32 version using the same file name and it shows up in the game.

## Files

- `index.html`, `style.css` - page and UI
- `game.js` - world generation, physics, rendering, input, saving
