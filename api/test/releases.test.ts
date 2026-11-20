import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-releases-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');

const r = await import('../src/releases.ts');
const dir = r.releasesDir();
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code ?? e.message; } };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('compares versions as numbers', () => {
  assert.equal(r.compareVersions('2.0.10', '2.0.9'), 1);
  assert.equal(r.compareVersions('2.0.0', '2.0.0'), 0);
  assert.equal(r.compareVersions('1.9.9', '2.0.0'), -1);
});

test('no release published → version null, downloads 404', () => {
  assert.deepEqual(r.updateInfo(), { version: null });
  assert.equal(code(() => r.releaseBytes('android')), 'not_found');
});

test('reads latest.json, checks files on disk, serves bytes', () => {
  mkdirSync(dir, { recursive: true });
  const apk = Buffer.from('PK fake apk');
  const exe = Buffer.from('MZ fake exe');
  writeFileSync(join(dir, 'Mosaic-2.0.1.apk'), apk);
  writeFileSync(join(dir, 'Mosaic-2.0.1-setup.exe'), exe);
  writeFileSync(join(dir, 'latest.json'), JSON.stringify({
    version: '2.0.1', notes: 'Faster chat', date: '2026-11-12',
    android: { file: 'Mosaic-2.0.1.apk', size: apk.length, sha256: sha(apk) },
    windows: { file: 'Mosaic-2.0.1-setup.exe', size: exe.length + 5, sha256: sha(exe) }, // half-uploaded
  }));
  const info = r.updateInfo() as any;
  assert.equal(info.version, '2.0.1');
  assert.equal(info.android.url, '/api/app/update/android');
  assert.equal(info.windows, undefined, 'size mismatch hides the file');
  assert.deepEqual(r.releaseBytes('android').bytes, apk);
  assert.equal(code(() => r.releaseBytes('windows')), 'not_found');
  assert.equal(code(() => r.releaseBytes('../latest')), 'not_found');
});

test('rejects unsafe file names and bad versions', () => {
  writeFileSync(join(dir, 'latest.json'), JSON.stringify({
    version: '2.0.2', android: { file: '../secrets.apk', size: 1, sha256: 'a'.repeat(64) },
  }));
  assert.equal((r.updateInfo() as any).android, undefined);
  writeFileSync(join(dir, 'latest.json'), JSON.stringify({ version: 'latest' }));
  assert.deepEqual(r.updateInfo(), { version: null });
  writeFileSync(join(dir, 'latest.json'), '{broken');
  assert.equal(r.latestRelease(), null);
});
