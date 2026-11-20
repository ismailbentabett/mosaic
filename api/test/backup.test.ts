import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = mkdtempSync(join(tmpdir(), 'mosaic-backup-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.BACKUP_DIR = join(root, 'archive');
process.env.MOSAIC_BACKUP_PASSPHRASE = 'correct horse battery staple';
process.env.MOSAIC_BACKUP_KEEP = '2';

const { encrypt, decrypt, MAGIC } = await import('../src/backup/crypto.ts');
const { signingKey, signV4, S3 } = await import('../src/backup/s3.ts');
const backup = await import('../src/backup/index.ts');
const { getDb } = await import('../src/db.ts');

/** In-memory S3: just enough of PUT/GET/DELETE/ListObjectsV2 to exercise the client. */
const fakeS3 = () => {
  const store = new Map<string, Buffer>();
  const seen: string[] = [];
  const fetchFn = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = init.headers as Record<string, string>;
    assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
    const key = decodeURIComponent(url.pathname.replace(/^\/bkt\/?/, ''));
    seen.push(`${init.method} ${key || '?' + url.searchParams.get('prefix')}`);
    if (init.method === 'PUT') { store.set(key, Buffer.from(init.body as Uint8Array)); return new Response(null, { status: 200 }); }
    if (init.method === 'DELETE') { store.delete(key); return new Response(null, { status: 204 }); }
    if (key) {
      const v = store.get(key);
      return v ? new Response(new Uint8Array(v)) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    }
    const prefix = url.searchParams.get('prefix') ?? '';
    const items = [...store.entries()].filter(([k]) => k.startsWith(prefix));
    const xml = `<ListBucketResult><IsTruncated>false</IsTruncated>${items
      .map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-01-01T00:00:00Z</LastModified></Contents>`)
      .join('')}</ListBucketResult>`;
    return new Response(xml);
  }) as typeof fetch;
  const s3 = new S3({ endpoint: 'https://s3.example.test', bucket: 'bkt', region: 'auto', accessKeyId: 'AKID', secretAccessKey: 'SECRET' }, fetchFn);
  return { s3, store, seen };
};

test('encrypt/decrypt round-trips and rejects a wrong passphrase', () => {
  const plain = Buffer.from('hello backup '.repeat(1000));
  const blob = encrypt(plain, 'a long enough passphrase');
  assert.ok(blob.subarray(0, 8).equals(MAGIC));
  assert.ok(blob.length < plain.length, 'gzip before encryption');
  assert.deepEqual(decrypt(blob, 'a long enough passphrase'), plain);
  assert.throws(() => decrypt(blob, 'the wrong passphrase!'), /Wrong passphrase/);
});

test('any flipped byte fails the GCM tag', () => {
  const blob = encrypt(Buffer.from('payload'), 'a long enough passphrase');
  for (const i of [9, 30, 45, blob.length - 1]) {
    const bad = Buffer.from(blob);
    bad[i] ^= 0xff;
    assert.throws(() => decrypt(bad, 'a long enough passphrase'), /Wrong passphrase or corrupted/, `byte ${i}`);
  }
  assert.throws(() => decrypt(Buffer.from('not a backup'), 'a long enough passphrase'), /Not a Mosaic backup/);
  assert.throws(() => encrypt(Buffer.from('x'), 'short'), /at least 12/);
});

test('SigV4 signing key matches the AWS documentation vector', () => {
  const k = signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam');
  assert.equal(k.toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
});

test('SigV4 matches the AWS "GET with query" example (iam ListUsers)', () => {
  const h = signV4({
    method: 'GET',
    url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    region: 'us-east-1', service: 'iam',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    now: new Date('2015-08-30T12:36:00Z'),
  });
  assert.equal(
    h.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
  );
});

test('createBackup writes an encrypted local copy, uploads it, prunes, and restores intact', async () => {
  const db = getDb();
  db.exec('CREATE TABLE IF NOT EXISTS backup_probe (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO backup_probe (v) VALUES (?)').run('first');

  const { s3, store, seen } = fakeS3();
  const t = (s: string) => new Date(`2026-03-0${s}T10:00:00Z`);
  const a = await backup.createBackup({ s3, now: t('1') });
  await backup.createBackup({ s3, now: t('2') });
  const c = await backup.createBackup({ s3, now: t('3') });

  assert.match(c.name, backup.BACKUP_RE);
  assert.equal(c.remote, `mosaic/${c.name}`);
  const files = readdirSync(process.env.BACKUP_DIR!).filter((f) => backup.BACKUP_RE.test(f));
  assert.equal(files.length, 2, 'local keeps MOSAIC_BACKUP_KEEP copies');
  assert.ok(!existsSync(a.local) && !existsSync(`${a.local}.sha256`), 'oldest local copy and its sidecar pruned');
  assert.deepEqual([...store.keys()].sort(), files.map((f) => `mosaic/${f}`).sort(), 'remote pruned to match');
  assert.ok(seen.some((s) => s.startsWith('DELETE ')));

  const raw = readFileSync(c.local);
  assert.ok(!raw.includes(Buffer.from('SQLite format 3')), 'nothing readable on disk');
  assert.equal(readFileSync(`${c.local}.sha256`, 'utf8'), `${c.sha256}  ${c.name}\n`);

  const listed = await backup.listBackups({ s3 });
  assert.equal(listed.local.length, 2);
  assert.equal(listed.remote.length, 2);

  for (const src of [c.name, `s3:${c.name}`]) {
    const to = join(root, `restored-${src.replace(/\W/g, '')}.db`);
    const r = await backup.restoreBackup(src, to, { s3 });
    assert.ok(r.bytes > 0);
    const check = new DatabaseSync(to, { readOnly: true });
    assert.equal((check.prepare('SELECT v FROM backup_probe').get() as { v: string }).v, 'first');
    check.close();
    await assert.rejects(backup.restoreBackup(src, to, { s3 }), /already exists/);
  }
});

test('restore refuses a tampered local file before decrypting', async () => {
  const { s3 } = fakeS3();
  const b = await backup.createBackup({ s3, now: new Date('2026-03-09T10:00:00Z') });
  const bytes = readFileSync(b.local);
  bytes[bytes.length - 1] ^= 1;
  writeFileSync(b.local, bytes);
  await assert.rejects(backup.restoreBackup(b.name, join(root, 'tampered.db')), /Checksum mismatch/);
  await assert.rejects(backup.restoreBackup('mosaic-nope.db.gz.enc', join(root, 'nope.db')), /No backup/);
});
