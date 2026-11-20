// Single-owner login: email + app password + authenticator code (TOTP, RFC 6238). All three are required;
// if any of them is not set up, nobody gets in (fail closed).
// Stored in secrets.env only: MOSAIC_OWNER_EMAIL, MOSAIC_APP_PASSWORD_HASH (scrypt), MOSAIC_TOTP_SECRET (base32),
// MOSAIC_TOTP_RECOVERY (sha256 of one-time recovery codes). Sessions: random token (HttpOnly cookie on the web,
// Bearer header in the native apps); only its sha256 is stored in app.db.
import { scryptSync, randomBytes, timingSafeEqual, createHash, createHmac, randomInt } from 'node:crypto';
import { secret, setSecret } from './config.ts';
import { getDb } from './db.ts';

export const COOKIE = '__Host-mosaic';
const SESSION_DAYS = 90;
const N = 16384, R = 8, P = 1, KEYLEN = 32;
const ISSUER = 'Mosaic';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(sha(a)), y = Buffer.from(sha(b));
  return timingSafeEqual(x, y);
};

const ensureTables = () => {
  getDb().exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created TEXT NOT NULL, last_seen TEXT NOT NULL, expires TEXT NOT NULL, agent TEXT)');
  getDb().exec('CREATE TABLE IF NOT EXISTS auth_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
};
const stateGet = (k: string) => {
  ensureTables();
  return (getDb().prepare('SELECT value FROM auth_state WHERE key = ?').get(k) as { value: string } | undefined)?.value;
};
const stateSet = (k: string, v: string) => {
  ensureTables();
  getDb().prepare('INSERT INTO auth_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
};

/** Ends every session (all devices). */
export const signOutAll = () => {
  ensureTables();
  getDb().exec('DELETE FROM sessions');
};

// ---------- Setup state ----------
export const normEmail = (e: string) => e.trim().toLowerCase();
export const passwordSet = () => !!secret('MOSAIC_APP_PASSWORD_HASH');
export const emailSet = () => !!secret('MOSAIC_OWNER_EMAIL');
export const totpSet = () => !!secret('MOSAIC_TOTP_SECRET');
/** What is still missing before anyone can sign in. Empty = ready. */
export const setupMissing = (): string[] => [
  ...(emailSet() ? [] : ['owner email']),
  ...(passwordSet() ? [] : ['app password']),
  ...(totpSet() ? [] : ['authenticator (2FA)']),
];

export const setOwnerEmail = (email: string) => {
  const e = normEmail(email);
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(e)) throw new Error('Not a valid email.');
  setSecret('MOSAIC_OWNER_EMAIL', e);
  signOutAll();
};

/** Store a new password hash and end every existing session. */
export const setPassword = (pw: string) => {
  if (pw.length < 12) throw new Error('Password must be at least 12 characters.');
  if (pw.length > 200) throw new Error('Password too long.');
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, KEYLEN, { N, r: R, p: P });
  setSecret('MOSAIC_APP_PASSWORD_HASH', `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`);
  signOutAll();
};

const checkPassword = (pw: string) => {
  const stored = secret('MOSAIC_APP_PASSWORD_HASH');
  if (!stored) return false;
  const [kind, n, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(pw.slice(0, 200), Buffer.from(salt, 'base64'), want.length, { N: Number(n) || N, r: R, p: P });
  return got.length === want.length && timingSafeEqual(got, want);
};

const checkEmail = (email: string) => {
  const want = secret('MOSAIC_OWNER_EMAIL');
  return !!want && safeEq(normEmail(email), normEmail(want));
};

// ---------- TOTP (RFC 6238: SHA-1, 6 digits, 30 s) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const base32Encode = (buf: Buffer) => {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
export const base32Decode = (s: string) => {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};
export const hotp = (key: Buffer, counter: number) => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const num = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(num % 1_000_000).padStart(6, '0');
};
const STEP = 30;
export const totpAt = (b32: string, ms = Date.now()) => hotp(base32Decode(b32), Math.floor(ms / 1000 / STEP));

/** Matching time step (±1 step of clock drift), or null. */
const totpStep = (b32: string, code: string, ms = Date.now()): number | null => {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(b32);
  const now = Math.floor(ms / 1000 / STEP);
  let hit: number | null = null;
  for (const s of [now - 1, now, now + 1]) if (safeEq(hotp(key, s), code)) hit = s;
  return hit;
};

/** Starts 2FA setup: a new pending secret. Returns the key and otpauth URI for the authenticator app. */
export const totpBegin = () => {
  const b32 = base32Encode(randomBytes(20));
  setSecret('MOSAIC_TOTP_PENDING', b32);
  const label = encodeURIComponent(`${ISSUER}:${secret('MOSAIC_OWNER_EMAIL') ?? 'owner'}`);
  const uri = `otpauth://totp/${label}?secret=${b32}&issuer=${ISSUER}&algorithm=SHA1&digits=6&period=${STEP}`;
  return { key: b32.replace(/(.{4})/g, '$1 ').trim(), uri };
};

