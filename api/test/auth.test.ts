import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-auth-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
delete process.env.MOSAIC_DEV;
mkdirSync(join(root, 'vault'), { recursive: true });

const a = await import('../src/auth.ts');
const { secret } = await import('../src/config.ts');

test('HOTP/TOTP match RFC 4226 and RFC 6238 SHA-1 vectors', () => {
  const key = Buffer.from('12345678901234567890');
  assert.deepEqual([0, 1, 2, 9].map((c) => a.hotp(key, c)), ['755224', '287082', '359152', '520489']);
  const b32 = a.base32Encode(key);
  assert.equal(b32, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(a.base32Decode(b32), key);
  // RFC 6238 table, last 6 digits of the 8-digit values
  assert.equal(a.totpAt(b32, 59_000), '287082');
  assert.equal(a.totpAt(b32, 1111111109_000), '081804');
  assert.equal(a.totpAt(b32, 1234567890_000), '005924');
  assert.equal(a.totpAt(b32, 2000000000_000), '279037');
});

test('locked until email, password and 2FA are all set', () => {
  assert.deepEqual(a.setupMissing(), ['owner email', 'app password', 'authenticator (2FA)']);
  assert.equal(a.login('1.1.1.1', 'x@y.z', 'whatever', '000000', 't').ok, false);
  assert.throws(() => a.setOwnerEmail('not-an-email'));
  a.setOwnerEmail('  Owner@Example.com ');
  assert.throws(() => a.setPassword('short'));
  a.setPassword('correct horse battery');
  assert.deepEqual(a.setupMissing(), ['authenticator (2FA)']);
  assert.throws(() => a.totpConfirm('123456'), /No 2FA setup/);
});

let recovery: string[] = [];
test('2FA setup: wrong code rejected, right code activates and gives 10 recovery codes', () => {
  const { uri } = a.totpBegin();
  assert.match(uri, /^otpauth:\/\/totp\/Mosaic%3Aowner%40example\.com\?secret=[A-Z2-7]{32}&issuer=Mosaic/);
  const pending = secret('MOSAIC_TOTP_PENDING')!;
  const now = a.totpAt(pending);
  assert.throws(() => a.totpConfirm(now === '000000' ? '111111' : '000000'), /does not match/);
  recovery = a.totpConfirm(now);
  assert.equal(recovery.length, 10);
  assert.ok(recovery.every((c) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(c)));
  assert.deepEqual(a.setupMissing(), []);
  assert.equal(secret('MOSAIC_TOTP_PENDING'), undefined);
  assert.ok(!(secret('MOSAIC_TOTP_RECOVERY') ?? '').includes(recovery[0].replace('-', '')), 'only hashes stored');
});

test('login needs the right email, password and a fresh code; replay is refused', () => {
  const b32 = secret('MOSAIC_TOTP_SECRET')!;
  const later = Date.now() + 30_000; // next step: the setup step is already used
  const code = a.totpAt(b32, later);
  assert.equal(a.login('2.2.2.2', 'someone@else.com', 'correct horse battery', code, 't').ok, false);
  assert.equal(a.login('2.2.2.2', 'owner@example.com', 'wrong password!!', code, 't').ok, false);
  assert.equal(a.login('2.2.2.2', 'owner@example.com', 'correct horse battery', '', 't').ok, false);
  const r = a.login('3.3.3.3', 'OWNER@example.com', 'correct horse battery', code, 'test-agent');
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.via, 'totp');
    assert.ok(a.validSession(r.token));
    a.logout(r.token);
    assert.equal(a.validSession(r.token), false);
  }
  assert.equal(a.login('3.3.3.3', 'owner@example.com', 'correct horse battery', code, 't').ok, false, 'same code twice');
});

test('recovery code works once', () => {
  const left = a.recoveryLeft();
  const r = a.login('4.4.4.4', 'owner@example.com', 'correct horse battery', recovery[0].toLowerCase(), 't');
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.via, 'recovery');
  assert.equal(a.recoveryLeft(), left - 1);
  assert.equal(a.login('4.4.4.4', 'owner@example.com', 'correct horse battery', recovery[0], 't').ok, false);
});

test('5 failures per IP lock that IP', () => {
  for (let i = 0; i < 5; i++) a.login('9.9.9.9', 'owner@example.com', 'nope nope nope', '000000', 't');
  assert.ok(a.loginBlocked('9.9.9.9'));
  assert.equal(a.loginBlocked('8.8.8.8'), null);
});

test('HTTP: noindex everywhere, nothing served before sign-in, bearer works for native origins', async () => {
  const { buildApp } = await import('../src/routes.ts');
  const app = buildApp();
  const robots = await app.request('/robots.txt');
  assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
  assert.match(robots.headers.get('X-Robots-Tag') ?? '', /noindex/);
  assert.equal((await app.request('/', { headers: { 'Sec-Fetch-Mode': 'navigate' } })).status, 302);
  assert.equal((await app.request('/assets/index.js')).status, 401);
  assert.equal((await app.request('/api/me')).status, 401);
  const login = await app.request('/login');
  assert.match(await login.text(), /name="code"/);
  assert.match(login.headers.get('X-Robots-Tag') ?? '', /noindex/);

  const pre = await app.request('/api/auth/login', { method: 'OPTIONS', headers: { Origin: 'https://localhost' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://localhost');
  assert.equal((await app.request('/api/auth/login', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 403);

  const b32 = secret('MOSAIC_TOTP_SECRET')!;
  (await import('../src/db.ts')).getDb().exec("DELETE FROM auth_state WHERE key = 'totp_last_step'"); // fresh step for this test
  const body = (code: string) => JSON.stringify({ email: 'owner@example.com', password: 'correct horse battery', code });
  const bad = await app.request('/api/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: body('000000') });
  assert.equal(bad.status, 403);
  const ok = await app.request('/api/auth/login', {
    method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/json' }, body: body(a.totpAt(b32)),
  });
  assert.equal(ok.status, 200);
  const { token } = await ok.json() as { token: string };
  const me = await app.request('/api/me', { headers: { Origin: 'https://localhost', Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('Access-Control-Allow-Origin'), 'https://localhost');
  await app.request('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await app.request('/api/me', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});
