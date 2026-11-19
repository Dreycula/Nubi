(() => {
  'use strict';

  // ---------- Config ----------
  const TILE = 32;          // block size in pixels
  // Zoom = on-screen pixel scale. Whole numbers only, so the pixel art stays crisp. Mouse wheel changes it.
  const ZOOM_LEVELS = [1, 2, 3, 4];
  const ZOOM_KEY = 'nubi-zoom';
  let SCALE = 2;
  try {
    const z = parseInt(localStorage.getItem(ZOOM_KEY), 10);
    if (ZOOM_LEVELS.includes(z)) SCALE = z;
  } catch (e) { /* ignore */ }
  const WORLD_W = 120;
  const WORLD_H = 80;
  const SAVE_KEY = 'nubi-world-v1';

  // Sprite: 39x43 canvas, visible character is 21x32 starting at (8, 6).
  const SPR_W = 39, SPR_H = 43;
  const PW = 21, PH = 31;           // player hitbox
  const SPR_OFF_X = 8, SPR_OFF_Y = 7;

  const GRAVITY = 0.5, MAX_FALL = 13, JUMP_V = -9.6;
  // Whole/binary-friendly numbers so steady walking moves exactly 3 px every step (no uneven pixel steps).
  const MOVE_SPEED = 3, ACCEL_GROUND = 0.5, ACCEL_AIR = 0.25, FRICTION = 0.6;
  const REACH = 4.5 * TILE;
  const PUNCH_DELAY = 170;          // ms between punches while holding

  // id -> block info. Swap the PNGs in assets/tiles/ to change the look.
  const BLOCKS = {
    1: { name: 'Dirt',    img: 'dirt',    hits: 3 },
    2: { name: 'Grass',   img: 'grass',   hits: 3 },
    3: { name: 'Stone',   img: 'stone',   hits: 5 },
    4: { name: 'Wood',    img: 'wood',    hits: 4 },
    5: { name: 'Brick',   img: 'brick',   hits: 6 },
    6: { name: 'Glass',   img: 'glass',   hits: 2 },
    7: { name: 'Bedrock', img: 'bedrock', hits: Infinity }
  };
  const PLACEABLE = [1, 2, 3, 4, 5, 6];

  // ---------- Assets ----------
  const images = {};
  function loadImage(key, src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { images[key] = im; resolve(); };
      im.onerror = () => reject(new Error('Could not load ' + src));
      im.src = src;
    });
  }
  function loadAll() {
    const jobs = [];
    ['stand', 'walk_l', 'walk_r', 'jump'].forEach(n => jobs.push(loadImage('p_' + n, 'assets/player/' + n + '.png')));
    Object.values(BLOCKS).forEach(b => jobs.push(loadImage(b.img, 'assets/tiles/' + b.img + '.png')));
    for (let i = 1; i <= 4; i++) jobs.push(loadImage('crack' + i, 'assets/tiles/crack_' + i + '.png'));
    return Promise.all(jobs);
  }

  // ---------- World ----------
  let world = new Uint8Array(WORLD_W * WORLD_H);
  let surf = new Array(WORLD_W).fill(0);
  let spawnX = Math.floor(WORLD_W / 2);

  const idx = (x, y) => y * WORLD_W + x;
  const inBounds = (x, y) => x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H;
  const getTile = (x, y) => (inBounds(x, y) ? world[idx(x, y)] : 0);
  function setTile(x, y, v) { if (inBounds(x, y)) world[idx(x, y)] = v; }

  function generate() {
    const w = new Uint8Array(WORLD_W * WORLD_H);
    const s = [];
    const base = 26;
    for (let x = 0; x < WORLD_W; x++) {
      s[x] = base + Math.round(
        3 * Math.sin(x * 0.11) + 2 * Math.sin(x * 0.037 + 1.3) + 1.5 * Math.sin(x * 0.23 + 0.7)
      );
    }
    // flat area for spawn + a little house
    const sx = Math.floor(WORLD_W / 2);
    const flat = s[sx];
    for (let x = sx - 3; x <= sx + 10; x++) s[x] = flat;

    for (let x = 0; x < WORLD_W; x++) {
      for (let y = 0; y < WORLD_H; y++) {
        let t = 0;
        if (y < s[x]) t = 0;
        else if (y === s[x]) t = 2;
        else if (y < s[x] + 5 + ((x * 7) % 3)) t = 1;
        else t = 3;

        // caves
        if (y > s[x] + 8 && y < WORLD_H - 3) {
          const n = Math.sin(x * 0.31) * Math.sin(y * 0.37) + Math.sin(x * 0.13 + y * 0.17);
          if (n > 1.15) t = 0;
        }
        if (y === WORLD_H - 1 || x === 0 || x === WORLD_W - 1) t = 7;
        w[y * WORLD_W + x] = t;
      }
    }

    // little brick house, 7 wide, with a door and a window
    const x0 = sx + 4, top = flat - 5;
    for (let x = x0; x < x0 + 7; x++) w[top * WORLD_W + x] = 5;          // roof
    for (let y = top + 1; y < flat; y++) {
      w[y * WORLD_W + x0] = 5;                                            // left wall
      w[y * WORLD_W + x0 + 6] = 5;                                        // right wall
    }
    w[(flat - 1) * WORLD_W + x0] = 0;                                     // door
    w[(flat - 2) * WORLD_W + x0] = 0;
    w[(flat - 3) * WORLD_W + x0 + 6] = 6;                                 // window

    return { world: w, surf: s, spawnX: sx - 1 };
  }

  // ---------- Save / load ----------
  function encode(arr) {
    let s = '';
    for (let i = 0; i < arr.length; i += 0x2000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x2000));
    return btoa(s);
  }
  function decode(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  let saveTimer = null;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }
  function saveNow() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        w: WORLD_W, h: WORLD_H,
        world: encode(world),
        inv, selected,
        px: player.x, py: player.y
      }));
    } catch (e) { /* storage unavailable: game still works, it just won't persist */ }
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d.w !== WORLD_W || d.h !== WORLD_H) return null;
      const arr = decode(d.world);
      if (arr.length !== WORLD_W * WORLD_H) return null;
      return { world: arr, inv: d.inv, selected: d.selected, px: d.px, py: d.py };
    } catch (e) { return null; }
  }

  // ---------- State ----------
  // px/py = position at the previous physics step, used to interpolate smoothly when drawing
  const player = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, onGround: false, facing: 1, animT: 0, coyote: 0, jumpBuf: 0 };
  let inv = {};
  let selected = 0;           // index into PLACEABLE
  let placeMode = false;      // false = left click breaks, true = left click places
  const hits = new Map();     // "x,y" -> { n, t }

  function freshInventory() {
    const o = {};
    PLACEABLE.forEach(id => { o[id] = 10; });
    return o;
  }

  function newWorld() {
    const g = generate();
    world = g.world; surf = g.surf; spawnX = g.spawnX;
    inv = freshInventory();
    selected = 0;
    hits.clear();
    player.x = spawnX * TILE + 5;
    player.y = (surf[spawnX] - 2) * TILE;
    player.px = player.x; player.py = player.y;
    player.vx = player.vy = 0;
    buildHotbar();
    saveNow();
  }

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let viewW = 0, viewH = 0;
  function resize() {
    viewW = Math.ceil(window.innerWidth / SCALE);
    viewH = Math.ceil(window.innerHeight / SCALE);
    canvas.width = viewW;
    canvas.height = viewH;
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);

  // ---------- Input ----------
  const keys = {};
  const mouse = { x: 0, y: 0, down: false, button: 0, lastPunch: 0 };
  let touchLeft = false, touchRight = false, touchJump = false;

  const KEYMAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump'
  };
  window.addEventListener('keydown', e => {
    const k = KEYMAP[e.key];
    if (k) {
      if (k === 'jump' && !keys.jump) player.jumpBuf = 6;
      keys[k] = true;
      e.preventDefault();
      return;
    }
    if (e.key >= '1' && e.key <= '6') { selectSlot(parseInt(e.key, 10) - 1); }
    if (e.key === 'q' || e.key === 'Q') setMode(!placeMode);
  });
  window.addEventListener('keyup', e => {
    const k = KEYMAP[e.key];
    if (k) keys[k] = false;
  });
  window.addEventListener('blur', () => { keys.left = keys.right = keys.jump = false; mouse.down = false; });

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  }
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    const p = canvasPos(e);
    mouse.x = p.x; mouse.y = p.y; mouse.down = true;
    // right button always places; otherwise follow the current mode
    mouse.button = e.button === 2 ? 'place' : (placeMode ? 'place' : 'break');
    mouse.lastPunch = 0;
    canvas.setPointerCapture(e.pointerId);
    // act right away so quick taps/clicks always register; holding then repeats
    handleMouse(performance.now());
  });
  canvas.addEventListener('pointermove', e => {
    const p = canvasPos(e);
    mouse.x = p.x; mouse.y = p.y;
  });
  const stopPointer = () => { mouse.down = false; };
  canvas.addEventListener('pointerup', stopPointer);
  canvas.addEventListener('pointercancel', stopPointer);
  // Mouse wheel / trackpad pinch = zoom (scroll up zooms in, scroll down zooms out)
  let lastZoom = 0;
  window.addEventListener('wheel', e => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastZoom < 120 || e.deltaY === 0) return;   // one step per wheel notch
    lastZoom = now;
    const i = ZOOM_LEVELS.indexOf(SCALE);
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
    if (ZOOM_LEVELS[next] === SCALE) return;
    SCALE = ZOOM_LEVELS[next];
    try { localStorage.setItem(ZOOM_KEY, String(SCALE)); } catch (_) { /* ignore */ }
    resize();
  }, { passive: false });

  function holdButton(id, setter) {
    const el = document.getElementById(id);
    const on = e => { e.preventDefault(); el.classList.add('down'); setter(true); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
    const off = () => { el.classList.remove('down'); setter(false); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }
  holdButton('btnLeft', v => { touchLeft = v; });
  holdButton('btnRight', v => { touchRight = v; });
  holdButton('btnJump', v => { if (v && !touchJump) player.jumpBuf = 6; touchJump = v; });
  document.getElementById('btnMode').addEventListener('click', () => setMode(!placeMode));
  document.getElementById('newWorld').addEventListener('click', () => {
    if (confirm('Start a new world? Your current one will be replaced.')) newWorld();
  });

  // ---------- Hotbar / mode ----------
  const hotbar = document.getElementById('hotbar');
  function buildHotbar() {
    hotbar.innerHTML = '';
    PLACEABLE.forEach((id, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.i = i;
      slot.title = BLOCKS[id].name;
      slot.innerHTML = '<span class="key">' + (i + 1) + '</span><img alt="" src="assets/tiles/' + BLOCKS[id].img + '.png"><span class="count"></span>';
      slot.addEventListener('click', () => selectSlot(i));
      hotbar.appendChild(slot);
    });
    refreshHotbar();
  }
  function refreshHotbar() {
    [...hotbar.children].forEach((slot, i) => {
      const id = PLACEABLE[i];
      slot.classList.toggle('selected', i === selected);
      slot.classList.toggle('empty', !inv[id]);
      slot.querySelector('.count').textContent = inv[id] || 0;
    });
  }
  function selectSlot(i) {
    if (i < 0 || i >= PLACEABLE.length) return;
    selected = i;
    refreshHotbar();
    saveSoon();
  }
  function setMode(place) {
    placeMode = place;
    document.getElementById('modeLabel').textContent = place ? 'Place' : 'Break';
    document.getElementById('btnMode').textContent = place ? '▣' : '⛏';
  }

  // ---------- Block actions ----------
  function playerCenter() { return { x: player.x + PW / 2, y: player.y + PH / 2 }; }

  function targetTile() {
    const wx = mouse.x + camX, wy = mouse.y + camY;
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    const c = playerCenter();
    const dx = tx * TILE + TILE / 2 - c.x, dy = ty * TILE + TILE / 2 - c.y;
    const inReach = Math.hypot(dx, dy) <= REACH;
    return { tx, ty, inReach };
  }

  function punch(tx, ty) {
    const t = getTile(tx, ty);
    if (!t) return;
    const info = BLOCKS[t];
    if (!info || info.hits === Infinity) return;
    const key = tx + ',' + ty;
    const now = performance.now();
    let h = hits.get(key);
    if (!h || now - h.t > 2000) h = { n: 0, t: now };
    h.n++; h.t = now;
    hits.set(key, h);
    if (h.n >= info.hits) {
      setTile(tx, ty, 0);
      hits.delete(key);
      inv[t] = (inv[t] || 0) + 1;
      refreshHotbar();
      saveSoon();
    }
  }

  function placeBlock(tx, ty) {
    const id = PLACEABLE[selected];
    if (!inBounds(tx, ty) || getTile(tx, ty) !== 0 || !(inv[id] > 0)) return;
    // don't build inside the player
    const bx = tx * TILE, by = ty * TILE;
    if (player.x < bx + TILE && player.x + PW > bx && player.y < by + TILE && player.y + PH > by) return;
    setTile(tx, ty, id);
    inv[id]--;
    refreshHotbar();
    saveSoon();
  }

  function handleMouse(now) {
    if (!mouse.down || now - mouse.lastPunch < PUNCH_DELAY) return;
    const t = targetTile();
    if (!t.inReach) return;
    mouse.lastPunch = now;
    if (mouse.button === 'place') placeBlock(t.tx, t.ty);
    else punch(t.tx, t.ty);
  }

  // ---------- Physics ----------
  const solidAt = (tx, ty) => {
    if (tx < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
    if (ty < 0) return false;
    return world[idx(tx, ty)] !== 0;
  };

  // true when the player's feet sit exactly on the top face of a solid block
  function standingOnSolid(p) {
    const feet = p.y + PH;
    if (feet % TILE !== 0) return false;
    const row = feet / TILE;
    const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + PW - 1) / TILE);
    for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, row)) return true;
    return false;
  }

  function stepPlayer() {
    const left = keys.left || touchLeft;
    const right = keys.right || touchRight;
    const jumpHeld = keys.jump || touchJump;
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    const p = player;
    p.px = p.x; p.py = p.y;

    if (dir !== 0) {
      p.facing = dir;
      const a = p.onGround ? ACCEL_GROUND : ACCEL_AIR;
      p.vx += dir * a;
      if (Math.abs(p.vx) > MOVE_SPEED) p.vx = dir * MOVE_SPEED;
    } else {
      p.vx *= p.onGround ? FRICTION : 0.9;
      if (Math.abs(p.vx) < 0.05) p.vx = 0;
    }

    if (p.onGround) p.coyote = 6; else if (p.coyote > 0) p.coyote--;
    if (p.jumpBuf > 0) p.jumpBuf--;
    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = JUMP_V; p.onGround = false; p.coyote = 0; p.jumpBuf = 0;
    }
    // shorter hop when the jump key is released early
    if (!jumpHeld && p.vy < -3.5) p.vy = -3.5;

    // Standing on the ground: no gravity build-up (that made the player flick between
    // "grounded" and "airborne" every couple of frames, showing the jump pose and a gap).
    if (p.onGround && p.vy >= 0) p.vy = 0;
    else p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);

    // horizontal
    p.x += p.vx;
    let x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + PW - 1) / TILE);
    let y0 = Math.floor(p.y / TILE), y1 = Math.floor((p.y + PH - 1) / TILE);
    let hit = false;
    for (let ty = y0; ty <= y1 && !hit; ty++) {
      for (let tx = x0; tx <= x1; tx++) { if (solidAt(tx, ty)) { hit = true; break; } }
    }
    if (hit) {
      if (p.vx > 0) p.x = x1 * TILE - PW;
      else if (p.vx < 0) p.x = (x0 + 1) * TILE;
      p.vx = 0;
    }

    // vertical
    p.onGround = false;
    p.y += p.vy;
    x0 = Math.floor(p.x / TILE); x1 = Math.floor((p.x + PW - 1) / TILE);
    y0 = Math.floor(p.y / TILE); y1 = Math.floor((p.y + PH - 1) / TILE);
    hit = false;
    for (let ty = y0; ty <= y1 && !hit; ty++) {
      for (let tx = x0; tx <= x1; tx++) { if (solidAt(tx, ty)) { hit = true; break; } }
    }
    if (hit) {
      if (p.vy > 0) { p.y = y1 * TILE - PH; p.onGround = true; }
      else if (p.vy < 0) { p.y = (y0 + 1) * TILE; }
      p.vy = 0;
    }
    // resting exactly on top of a solid block counts as grounded even when nothing was "hit" this step
    if (!p.onGround && p.vy >= 0 && standingOnSolid(p)) { p.onGround = true; p.vy = 0; }

    // walk animation clock
    if (p.onGround && Math.abs(p.vx) > 0.3) p.animT += 0.16 * (Math.abs(p.vx) / MOVE_SPEED * 0.75 + 0.25);
    else if (p.onGround) p.animT = 0;
  }

  // ---------- Rendering ----------
  let camX = 0, camY = 0;
  const WALK_SEQ = ['p_walk_l', 'p_stand', 'p_walk_r', 'p_stand'];

  // Where the player is drawn this frame: whole pixels, interpolated between physics steps.
  let drawX = 0, drawY = 0;
  function updateRenderPos(alpha) {
    drawX = Math.round(player.px + (player.x - player.px) * alpha);
    drawY = Math.round(player.py + (player.y - player.py) * alpha);
  }

  function updateCamera() {
    const worldPxW = WORLD_W * TILE, worldPxH = WORLD_H * TILE;
    // Camera offset is built from the SAME rounded position the sprite uses, plus a whole-number
    // constant, so the character stays locked to one screen spot and the world scrolls under it.
    const cx = drawX + Math.round(PW / 2 - viewW / 2);
    const cy = drawY + Math.round(PH / 2 - viewH / 2);
    camX = worldPxW <= viewW ? Math.round((worldPxW - viewW) / 2) : Math.max(0, Math.min(worldPxW - viewW, cx));
    camY = worldPxH <= viewH ? Math.round((worldPxH - viewH) / 2) : Math.max(0, Math.min(worldPxH - viewH, cy));
  }

  const CLOUDS = [[40, 40, 5], [200, 70, 4], [380, 30, 6], [560, 80, 4], [740, 50, 5], [920, 36, 6], [1100, 74, 4]];
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, '#6fc0fb');
    g.addColorStop(1, '#d6f0ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    const span = viewW + 400;
    CLOUDS.forEach(([cx, cy, u]) => {
      let x = ((cx - camX * 0.25) % span + span) % span - 200;
      const y = cy - camY * 0.1;
      const s = u * 4;
      ctx.fillRect(Math.round(x), Math.round(y), s * 4, s);
      ctx.fillRect(Math.round(x + s), Math.round(y - s), s * 2, s);
      ctx.fillRect(Math.round(x + s * 3), Math.round(y - s * 0.5), s * 2, s * 1.5);
    });
  }

  function drawWorld(now) {
    const tx0 = Math.max(0, Math.floor(camX / TILE));
    const ty0 = Math.max(0, Math.floor(camY / TILE));
    const tx1 = Math.min(WORLD_W - 1, Math.floor((camX + viewW) / TILE));
    const ty1 = Math.min(WORLD_H - 1, Math.floor((camY + viewH) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = world[idx(tx, ty)];
        const sx = tx * TILE - camX, sy = ty * TILE - camY;
        if (t === 0) {
          if (ty > surf[tx] + 1) {              // dark back wall underground
            ctx.fillStyle = ((tx + ty) & 1) ? '#2a3350' : '#2d3654';
            ctx.fillRect(sx, sy, TILE, TILE);
          }
          continue;
        }
        if (t === 6 && ty > surf[tx]) { ctx.fillStyle = '#2a3350'; ctx.fillRect(sx, sy, TILE, TILE); }
        ctx.drawImage(images[BLOCKS[t].img], sx, sy);
      }
    }
    // crack overlays
    hits.forEach((h, key) => {
      if (now - h.t > 2000) { hits.delete(key); return; }
      const [x, y] = key.split(',').map(Number);
      const t = getTile(x, y);
      if (!t) return;
      const stage = Math.min(4, Math.max(1, Math.ceil((h.n / BLOCKS[t].hits) * 4)));
      ctx.drawImage(images['crack' + stage], x * TILE - camX, y * TILE - camY);
    });
  }

  function currentFrame() {
    const p = player;
    if (!p.onGround) return images.p_jump;
    if (Math.abs(p.vx) > 0.3) return images[WALK_SEQ[Math.floor(p.animT) % 4]];
    return images.p_stand;
  }

  function drawPlayer() {
    const img = currentFrame();
    const px = drawX - camX;
    const py = drawY - camY;
    if (player.facing >= 0) {
      ctx.drawImage(img, px - SPR_OFF_X, py - SPR_OFF_Y);
    } else {
      ctx.save();
      ctx.translate(px + 29, py - SPR_OFF_Y);   // mirror around the hitbox
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
  }

  function drawCursor() {
    const t = targetTile();
    const sx = t.tx * TILE - camX, sy = t.ty * TILE - camY;
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.inReach ? 'rgba(255,255,255,.9)' : 'rgba(255,90,90,.6)';
    ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
  }

  function render(now, alpha) {
    updateRenderPos(alpha);
    updateCamera();
    drawSky();
    drawWorld(now);
    drawPlayer();
    drawCursor();
  }

  // ---------- Main loop ----------
  let last = 0, acc = 0;
  const STEP = 1000 / 60;
  function frame(now) {
    if (!last) last = now;
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= STEP) { stepPlayer(); acc -= STEP; }
    handleMouse(now);
    render(now, acc / STEP);
    requestAnimationFrame(frame);
  }

  window.addEventListener('beforeunload', saveNow);
  setInterval(() => { if (document.visibilityState === 'visible') saveNow(); }, 15000);

  // ---------- Start ----------
  resize();
  loadAll().then(() => {
    const g = generate();
    surf = g.surf; spawnX = g.spawnX;
    const s = loadSave();
    if (s) {
      world = s.world;
      inv = Object.assign(freshInventory(), s.inv || {});
      selected = Math.max(0, Math.min(PLACEABLE.length - 1, s.selected | 0));
      player.x = s.px; player.y = s.py;
      if (!isFinite(player.x) || !isFinite(player.y)) { player.x = spawnX * TILE + 5; player.y = (surf[spawnX] - 2) * TILE; }
      player.px = player.x; player.py = player.y;
      buildHotbar();
    } else {
      newWorld();
    }
    document.getElementById('loading').remove();
    requestAnimationFrame(frame);
  }).catch(err => {
    document.getElementById('loading').textContent = 'Could not load game files: ' + err.message;
  });
})();