/** Confirms setup with a code from the app. Activates 2FA, returns one-time recovery codes, signs out everyone. */
export const totpConfirm = (code: string): string[] => {
  const pending = secret('MOSAIC_TOTP_PENDING');
  if (!pending) throw new Error('No 2FA setup in progress. Run: cli 2fa-setup');
  const step = totpStep(pending, code.replace(/\s/g, ''));
  if (step === null) throw new Error('Code does not match. Check the phone clock and try the next code.');
  setSecret('MOSAIC_TOTP_SECRET', pending);
  setSecret('MOSAIC_TOTP_PENDING', null);
  stateSet('totp_last_step', String(step));
  const codes = Array.from({ length: 10 }, () => {
    const raw = Array.from({ length: 10 }, () => B32[randomInt(32)]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  setSecret('MOSAIC_TOTP_RECOVERY', codes.map((c) => sha(c.replace('-', ''))).join(','));
  signOutAll();
  return codes;
};

/** Accepts a fresh TOTP code (never the same time step twice) or an unused recovery code (burned on use). */
const checkSecondFactor = (raw: string): 'totp' | 'recovery' | null => {
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  const b32 = secret('MOSAIC_TOTP_SECRET');
  if (!b32) return null;
  if (/^\d{6}$/.test(code)) {
    const step = totpStep(b32, code);
    if (step === null) return null;
    if (step <= Number(stateGet('totp_last_step') ?? '-1')) return null; // replay
    stateSet('totp_last_step', String(step));
    return 'totp';
  }
  if (/^[A-Z2-7]{10}$/.test(code)) {
    const list = (secret('MOSAIC_TOTP_RECOVERY') ?? '').split(',').filter(Boolean);
    const h = sha(code);
    const i = list.findIndex((x) => safeEq(x, h));
    if (i < 0) return null;
    list.splice(i, 1);
    setSecret('MOSAIC_TOTP_RECOVERY', list.length ? list.join(',') : null);
    return 'recovery';
  }
  return null;
};
export const recoveryLeft = () => (secret('MOSAIC_TOTP_RECOVERY') ?? '').split(',').filter(Boolean).length;

// ---------- Brute-force limits (memory; a restart resets them, the scrypt cost still applies) ----------
const fails = new Map<string, number[]>();
let globalFails: number[] = [];
const WINDOW = 15 * 60_000, PER_IP = 5, GLOBAL = 20, GLOBAL_WINDOW = 60 * 60_000;

/** null = allowed, else seconds to wait. */
export const loginBlocked = (ip: string): number | null => {
  const now = Date.now();
  globalFails = globalFails.filter((t) => now - t < GLOBAL_WINDOW);
  if (globalFails.length >= GLOBAL) return Math.ceil((globalFails[0] + GLOBAL_WINDOW - now) / 1000);
  const f = (fails.get(ip) ?? []).filter((t) => now - t < WINDOW);
  fails.set(ip, f);
  if (f.length >= PER_IP) return Math.ceil((f[0] + WINDOW - now) / 1000);
  return null;
};

export type LoginResult = { ok: true; token: string; via: 'totp' | 'recovery' } | { ok: false };

/** All three factors checked every time (no early exit that tells which one was wrong). */
export const login = (ip: string, email: string, pw: string, code: string, agent: string): LoginResult => {
  if (setupMissing().length) return { ok: false };
  const okEmail = checkEmail(email);
  const okPw = checkPassword(pw);
  const factor = okEmail && okPw ? checkSecondFactor(code) : null;
  if (!okEmail || !okPw || !factor) {
    const now = Date.now();
    fails.set(ip, [...(fails.get(ip) ?? []), now]);
    globalFails.push(now);
    return { ok: false };
  }
  fails.delete(ip);
  ensureTables();
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  getDb().prepare('INSERT INTO sessions (token_hash, created, last_seen, expires, agent) VALUES (?, ?, ?, ?, ?)')
    .run(sha(token), now.toISOString(), now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString(), agent.slice(0, 200));
  return { ok: true, token, via: factor };
};

export const validSession = (token: string | undefined): boolean => {
  if (!token || token.length > 100) return false;
  ensureTables();
  const now = new Date().toISOString();
  const r = getDb().prepare('SELECT expires, last_seen FROM sessions WHERE token_hash = ?').get(sha(token)) as { expires: string; last_seen: string } | undefined;
  if (!r || r.expires < now) return false;
  if (Date.now() - Date.parse(r.last_seen) > 3600_000)
    getDb().prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, sha(token));
  return true;
};

export const listSessions = () => {
  ensureTables();
  return getDb().prepare('SELECT created, last_seen, expires, agent FROM sessions ORDER BY last_seen DESC').all() as
    { created: string; last_seen: string; expires: string; agent: string | null }[];
};

export const logout = (token: string | undefined) => {
  if (!token) return;
  ensureTables();
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
};

export const sessionCookie = (token: string) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

// Same copy as the app: a rejected sign-in never says which field was wrong.
const NO_MATCH = 'That did not match. Check the code and try again.';
const loginError = (e: string) => (/^wrong email, password or code\.?$/i.test(e.trim()) ? NO_MATCH : e);

// Mosaic login page. Mirrors the in-app Login screen; colours are the literal values of the app's tokens.
// Field names (email, password, code, next), the action and the autocomplete hints must not change.
export const loginPage = (error = '', next = '/') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><meta name="referrer" content="no-referrer"><title>Sign in · Mosaic</title>
<style>
:root{--bg:#F6F7F9;--surface:#FFFFFF;--line:#E3E6EA;--line-strong:#CDD2D9;--text:#14171C;--text-2:#4B535E;--text-3:#5F6772;--accent:#0F766E;--accent-ink:#FFFFFF;--accent-hover:#0D685F;--focus:#0F766E;--danger:#C4321F;--ring:0 0 0 3px var(--bg),0 0 0 5px var(--focus)}
@media (prefers-color-scheme:dark){:root{--bg:#0C0E12;--surface:#16191F;--line:#2A2F38;--line-strong:#3A414C;--text:#ECEEF1;--text-2:#A9B0BA;--text-3:#8B93A0;--accent:#2DD4BF;--accent-ink:#04241F;--accent-hover:#42D8C5;--focus:#2DD4BF;--danger:#FF8A7A}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:16px/1.5 'Atkinson Hyperlegible Next',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
form{width:100%;max-width:400px;display:grid;gap:16px;padding:24px;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06)}
.brand{display:grid;justify-items:center;gap:8px;text-align:center;margin-bottom:4px}
.brand svg{width:56px;height:56px;display:block}
h1{margin:0;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-.01em}
.tag{margin:0;font-size:14px;color:var(--text-2)}
.priv{margin:-8px 0 0;text-align:center;font-size:13px;color:var(--text-3)}
.f{display:grid;gap:6px}
label{font-size:14px;font-weight:500;color:var(--text)}
input{width:100%;height:48px;padding:0 14px;font:inherit;font-size:16px;border:1px solid var(--line-strong);border-radius:10px;background:var(--surface);color:var(--text)}
input:focus{outline:none;border-color:var(--focus);box-shadow:var(--ring)}
#c.otp{letter-spacing:.4em;font-variant-numeric:tabular-nums;text-align:center;font-size:20px}
.help{margin:0;font-size:13px;color:var(--text-2)}
.swap{justify-self:start;min-height:48px;margin:-8px 0;padding:0 4px;border:0;background:none;color:var(--accent);font:inherit;font-size:14px;text-decoration:underline;text-underline-offset:3px;cursor:pointer;border-radius:6px}
.swap:hover{color:var(--accent-hover)}
.swap:focus-visible,.go:focus-visible{outline:none;box-shadow:var(--ring)}
.err{margin:0;color:var(--danger);font-size:14px}
.go{width:100%;height:48px;border:0;border-radius:10px;background:var(--accent);color:var(--accent-ink);font:inherit;font-size:16px;font-weight:600;cursor:pointer}
.go:hover{background:var(--accent-hover)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body>
<form method="post" action="/login" autocomplete="on"${error ? ' aria-describedby="err"' : ''}>
<div class="brand">
<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false"><rect width="512" height="512" rx="112" fill="#0B1F1C"/><path d="M128 236 H384" stroke="#EEF3F1" stroke-width="40" stroke-linecap="round"/><path d="M256 236 V372" stroke="#2DD4BF" stroke-width="40" stroke-linecap="round"/><circle cx="256" cy="150" r="30" fill="#FF7A45"/></svg>
<h1>Mosaic</h1>
<p class="tag">Hold the day steady.</p>
</div>
<p class="priv">Private. Owner only.</p>
<input type="hidden" name="next" value="${esc(next)}">
<div class="f"><label for="e">Email</label><input id="e" type="email" name="email" autocomplete="username" autocapitalize="off" spellcheck="false" autofocus required></div>
<div class="f"><label for="p">Password</label><input id="p" type="password" name="password" autocomplete="current-password" required></div>
<div class="f"><label for="c" id="cl">Authenticator code</label><input id="c" class="otp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9A-Za-z\\- ]{6,12}" maxlength="12" required placeholder="6 digits or recovery code" aria-describedby="ch"><p class="help" id="ch">6 digits from your authenticator app.</p></div>
<button type="button" class="swap" id="sw" hidden>Use a recovery code</button>
${error ? `<p class="err" id="err" role="alert">${esc(loginError(error))}</p>` : ''}
<button type="submit" class="go">Sign in</button>
</form>
<script>(function(){var b=document.getElementById('sw'),c=document.getElementById('c'),l=document.getElementById('cl'),h=document.getElementById('ch'),r=false;if(!b||!c)return;c.placeholder='';c.maxLength=6;b.hidden=false;b.addEventListener('click',function(){r=!r;c.value='';c.className=r?'':'otp';c.inputMode=r?'text':'numeric';c.autocomplete=r?'off':'one-time-code';c.autocapitalize=r?'characters':'off';c.maxLength=r?12:6;l.textContent=r?'Recovery code':'Authenticator code';h.textContent=r?'One of the codes you saved at setup. See password manager.':'6 digits from your authenticator app.';b.textContent=r?'Use the authenticator code':'Use a recovery code';c.focus();});})();</script>
</body></html>`;
