// Login screen for Nubi.
//
// IMPORTANT: there is no server, so accounts live in this browser's localStorage only. Each account gets its
// own saved world, but an account made on one device/browser does not exist on another. Passwords are stored
// salted and hashed (PBKDF2), never in plain text, but this is a convenience login, not real security.
// A shared, cross-device login needs a backend (e.g. Supabase or Firebase).
(() => {
  'use strict';

  const ACCOUNTS_KEY = 'nubi-accounts-v1';
  const SESSION_KEY = 'nubi-session-v1';
  const LEGACY_SAVE = 'nubi-world-v1';              // the single save from before accounts existed
  const LEGACY_CLAIMED = 'nubi-legacy-claimed-v1';
  const SAVE_PREFIX = 'nubi-world-v1:';

  // ---- storage (falls back to memory if the browser blocks localStorage) ----
  const mem = {};
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] === undefined ? null : mem[k]; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
  };
  function readAccounts() {
    try { return JSON.parse(store.get(ACCOUNTS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeAccounts(a) { store.set(ACCOUNTS_KEY, JSON.stringify(a)); }

  // ---- password hashing ----
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  function randomSalt() {
    const a = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return hex(a);
  }
  function weakHash(str) {                          // only used when the browser has no crypto.subtle (plain http)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  async function hashPassword(password, salt, algo) {
    if (algo === 'pbkdf2') {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
      return hex(bits);
    }
    return weakHash(salt + ':' + password);
  }
  const bestAlgo = () => (window.crypto && crypto.subtle ? 'pbkdf2' : 'weak');

  // ---- elements ----
  const $ = id => document.getElementById(id);
  const overlay = $('auth'), form = $('authForm');
  const userIn = $('authUser'), passIn = $('authPass'), pass2In = $('authPass2');
  const confirmRow = $('confirmRow'), errorEl = $('authError'), submitBtn = $('authSubmit');
  const tabLogin = $('tabLogin'), tabSignup = $('tabSignup');

  let mode = 'login';
  let resolveLogin;
  const loggedIn = new Promise(res => { resolveLogin = res; });

  function showOverlay() {
    overlay.hidden = false;
    document.body.classList.add('auth-open');
  }
  function hideOverlay() {
    overlay.hidden = true;
    document.body.classList.remove('auth-open');
  }
  function setError(msg) { errorEl.textContent = msg || ''; }

  function setMode(m) {
    mode = m;
    const signup = m === 'signup';
    tabLogin.classList.toggle('active', !signup);
    tabSignup.classList.toggle('active', signup);
    tabLogin.setAttribute('aria-selected', String(!signup));
    tabSignup.setAttribute('aria-selected', String(signup));
    confirmRow.hidden = !signup;
    submitBtn.textContent = signup ? 'Create account' : 'Log in';
    passIn.autocomplete = signup ? 'new-password' : 'current-password';
    pass2In.value = '';
    setError('');
  }

  function finish(account) {
    store.set(SESSION_KEY, account.key);
    passIn.value = pass2In.value = '';
    hideOverlay();
    resolveLogin({ name: account.name, saveKey: SAVE_PREFIX + account.key });
  }

  // The world saved before accounts existed goes to the first account that gets created.
  function adoptLegacySave(key) {
    if (store.get(LEGACY_CLAIMED)) return;
    const old = store.get(LEGACY_SAVE);
    if (old) store.set(SAVE_PREFIX + key, old);
    store.set(LEGACY_CLAIMED, '1');
  }

  async function submit() {
    setError('');
    const name = userIn.value.trim();
    const password = passIn.value;
    const key = name.toLowerCase();
    if (!name || !password) return setError('Enter your username and password.');

    submitBtn.disabled = true;
    try {
      const accounts = readAccounts();
      if (mode === 'login') {
        const acc = accounts[key];
        const ok = acc && (await hashPassword(password, acc.salt, acc.algo)) === acc.hash;
        if (!ok) return setError('Wrong username or password.');
        finish({ key, name: acc.name });
      } else {
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return setError('Username: 3-16 letters, numbers or _ .');
        if (password.length < 6) return setError('Password must be at least 6 characters.');
        if (password !== pass2In.value) return setError('The two passwords do not match.');
        if (accounts[key]) return setError('That username is taken.');
        const salt = randomSalt(), algo = bestAlgo();
        accounts[key] = { name, salt, algo, hash: await hashPassword(password, salt, algo), created: Date.now() };
        writeAccounts(accounts);
        adoptLegacySave(key);
        finish({ key, name });
      }
    } catch (e) {
      setError('Something went wrong. Please try again.');
    } finally {
      submitBtn.disabled = false;
    }
  }

  form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  tabLogin.addEventListener('click', () => { setMode('login'); userIn.focus(); });
  tabSignup.addEventListener('click', () => { setMode('signup'); userIn.focus(); });

  // ---- start: already signed in on this browser? ----
  const sessionKey = store.get(SESSION_KEY);
  const accounts = readAccounts();
  if (sessionKey && accounts[sessionKey]) {
    hideOverlay();
    resolveLogin({ name: accounts[sessionKey].name, saveKey: SAVE_PREFIX + sessionKey });
  } else {
    showOverlay();
    setMode(Object.keys(accounts).length ? 'login' : 'signup');   // first visit: go straight to creating an account
    userIn.focus();
  }

  window.nubiAuth = {
    whenLoggedIn: () => loggedIn,
    logout() { store.del(SESSION_KEY); location.reload(); }
  };
})();
