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
  let SAVE_KEY = null;      // set after login: each account has its own saved world (see auth.js)
  let playerName = '';      // the logged-in username, drawn above the character

  // ---- country flag on the name tag: detected automatically ----
  // 1) a quick guess from the browser's time zone / language (instant, works offline),
  // 2) then the real country from the visitor's IP (api.country.is), cached in the browser.
  // The flag picture comes from flagcdn.com; if it can't load, a small country-code badge is drawn instead.
  const TZ_COUNTRY = {
    'Asia/Shanghai': 'CN', 'Asia/Urumqi': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Taipei': 'TW',
    'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Jakarta': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID',
    'Asia/Pontianak': 'ID', 'Asia/Manila': 'PH', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY',
    'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
    'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Tehran': 'IR',
    'Asia/Jerusalem': 'IL', 'Europe/Istanbul': 'TR', 'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR',
    'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
    'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK',
    'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Lisbon': 'PT', 'Europe/Athens': 'GR',
    'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Moscow': 'RU', 'Europe/Bucharest': 'RO', 'Europe/Budapest': 'HU',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
    'America/Phoenix': 'US', 'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Toronto': 'CA',
    'America/Vancouver': 'CA', 'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR',
    'America/Bogota': 'CO', 'America/Santiago': 'CL', 'America/Lima': 'PE', 'Africa/Cairo': 'EG', 'Africa/Lagos': 'NG',
    'Africa/Johannesburg': 'ZA', 'Africa/Nairobi': 'KE', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU',
    'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Pacific/Auckland': 'NZ'
  };
  const flagImgs = {};
  let countryCode = null;
  function guessCountry() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
    } catch (e) {}
    const m = /[-_]([A-Za-z]{2})\b/.exec(navigator.language || '');
    return m ? m[1].toUpperCase() : null;
  }
  function setCountry(c) {
    if (c && /^[A-Z]{2}$/.test(c)) countryCode = c;
  }
  function detectCountry() {
    let cached = null;
    try { cached = localStorage.getItem('nubi-country'); } catch (e) {}
    setCountry(cached || guessCountry());
    if (cached) return;
    try {
      fetch('https://api.country.is/', { cache: 'no-store' })
        .then(r => r.json())
        .then(j => { setCountry(j && j.country); try { if (j && j.country) localStorage.setItem('nubi-country', j.country); } catch (e) {} })
        .catch(() => {});
    } catch (e) {}
  }
  function flagImage(code) {
    if (!code) return null;
    let f = flagImgs[code];
    if (!f) {
      f = flagImgs[code] = { img: new Image(), ok: false, bad: false };
      f.img.onload = () => { f.ok = true; };
      f.img.onerror = () => { f.bad = true; };
      f.img.src = 'https://flagcdn.com/w80/' + code.toLowerCase() + '.png';
    }
    return f;
  }

  // Sprite: 26x35 canvas, visible character is 20x32 starting at (3, 3). Feet sit on the bottom edge of the hitbox.
  const SPR_W = 26, SPR_H = 35;
  const PW = 20, PH = 32;           // player hitbox
  const SPR_OFF_X = 3, SPR_OFF_Y = 3;
  // Arms: the 5x10 arm sprite is drawn on top of the body and rotated about its shoulder (top centre).
  const ARM_LEFT_X = 3, ARM_RIGHT_X = 18, ARM_Y = 19;   // where each arm hangs on the 26x35 body
  const ARM_PIVOT_X = 2.5, ARM_PIVOT_Y = 1.5;           // shoulder point inside the arm sprite
  const ARM_SWING = 28, ARM_JUMP = 38;                  // max walking swing / jump spread, in degrees

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
    jobs.push(loadImage('p_arm', 'assets/player/parts/arm.png'));
    jobs.push(loadImage('p_blink_half', 'assets/player/blink_half.png'));
    jobs.push(loadImage('p_blink_closed', 'assets/player/blink_closed.png'));
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
    if (!SAVE_KEY) return;                    // not logged in yet: nothing to save
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
    if (!SAVE_KEY) return null;
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
  const player = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, onGround: false, facing: 1, animT: 0, armL: 0, armR: 0, coyote: 0, jumpBuf: 0 };
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
    // The canvas has one real pixel per screen pixel. All game drawing happens in "game pixels"
    // (1 game pixel = SCALE screen pixels, set with setTransform every frame), so the world stays
    // crisp, and rotated pieces like the arms are drawn at screen resolution instead of jagged.
    canvas.width = viewW * SCALE;
    canvas.height = viewH * SCALE;
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
  // Ignore game keys while the login screen is open or while typing in any text box.
  const typing = e => document.body.classList.contains('auth-open') || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
  window.addEventListener('keydown', e => {
    if (typing(e)) return;
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
    if (k) keys[k] = false;      // always release, even if a text box has focus now
  });
  window.addEventListener('blur', () => { keys.left = keys.right = keys.jump = false; mouse.down = false; });

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (viewW / r.width), y: (e.clientY - r.top) * (viewH / r.height) };
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
    if (document.body.classList.contains('auth-open')) return;   // let the login card scroll normally
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

    // Arm "bones": angle in degrees about the shoulder, positive = hand swings toward the character's left.
    // Walking: a smooth pendulum swing locked to the leg steps. Jumping: both arms spread out. Idle: hang straight.
    let tl = 0, tr = 0;
    if (!p.onGround) { tl = ARM_JUMP; tr = -ARM_JUMP; }
    else if (Math.abs(p.vx) > 0.3) {
      // the two arms swing in opposite directions: hands move apart, then back together
      const s = ARM_SWING * Math.cos(p.animT * Math.PI / 2);
      tl = s; tr = -s;
    }
    p.armL += (tl - p.armL) * 0.35;
    p.armR += (tr - p.armR) * 0.35;
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

  // Blinking: every few seconds the eyes go half-closed, closed, half-closed (~190 ms). Sometimes it's a quick double blink.
  let blinkStart = null, nextBlink = 0, blinkAgain = false;
  function blinkOverlay(now) {
    if (!nextBlink) nextBlink = now + 1500 + Math.random() * 1500;      // first blink comes soon after load
    if (blinkStart === null) {
      if (now < nextBlink) return null;
      blinkStart = now;
    }
    const t = now - blinkStart;
    if (t < 55) return images.p_blink_half;
    if (t < 135) return images.p_blink_closed;
    if (t < 190) return images.p_blink_half;
    blinkStart = null;
    if (!blinkAgain && Math.random() < 0.18) { blinkAgain = true; nextBlink = now + 110; }   // double blink
    else { blinkAgain = false; nextBlink = now + 2200 + Math.random() * 3300; }
    return null;
  }

  function drawPlayer(now) {
    const img = currentFrame();
    const px = drawX - camX;
    const py = drawY - camY;
    ctx.save();
    if (player.facing >= 0) {
      ctx.translate(px - SPR_OFF_X, py - SPR_OFF_Y);
    } else {
      // mirror: the character is centred in its frame, so it stays over the hitbox
      ctx.translate(px - SPR_OFF_X + SPR_W, py - SPR_OFF_Y);
      ctx.scale(-1, 1);
    }
    const drawArm = (ax, deg) => {
      ctx.save();
      ctx.translate(ax + ARM_PIVOT_X, ARM_Y + ARM_PIVOT_Y);
      ctx.rotate(deg * Math.PI / 180);
      ctx.drawImage(images.p_arm, -ARM_PIVOT_X, -ARM_PIVOT_Y);   // the untouched arm sprite
      ctx.restore();
    };
    drawArm(ARM_RIGHT_X, player.armR);              // far arm: behind the body, only sticks out past its edge
    ctx.drawImage(img, 0, 0);                       // body (legs animated), no arms
    const lids = blinkOverlay(now);
    if (lids) ctx.drawImage(lids, 0, 0);            // eyes closing, drawn over the face only
    drawArm(ARM_LEFT_X, player.armL);               // near arm: in front of the body
    ctx.restore();
  }

  // The logged-in username floats above the character's head. Drawn in screen pixels (not scaled game pixels)
  // so the text stays sharp at every zoom level; the size grows a little with the zoom.
  let nameTopY = 0;         // screen y of the top of the name tag (the chat bubble sits above it)
  function drawName() {
    if (!playerName) return;
    const size = Math.max(11, 4 * SCALE + 3);
    const cx = Math.round((drawX + PW / 2 - camX) * SCALE);
    const mid = Math.round((drawY - camY - 2) * SCALE) - Math.round(size * 0.8);   // just above the top of the head
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = 'bold ' + size + 'px "Trebuchet MS", Verdana, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const flagW = countryCode ? Math.round(size * 1.1) : 0, flagH = Math.round(size * 0.75);
    const gap = countryCode ? Math.round(size * 0.4) : 0;
    const tw = Math.ceil(ctx.measureText(playerName).width);
    const x = Math.round(cx - (flagW + gap + tw) / 2);
    nameTopY = mid - Math.round(size * 0.8);
    const fl = flagImage(countryCode);
    const fy = Math.round(mid - flagH / 2);
    if (fl && fl.ok) {
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = 'rgba(10,14,30,.85)';
      ctx.fillRect(x - 1, fy - 1, flagW + 2, flagH + 2);        // thin dark edge so the flag reads on any sky
      ctx.drawImage(fl.img, x, fy, flagW, flagH);
    } else if (countryCode) {                                    // fallback: small country-code badge
      ctx.fillStyle = 'rgba(10,14,30,.7)';
      ctx.fillRect(x, fy, flagW, flagH);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.round(size * 0.55) + 'px "Trebuchet MS", Verdana, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(countryCode, x + flagW / 2, mid + 1);
      ctx.font = 'bold ' + size + 'px "Trebuchet MS", Verdana, sans-serif';
      ctx.textAlign = 'left';
    }
    const tx = x + flagW + gap;
    ctx.lineWidth = Math.max(3, Math.round(size / 4));
    ctx.strokeStyle = 'rgba(10, 14, 30, .85)';
    ctx.strokeText(playerName, tx, mid + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(playerName, tx, mid + 1);
    ctx.restore();
  }

  // ---------- Chat: log box + speech bubble over the head ----------
  // Chat is local for now (there is no server yet). Once multiplayer exists, messages from other players go
  // through addChat() the same way.
  const chatEl = document.getElementById('chat');
  const chatLog = document.getElementById('chatLog');
  const chatInput = document.getElementById('chatInput');
  const BUBBLE_MS = 6000;
  let bubble = null;        // { text, t }
  function addChat(name, text) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const who = document.createElement('b');
    who.textContent = name + ': ';
    line.appendChild(who);
    line.appendChild(document.createTextNode(text));
    chatLog.appendChild(line);
    while (chatLog.children.length > 60) chatLog.removeChild(chatLog.firstChild);
    chatLog.scrollTop = chatLog.scrollHeight;
    line.dataset.t = String(performance.now());
    chatEl.classList.add('recent');
    clearTimeout(addChat.timer);
    addChat.timer = setTimeout(() => { if (document.activeElement !== chatInput) chatEl.classList.remove('recent'); }, 12000);
  }
  function openChat() {
    keys.left = keys.right = keys.jump = false;
    chatEl.classList.add('open');
    chatInput.focus();
  }
  function closeChat() {
    chatInput.blur();
    chatEl.classList.remove('open');
  }
  chatInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { chatInput.value = ''; closeChat(); }
    else if (e.key === 'Enter') {
      const text = chatInput.value.trim().replace(/\s+/g, ' ');
      chatInput.value = '';
      if (text) { addChat(playerName, text); bubble = { text, t: performance.now() }; }
      closeChat();
    }
  });
  chatInput.addEventListener('blur', () => chatEl.classList.remove('open'));
  window.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !typing(e) && playerName) { e.preventDefault(); openChat(); }
  });
  canvas.addEventListener('pointerdown', () => { if (document.activeElement === chatInput) closeChat(); });
  const chatBtn = document.getElementById('btnChat');
  if (chatBtn) chatBtn.addEventListener('click', () => { if (chatEl.classList.contains('open')) closeChat(); else openChat(); });

  function drawBubble(now) {
    if (!bubble) return;
    const age = now - bubble.t;
    if (age > BUBBLE_MS) { bubble = null; return; }
    const size = Math.max(11, 4 * SCALE + 3);
    const cx = Math.round((drawX + PW / 2 - camX) * SCALE);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = '600 ' + size + 'px "Trebuchet MS", Verdana, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // word wrap to a fixed width
    const maxW = Math.round(size * 13), lines = [];
    let cur = '';
    for (const word of bubble.text.split(' ')) {
      let w = word;
      while (ctx.measureText(w).width > maxW) {                  // a single very long word: split it
        let i = w.length - 1;
        while (i > 1 && ctx.measureText(w.slice(0, i)).width > maxW) i--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, i)); w = w.slice(i);
      }
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur);
    const lh = Math.round(size * 1.3), padX = Math.round(size * 0.7), padY = Math.round(size * 0.5);
    const tw = Math.max(...lines.map(l => Math.ceil(ctx.measureText(l).width)));
    const w = tw + padX * 2, h = lines.length * lh + padY * 2;
    const tail = Math.round(size * 0.5);
    const bottom = (nameTopY || Math.round((drawY - camY - 2) * SCALE)) - Math.round(size * 0.35) - tail;
    const x = Math.round(cx - w / 2), y = bottom - h;
    ctx.globalAlpha = age > BUBBLE_MS - 500 ? Math.max(0, (BUBBLE_MS - age) / 500) : 1;   // fade out at the end
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(10, 14, 30, .85)';
    ctx.lineWidth = Math.max(2, Math.round(SCALE * 0.8));
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.round(size * 0.6)); else ctx.rect(x, y, w, h);
    ctx.moveTo(cx - tail, bottom); ctx.lineTo(cx, bottom + tail); ctx.lineTo(cx + tail, bottom);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';                                       // hide the outline where the tail joins the box
    ctx.fillRect(cx - tail + 1, bottom - 1, tail * 2 - 1, ctx.lineWidth + 1);
    ctx.fillStyle = '#16192b';
    lines.forEach((l, i) => ctx.fillText(l, x + padX, y + padY + lh * i + lh / 2));
    ctx.restore();
  }

  function drawCursor() {
    const t = targetTile();
    const sx = t.tx * TILE - camX, sy = t.ty * TILE - camY;
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.inReach ? 'rgba(255,255,255,.9)' : 'rgba(255,90,90,.6)';
    ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
  }

  function render(now, alpha) {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    updateRenderPos(alpha);
    updateCamera();
    drawSky();
    drawWorld(now);
    drawPlayer(now);
    drawName();
    drawBubble(now);
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
  document.getElementById('logout').addEventListener('click', () => {
    saveNow();
    if (window.nubiAuth) window.nubiAuth.logout(); else location.reload();
  });

  resize();
  // Wait for both the art and the login (auth.js resolves straight away if this browser is already signed in).
  const loggedIn = window.nubiAuth ? window.nubiAuth.whenLoggedIn() : Promise.resolve({ name: 'Guest', saveKey: 'nubi-world-v1' });
  Promise.all([loadAll(), loggedIn]).then(([, account]) => {
    SAVE_KEY = account.saveKey;
    playerName = account.name;
    detectCountry();
    document.getElementById('who').textContent = account.name;
    const g = generate();
    surf = g.surf; spawnX = g.spawnX;
    const s = loadSave();
    if (s) {
      world = s.world;
      inv = Object.assign(freshInventory(), s.inv || {});
      selected = Math.max(0, Math.min(PLACEABLE.length - 1, s.selected | 0));
      player.x = s.px; player.y = s.py - 4;   // the hitbox got 1px taller; start just above where you saved so you can't spawn inside a block
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
