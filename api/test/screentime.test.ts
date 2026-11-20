import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-screen-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
mkdirSync(join(root, 'vault'), { recursive: true });

const s = await import('../src/modules/screentime/store.ts');
const { setSecret } = await import('../src/config.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };

test('ingest token: hash only, constant-time check', () => {
  const tok = 'a'.repeat(43);
  assert.equal(s.checkIngestToken(tok), false); // no hash stored yet
  setSecret('MOSAIC_INGEST_HASH', s.hashToken(tok));
  assert.equal(s.checkIngestToken(tok), true);
  assert.equal(s.checkIngestToken('b'.repeat(43)), false);
  assert.equal(s.checkIngestToken('short'), false);
});

test('ingest is idempotent per day/device/app and skips bad rows', () => {
  const rows = [
    { day: '2026-11-10', app: 'chrome.exe', minutes: 120 },
    { day: '2026-11-10', app: 'youtube.com', minutes: 45, kind: 'web' },
    { day: '2026-11-11', app: 'Code.exe', minutes: 90 },
    { day: 'bad', app: 'x', minutes: 5 },
    { day: '2026-11-11', app: 'y', minutes: 5000 },
  ];
  const r = s.ingestScreenTime('pc', 'windows', rows);
  assert.equal(r.saved, 3);
  assert.equal(r.skipped, 2);
  // re-sync with an updated number replaces, not adds
  s.ingestScreenTime('pc', 'windows', [{ day: '2026-11-10', app: 'chrome.exe', minutes: 130 }]);
  s.ingestScreenTime('phone', 'android', [{ day: '2026-11-10', app: 'com.instagram.android', minutes: 60 }]);
  const sum = s.screenTimeSummary('2026-11-10', 1);
  assert.equal(sum.total_minutes, 130 + 45 + 60);
  assert.equal(sum.per_device.length, 2);
  assert.equal(sum.top_apps[0].app, 'chrome.exe');
  assert.equal(code(() => s.ingestScreenTime('Bad Device!', 'windows', [])), 'bad_request');
  assert.equal(code(() => s.ingestScreenTime('pc', 'tv', [])), 'bad_request');
});

test('glance and forget', () => {
  const g = s.screenTimeGlance('2026-11-10')!;
  assert.equal(g.total_minutes, 235);
  assert.ok(g.top_apps.length <= 3);
  assert.equal(s.listDevices().length, 2);
  s.forgetDevice('phone');
  assert.equal(s.listDevices().length, 1);
  assert.equal(s.screenTimeSummary('2026-11-10', 1).total_minutes, 175);
});
