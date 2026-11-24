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
  const SPR_W = 26, SPR_H = 38;
  const PW = 14, PH = 26;           // player hitbox (smaller than a tile so you can slip through 1-block gaps)
  const SPR_OFF_X = 6, SPR_OFF_Y = 12;   // hitbox sits on the feet; sprite is centred on it and the head sticks up above
  const HEAD_TOP_ROW = 3;              // first row of the head in the sprite (the name tag and bubbles sit above it)
  // Arms: the 5x10 arm sprite is drawn on top of the body and rotated about its shoulder (top centre).
  const ARM_LEFT_X = 2, ARM_RIGHT_X = 18, ARM_Y = 22;   // where each arm hangs on the 26x38 body
  const ARM_PIVOT_X = 3, ARM_PIVOT_Y = 1.5;           // shoulder point inside the arm sprite
  const ARM_SWING = 28, ARM_JUMP = 38;                  // max walking swing / jump spread, in degrees

  const GRAVITY = 0.5, MAX_FALL = 13, JUMP_V = -9.6;
  // Whole/binary-friendly numbers so steady walking moves exactly 3 px every step (no uneven pixel steps).
  const MOVE_SPEED = 3, ACCEL_GROUND = 0.5, ACCEL_AIR = 0.25, FRICTION = 0.6;
  const REACH_TILES = 2;      // normal reach: 2 tiles in every direction from the tile you stand on = a 5x5 grid
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
    jobs.push(loadImage('p_arm_near', 'assets/player/parts/arm_near.png'));
    jobs.push(loadImage('p_arm_far', 'assets/player/parts/arm_far.png'));
    jobs.push(loadImage('p_blink_half', 'assets/player/blink_half.png'));
    jobs.push(loadImage('p_blink_closed', 'assets/player/blink_closed.png'));
    jobs.push(loadImage('p_punch_arm', 'assets/player/punch_arm.png'));
    jobs.push(loadImage('p_punch_face', 'assets/player/punch_face.png'));
    jobs.push(loadImage('p_mouth_half', 'assets/player/mouth_half.png'));
    jobs.push(loadImage('p_mouth_open', 'assets/player/mouth_open.png'));
    Object.values(BLOCKS).forEach(b => jobs.push(loadImage(b.img, 'assets/tiles/' + b.img + '.png')));
    jobs.push(loadImage('ui_fist', 'assets/ui/fist.png'));
    jobs.push(loadImage('ui_wrench', 'assets/ui/wrench.png'));
    for (let i = 1; i <= 4; i++) jobs.push(loadImage('crack' + i, 'assets/tiles/crack_' + i + '.png'));
    return Promise.all(jobs);
  }

  // ---------- Connected blocks ----------
  // Tiles have a 1px bevel (light top/left edge, dark bottom/right edge). Where a block touches another block of the
  // same kind, that edge is replaced with the pixels just inside it, so the two blocks join into one surface with no
  // line between them. Variants are built once per (block, touching sides) and cached. Dirt and grass count as the
  // same kind. Works with any 32x32 art that has a 1px edge; set EDGE if your art uses a thicker one.
  const EDGE = 1;
  const JOIN = { 2: 1 };                                   // grass joins with dirt
  const joinKind = t => JOIN[t] || t;
  const tileVariants = {};
  function tileVariant(t, mask) {
    const key = t + ':' + mask;
    let c = tileVariants[key];
    if (c) return c;
    const src = images[BLOCKS[t].img];
    c = document.createElement('canvas');
    c.width = c.height = TILE;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0);
    const copy = (sx, sy, sw, sh, dx, dy, dw, dh) => {      // replace a strip with a stretched copy of its neighbour
      g.clearRect(dx, dy, dw, dh);
      g.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    };
    const E = EDGE, M = TILE - EDGE;
    if (mask & 1) copy(0, E, TILE, 1, 0, 0, TILE, E);                // top
    if (mask & 4) copy(0, M - 1, TILE, 1, 0, M, TILE, E);            // bottom
    if (mask & 8) copy(E, 0, 1, TILE, 0, 0, E, TILE);                // left
    if (mask & 2) copy(M - 1, 0, 1, TILE, M, 0, E, TILE);            // right
    // rounded outer corners (like the reference tileset): where two exposed sides meet, shave the corner pixels
    const shave = (x, y) => g.clearRect(x, y, 1, 1);
    if (!(mask & 9)) { shave(0, 0); shave(1, 0); shave(0, 1); }                          // top-left
    if (!(mask & 3)) { shave(M, 0); shave(M - 1, 0); shave(M, 1); }                      // top-right
    if (!(mask & 12)) { shave(0, M); shave(1, M); shave(0, M - 1); }                     // bottom-left
    if (!(mask & 6)) { shave(M, M); shave(M - 1, M); shave(M, M - 1); }                  // bottom-right
    return (tileVariants[key] = c);
  }
  function tileMask(tx, ty, t) {
    const k = joinKind(t);
    return (joinKind(getTile(tx, ty - 1)) === k && getTile(tx, ty - 1) ? 1 : 0)
         | (joinKind(getTile(tx + 1, ty)) === k && getTile(tx + 1, ty) ? 2 : 0)
         | (joinKind(getTile(tx, ty + 1)) === k && getTile(tx, ty + 1) ? 4 : 0)
         | (joinKind(getTile(tx - 1, ty)) === k && getTile(tx - 1, ty) ? 8 : 0);
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
        inv, selected, tool: toolKind, drops: drops.map(d => ({ x: d.x, y: d.y, id: d.id, n: d.n })),
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
      return { world: arr, inv: d.inv, selected: d.selected, tool: d.tool, drops: d.drops, px: d.px, py: d.py };
    } catch (e) { return null; }
  }

  // ---------- State ----------
  // px/py = position at the previous physics step, used to interpolate smoothly when drawing
  const player = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, onGround: false, facing: 1, animT: 0, armL: 0, armR: 0, coyote: 0, jumpBuf: 0 };
  let inv = {};
  let drops = [];             // items lying in the world: { x, y, vy, id, n, t } (t = time dropped, for the pickup delay)
  let selected = 0;           // index into PLACEABLE
  let placeMode = false;      // true while a block is in hand (left click places); false while the fist / wrench is in hand
  let toolKind = 'fist';      // what the first hotbar slot holds: 'fist' (punch blocks) or 'wrench' (double-click the slot to swap)
  let holding = 'fist';       // 'fist' | 'wrench' | 'block'
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
    toolKind = 'fist'; holding = 'fist'; placeMode = false;
    drops = [];
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
    if (e.key === '1') { if (holding !== 'block') toggleTool(); else selectTool(); }
    else if (e.key >= '2' && e.key <= '7') { selectSlot(parseInt(e.key, 10) - 2); }
    if (e.key === 'q' || e.key === 'Q') setMode(!placeMode);
    if (e.key === 'i' || e.key === 'I') toggleInventory();
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
    mouse.button = e.button === 2 ? 'place' : (placeMode ? 'place' : holding === 'wrench' ? 'wrench' : 'break');
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
    if (e.target.closest && e.target.closest('#invPanel')) return;   // let the inventory grid scroll
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
    // first slot: the fist / wrench. It is always there and can't be replaced. Click = hold it, double-click = swap fist <-> wrench.
    const tool = document.createElement('div');
    tool.className = 'slot tool';
    tool.innerHTML = '<span class="key">1</span><img alt="" src="assets/ui/fist.png">';
    tool.addEventListener('click', () => {
      const now = performance.now();
      if (now - lastToolClick < 350) { toggleTool(); lastToolClick = 0; } else { selectTool(); lastToolClick = now; }
    });
    hotbar.appendChild(tool);
    PLACEABLE.forEach((id, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.i = i;
      slot.title = BLOCKS[id].name;
      slot.innerHTML = '<span class="key">' + (i + 2) + '</span><img alt="" src="assets/tiles/' + BLOCKS[id].img + '.png"><span class="count"></span>';
      slot.addEventListener('click', () => selectSlot(i));
      hotbar.appendChild(slot);
    });
    refreshHotbar();
  }
  let lastToolClick = 0;
  function refreshHotbar() {
    const kids = [...hotbar.children];
    if (!kids.length) return;
    const tool = kids[0];
    tool.classList.toggle('selected', holding !== 'block');
    tool.title = toolKind === 'fist' ? 'Fist (double-click for the wrench)' : 'Wrench (double-click for the fist)';
    tool.querySelector('img').src = 'assets/ui/' + toolKind + '.png';
    kids.slice(1).forEach((slot, i) => {
      const id = PLACEABLE[i];
      slot.classList.toggle('selected', holding === 'block' && i === selected);
      slot.classList.toggle('empty', !inv[id]);
      slot.querySelector('.count').textContent = inv[id] || 0;
    });
    if (typeof refreshInventory === 'function') refreshInventory();
  }
  function applyHolding(h) {
    holding = h;
    placeMode = h === 'block';
    document.getElementById('modeLabel').textContent = h === 'block' ? 'Place' : h === 'wrench' ? 'Wrench' : 'Fist';
    document.getElementById('btnMode').textContent = h === 'block' ? '▣' : h === 'wrench' ? '🔧' : '👊';
    refreshHotbar();
    saveSoon();
  }
  function selectTool() { applyHolding(toolKind); }
  function toggleTool() { toolKind = toolKind === 'fist' ? 'wrench' : 'fist'; applyHolding(toolKind); }
  function selectSlot(i) {
    if (i < 0 || i >= PLACEABLE.length) return;
    selected = i;
    showReach();
    applyHolding('block');
  }
  let reachUntil = 0;         // the reach outline is shown until this time (and while the inventory is open)
  function showReach() { reachUntil = performance.now() + 3000; }
  function setMode(place) { applyHolding(place ? 'block' : toolKind); }

  // ---------- Block actions ----------
  function playerCenter() { return { x: player.x + PW / 2, y: player.y + PH / 2 }; }

  // the tile the player is standing on (centre of the body); reach is a square of REACH_TILES around it
  function tileInReach(tx, ty) {
    const c = playerCenter();
    return Math.abs(tx - Math.floor(c.x / TILE)) <= REACH_TILES && Math.abs(ty - Math.floor(c.y / TILE)) <= REACH_TILES;
  }

  function targetTile() {
    const wx = mouse.x + camX, wy = mouse.y + camY;
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    const inReach = tileInReach(tx, ty);
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

  // Punch / place animation: the arm reaches out to the block, with an angry-focused face. The arm is built from the
  // untouched arm sprite (shoulder rows, the middle row repeated, hand rows), never stretched, so its pixels stay exactly yours.
  const PUNCH_MS = 180;
  const punchAnim = { t: -1e9, tx: 0, ty: 0 };
  function startPunch(now, tx, ty) {
    punchAnim.t = now; punchAnim.tx = tx; punchAnim.ty = ty;
    const c = playerCenter(), dx = tx * TILE + TILE / 2 - c.x;
    if (Math.abs(dx) > 3) player.facing = dx > 0 ? 1 : -1;          // turn to face the block
  }

  // The wrench is for editing blocks later (doors, signs, locks...). For now it just tells you what you clicked.
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }
  function wrenchTile(tx, ty) {
    const t = getTile(tx, ty);
    toast(t ? BLOCKS[t].name + ': nothing to edit yet' : 'Nothing here');
  }

  function handleMouse(now) {
    if (!mouse.down || now - mouse.lastPunch < PUNCH_DELAY) return;
    const t = targetTile();
    if (!t.inReach) return;
    mouse.lastPunch = now;
    startPunch(now, t.tx, t.ty);
    if (mouse.button === 'place') placeBlock(t.tx, t.ty);
    else if (mouse.button === 'wrench') wrenchTile(t.tx, t.ty);
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
        ctx.drawImage(tileVariant(t, tileMask(tx, ty, t)), sx, sy);
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

  // Mouth: opens wide while in the air, and flaps while a chat message is showing (longer message = talks longer).
  const TALK_PATTERN = [2, 1, 2, 0, 1, 2, 2, 0, 1, 0, 2, 1];      // 0 closed, 1 half, 2 open
  function mouthOverlay(now) {
    if (!player.onGround) return images.p_mouth_open;
    if (bubble && !chatEl.classList.contains('open')) {
      const talkMs = Math.min(3500, Math.max(900, bubble.text.length * 70));
      const age = now - bubble.t;
      if (age < talkMs) {
        const v = TALK_PATTERN[Math.floor(age / 105) % TALK_PATTERN.length];
        return v === 2 ? images.p_mouth_open : v === 1 ? images.p_mouth_half : null;
      }
    }
    return null;
  }
  function punchExtension(now) {                  // 0..1: out fast, hold a moment, back
    const k = (now - punchAnim.t) / PUNCH_MS;
    if (k < 0 || k >= 1) return 0;
    if (k < 0.35) { const u = k / 0.35; return 1 - (1 - u) * (1 - u); }
    if (k < 0.5) return 1;
    const u = (k - 0.5) / 0.5; return 1 - u * u;
  }
  // The punching arm is a chunky 15px-wide arm (assets/player/punch_arm.png: 5 shoulder rows, 1 repeatable middle row, 8 fist rows).
  // It is never scaled: the middle row is repeated to reach the block, so its pixels stay crisp.
  const PA_TOP = 5, PA_FIST = 8, PA_MID_ROW = 5;
  let armCanvas = null;
  function drawArmReach(ax, now, px, py) {
    const e = punchExtension(now);
    const tcx = punchAnim.tx * TILE + TILE / 2 - camX, tcy = punchAnim.ty * TILE + TILE / 2 - camY;
    const ox = px - SPR_OFF_X, oy = py - SPR_OFF_Y;
    const lx = player.facing >= 0 ? tcx - ox : ox + SPR_W - tcx, ly = tcy - oy;   // target in the character's own (mirrored) space
    const sx = ax + ARM_PIVOT_X, sy = ARM_Y + ARM_PIVOT_Y;
    const vx = lx - sx, vy = ly - sy;
    const dist = Math.hypot(vx, vy);
    const minLen = PA_TOP + PA_FIST + 2;
    const reachLen = Math.max(minLen, Math.min(dist - 2, TILE * 2.6));            // the fist ends at the block
    const len = Math.round(minLen + e * (reachLen - minLen));
    const img = images.p_punch_arm, W = img.width;
    // Build the whole arm unrotated on a small canvas first (shoulder + repeated middle row + fist), then draw that ONE
    // picture rotated. Drawing the rows separately rotated left hairline gaps between them (the "torn" look).
    if (!armCanvas) armCanvas = document.createElement('canvas');
    const total = Math.max(len, PA_TOP + PA_FIST);
    if (armCanvas.width !== W || armCanvas.height !== total) { armCanvas.width = W; armCanvas.height = total; }
    const ag = armCanvas.getContext('2d');
    ag.clearRect(0, 0, W, total);
    ag.imageSmoothingEnabled = false;
    ag.drawImage(img, 0, 0, W, PA_TOP, 0, 0, W, PA_TOP);
    const mid = total - PA_TOP - PA_FIST;
    if (mid > 0) ag.drawImage(img, 0, PA_MID_ROW, W, 1, 0, PA_TOP, W, mid);   // the middle row, repeated (not scaled: same pixels per row)
    ag.drawImage(img, 0, PA_TOP + 1, W, PA_FIST, 0, PA_TOP + mid, W, PA_FIST);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.atan2(vy, vx) - Math.PI / 2);                // the arm sprite hangs down, so turn it to point at the block
    ctx.drawImage(armCanvas, -W / 2, -3);
    ctx.restore();
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
      ctx.drawImage(ax === ARM_LEFT_X ? images.p_arm_near : images.p_arm_far, -ARM_PIVOT_X, -ARM_PIVOT_Y);   // the untouched arm sprite
      ctx.restore();
    };
    drawArm(ARM_RIGHT_X, player.armR);              // far arm: behind the body, only sticks out past its edge
    ctx.drawImage(img, 0, 0);                       // body (legs animated), no arms
    const angry = now - punchAnim.t < PUNCH_MS + 150;
    const lids = angry ? null : blinkOverlay(now);
    if (lids) ctx.drawImage(lids, 0, 0);            // eyes closing, drawn over the face only
    if (angry) ctx.drawImage(images.p_punch_face, 0, 0);   // angry, focused eyes while punching / placing
    const mouthImg = angry ? images.p_mouth_open : mouthOverlay(now);
    if (mouthImg) ctx.drawImage(mouthImg, 0, 0);    // mouth open (talking / jumping / punching)
    const punching = now - punchAnim.t < PUNCH_MS;
    if (punching) drawArmReach(ARM_LEFT_X, now, px, py);   // near arm reaches out to the block
    else drawArm(ARM_LEFT_X, player.armL);               // near arm: in front of the body
    ctx.restore();
  }

  // The logged-in username floats above the character's head. Drawn in screen pixels (not scaled game pixels)
  // so the text stays sharp at every zoom level; the size grows a little with the zoom.
  let nameTopY = 0;         // screen y of the top of the name tag (the chat bubble sits above it)
  function drawName() {
    if (!playerName) return;
    const size = Math.max(11, 4 * SCALE + 3);
    const cx = Math.round((drawX + PW / 2 - camX) * SCALE);
    const mid = Math.round((drawY - SPR_OFF_Y + HEAD_TOP_ROW - camY - 2) * SCALE) - Math.round(size * 0.8);   // just above the top of the head
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

  // "..." bubble shown over the head while the chat box is open (the player is typing)
  function drawTyping(now) {
    const size = Math.max(11, 4 * SCALE + 3);
    const cx = Math.round((drawX + PW / 2 - camX) * SCALE);
    const tail = Math.round(size * 0.5);
    const w = Math.round(size * 3.2), h = Math.round(size * 1.7);
    const bottom = (nameTopY || Math.round((drawY - SPR_OFF_Y + HEAD_TOP_ROW - camY - 2) * SCALE)) - Math.round(size * 0.35) - tail;
    const x = Math.round(cx - w / 2), y = bottom - h;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(10, 14, 30, .85)';
    ctx.lineWidth = Math.max(2, Math.round(SCALE * 0.8));
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.round(size * 0.8)); else ctx.rect(x, y, w, h);
    ctx.moveTo(cx - tail, bottom); ctx.lineTo(cx, bottom + tail); ctx.lineTo(cx + tail, bottom);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - tail + 1, bottom - 1, tail * 2 - 1, ctx.lineWidth + 1);
    const r = Math.max(2, Math.round(size * 0.13)), step = Math.round(size * 0.7);
    ctx.fillStyle = '#16192b';
    for (let i = -1; i <= 1; i++) {                               // three dots that bounce one after another
      const bounce = Math.max(0, Math.sin(now / 160 - i * 1.1)) * Math.round(size * 0.22);
      ctx.beginPath();
      ctx.arc(cx + i * step, y + h / 2 - bounce, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBubble(now) {
    if (chatEl.classList.contains('open')) { drawTyping(now); return; }
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
    const bottom = (nameTopY || Math.round((drawY - SPR_OFF_Y + HEAD_TOP_ROW - camY - 2) * SCALE)) - Math.round(size * 0.35) - tail;
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
    ctx.lineWidth = 2;
    ctx.strokeStyle = t.inReach ? '#ffd84a' : 'rgba(255,90,90,.75)';
    ctx.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
  }

  function render(now, alpha) {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    updateRenderPos(alpha);
    updateCamera();
    drawSky();
    drawWorld(now);
    drawDrops(now);
    drawReach(now);
    drawPlayer(now);
    drawName();
    drawBubble(now);
    drawCursor();
  }

  // ---------- Inventory panel (drag the handle above the hotbar up to open it) ----------
  const dock = document.getElementById('dock');
  const invPanel = document.getElementById('invPanel');
  const invHandle = document.getElementById('invHandle');
  const invGrid = document.getElementById('invGrid');
  const invSearch = document.getElementById('invSearch');
  const invName = document.getElementById('invName');
  const dlg = document.getElementById('invDialog');
  const dlgTitle = document.getElementById('dlgTitle'), dlgBody = document.getElementById('dlgBody');
  const dlgAmt = document.getElementById('dlgAmt'), dlgOk = document.getElementById('dlgOk'), dlgCancel = document.getElementById('dlgCancel');
  const INV_COLS = 7, INV_MIN_SLOTS = 21;
  let invOpen = false;

  function invMaxH() { return Math.min(230, Math.round(window.innerHeight * 0.5)); }
  function setInvHeight(h, animate) {
    invPanel.classList.toggle('shown', h > 8);
    invPanel.style.height = h > 8 ? Math.round(h) + 'px' : '0px';
  }
  function openInventory() { invOpen = true; setInvHeight(invMaxH(), true); refreshInventory(); }
  function closeInventory() { invOpen = false; setInvHeight(0, true); invSearch.blur(); }
  function toggleInventory() { if (invOpen) closeInventory(); else openInventory(); }

  // drag the handle up to open, down to close; a plain tap toggles
  let drag = null;
  invHandle.addEventListener('pointerdown', e => {
    e.preventDefault();
    invHandle.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, h: invPanel.offsetHeight, moved: false };
  });
  invHandle.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) setInvHeight(Math.max(0, Math.min(invMaxH(), drag.h + dy)), false);
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { toggleInventory(); return; }
    const h = invPanel.offsetHeight;                       // dragged up = open, dragged down = close
    if (h > d.h + 6) openInventory(); else if (h < d.h - 6) closeInventory();
    else if (h > invMaxH() * 0.35) openInventory(); else closeInventory();
  };
  invHandle.addEventListener('pointerup', endDrag);
  invHandle.addEventListener('pointercancel', endDrag);

  let invSel = null;          // block id picked in the inventory grid
  function ownedItems() {
    const q = invSearch.value.trim().toLowerCase();
    return Object.keys(BLOCKS).map(Number).filter(id => inv[id] > 0 && (!q || BLOCKS[id].name.toLowerCase().includes(q)));
  }
  function refreshInventory() {
    if (!invGrid) return;
    const items = ownedItems();
    if (invSel === null || !inv[invSel]) invSel = PLACEABLE[selected] && inv[PLACEABLE[selected]] ? PLACEABLE[selected] : (items[0] || null);
    invGrid.innerHTML = '';
    const total = Math.max(INV_MIN_SLOTS, Math.ceil(items.length / INV_COLS) * INV_COLS);
    for (let i = 0; i < total; i++) {
      const cell = document.createElement('div');
      const id = items[i];
      cell.className = 'inv-cell' + (id === undefined ? ' blank' : '') + (id === invSel ? ' sel' : '');
      if (id !== undefined) {
        cell.title = BLOCKS[id].name;
        cell.innerHTML = '<img alt="" src="assets/tiles/' + BLOCKS[id].img + '.png"><span class="count">' + inv[id] + '</span>';
        cell.addEventListener('click', () => {
          invSel = id;
          const pi = PLACEABLE.indexOf(id);
          if (pi >= 0) selectSlot(pi); else refreshHotbar();
        });
      }
      invGrid.appendChild(cell);
    }
    invName.textContent = invSel ? BLOCKS[invSel].name + ' x' + inv[invSel] : 'No item';
    dock.querySelectorAll('.inv-act').forEach(b => { b.disabled = !invSel; });
  }
  invSearch.addEventListener('input', refreshInventory);
  invSearch.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') invSearch.blur(); });

  // small dialog used by Drop / Trash / Info
  let dlgAction = null;
  function showDialog(title, body, withAmount, okText, action) {
    dlgTitle.textContent = title;
    dlgBody.textContent = body;
    dlgAmt.hidden = !withAmount;
    dlgAmt.value = '1';
    dlgOk.textContent = okText;
    dlgCancel.hidden = !action;
    dlgAction = action;
    dlg.hidden = false;
    keys.left = keys.right = keys.jump = false;
    if (withAmount) { dlgAmt.max = String(inv[invSel] || 1); dlgAmt.focus(); dlgAmt.select(); } else dlgOk.focus();
  }
  function closeDialog() { dlg.hidden = true; dlgAction = null; }
  function dialogAmount() { return Math.max(1, Math.min(inv[invSel] || 0, parseInt(dlgAmt.value, 10) || 1)); }
  dlgOk.addEventListener('click', () => { const a = dlgAction; const n = dialogAmount(); closeDialog(); if (a) a(n); });
  dlgCancel.addEventListener('click', closeDialog);
  dlg.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); dlgOk.click(); }
    if (e.key === 'Escape') closeDialog();
  });

  document.getElementById('invDrop').addEventListener('click', () => {
    if (!invSel) return;
    const id = invSel;
    showDialog('Drop ' + BLOCKS[id].name, 'How many do you want to drop? (you have ' + inv[id] + ')', true, 'Drop', n => dropItem(id, n));
  });
  document.getElementById('invTrash').addEventListener('click', () => {
    if (!invSel) return;
    const id = invSel;
    showDialog('Trash ' + BLOCKS[id].name, 'How many do you want to throw away for good? (you have ' + inv[id] + ')', true, 'Trash', n => {
      inv[id] = Math.max(0, (inv[id] || 0) - n);
      refreshHotbar(); saveSoon();
    });
  });
  document.getElementById('invInfo').addEventListener('click', () => {
    if (!invSel) return;
    const b = BLOCKS[invSel];
    const hitsTxt = b.hits === Infinity ? 'Cannot be broken.' : 'Takes ' + b.hits + ' punches to break.';
    showDialog(b.name, hitsTxt + ' You have ' + inv[invSel] + '. Place it with right-click (or Place mode).', false, 'OK', null);
  });

  // ---- reach outline: the area around you where blocks can be broken and placed ----
  function drawReach(now) {
    if (!invOpen && now > reachUntil) return;
    const fade = invOpen ? 1 : Math.min(1, (reachUntil - now) / 500);
    const c = playerCenter();
    const cx0 = Math.floor(c.x / TILE), cy0 = Math.floor(c.y / TILE), r = REACH_TILES;
    const inReach = tileInReach;
    ctx.save();
    ctx.globalAlpha = fade;
    for (let ty = cy0 - r; ty <= cy0 + r; ty++) {
      for (let tx = cx0 - r; tx <= cx0 + r; tx++) {
        if (!inReach(tx, ty)) continue;
        const x = tx * TILE - camX, y = ty * TILE - camY;
        const empty = getTile(tx, ty) === 0;                          // free spots (where a block can go) get a lighter box
        ctx.fillStyle = empty ? 'rgba(255, 255, 255, .10)' : 'rgba(255, 255, 255, .04)';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = empty ? 'rgba(255, 255, 255, .75)' : 'rgba(255, 255, 255, .45)';   // every block in reach has its own outline
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      }
    }
    ctx.restore();
  }

  // ---- items lying in the world ----
  const DROP_SIZE = 16;
  function dropItem(id, n) {
    n = Math.min(n, inv[id] || 0);
    if (n <= 0) return;
    inv[id] -= n;
    const c = playerCenter();
    let x = c.x + player.facing * (PW / 2 + 12) - DROP_SIZE / 2;
    if (solidAt(Math.floor((x + DROP_SIZE / 2) / TILE), Math.floor(c.y / TILE))) x = c.x - DROP_SIZE / 2;   // wall in front: drop at your feet
    drops.push({ x, y: player.y + PH - DROP_SIZE - 8, vy: 0, id, n, t: performance.now() });
    refreshHotbar(); saveSoon();
  }
  function stepDrops(now) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.vy = Math.min(10, d.vy + 0.4);
      let ny = d.y + d.vy;
      const fx0 = Math.floor((d.x + 1) / TILE), fx1 = Math.floor((d.x + DROP_SIZE - 2) / TILE);
      const row = Math.floor((ny + DROP_SIZE) / TILE);
      if (d.vy >= 0 && (solidAt(fx0, row) || solidAt(fx1, row)) && d.y + DROP_SIZE <= row * TILE + 1) { ny = row * TILE - DROP_SIZE; d.vy = 0; }
      d.y = ny;
      if (d.y > WORLD_H * TILE) { drops.splice(i, 1); continue; }
      // walk over it to pick it up (after a short delay so a fresh drop isn't grabbed straight back)
      if (now - d.t > 1200 && player.x < d.x + DROP_SIZE && player.x + PW > d.x && player.y < d.y + DROP_SIZE && player.y + PH > d.y) {
        inv[d.id] = (inv[d.id] || 0) + d.n;
        drops.splice(i, 1);
        refreshHotbar(); saveSoon();
      }
    }
  }
  function drawDrops(now) {
    drops.forEach(d => {
      const bob = Math.round(Math.sin(now / 300 + d.x) * 1);
      const sx = Math.round(d.x - camX), sy = Math.round(d.y - camY + bob);
      ctx.drawImage(images[BLOCKS[d.id].img], sx, sy, DROP_SIZE, DROP_SIZE);
      if (d.n > 1) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.font = 'bold ' + Math.max(9, 3 * SCALE + 3) + 'px "Trebuchet MS", Verdana, sans-serif';
        ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(10,14,30,.85)'; ctx.fillStyle = '#fff';
        const tx = (sx + DROP_SIZE) * SCALE, ty = (sy + DROP_SIZE) * SCALE;
        ctx.strokeText(String(d.n), tx, ty); ctx.fillText(String(d.n), tx, ty);
        ctx.restore();
      }
    });
  }

  // ---------- Main loop ----------
  let last = 0, acc = 0;
  const STEP = 1000 / 60;
  function frame(now) {
    if (!last) last = now;
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= STEP) { stepPlayer(); stepDrops(now); acc -= STEP; }
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
      toolKind = s.tool === 'wrench' ? 'wrench' : 'fist';
      holding = toolKind; placeMode = false;
      drops = (Array.isArray(s.drops) ? s.drops : []).filter(d => d && BLOCKS[d.id] && d.n > 0 && isFinite(d.x) && isFinite(d.y)).map(d => ({ x: d.x, y: d.y, vy: 0, id: d.id, n: d.n, t: 0 }));
      player.x = s.px; player.y = s.py - 4;   // the hitbox got 1px taller; start just above where you saved so you can't spawn inside a block
      if (!isFinite(player.x) || !isFinite(player.y)) { player.x = spawnX * TILE + 5; player.y = (surf[spawnX] - 2) * TILE; }
      player.px = player.x; player.py = player.y;
      buildHotbar();
    } else {
      newWorld();
    }
    applyHolding(holding);
    document.getElementById('loading').remove();
    requestAnimationFrame(frame);
  }).catch(err => {
    document.getElementById('loading').textContent = 'Could not load game files: ' + err.message;
  });
})();
