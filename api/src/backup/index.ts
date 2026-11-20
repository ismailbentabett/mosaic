// Encrypted backups of app.db: a consistent snapshot (VACUUM INTO), gzip + AES-256-GCM,
// written to a local folder (always) and to any S3-compatible bucket (when configured).
// Local copies get a .sha256 sidecar that the health check verifies.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cfg, ROOT, secret } from '../config.ts';
import { getDb } from '../db.ts';
import { decrypt, encrypt } from './crypto.ts';
import { S3, type S3Config } from './s3.ts';

export const BACKUP_RE = /^mosaic-\d{8}T\d{6}Z\.db\.gz\.enc$/;
export const backupDir = () => cfg('BACKUP_DIR', join(ROOT, 'backups', 'archive'));
const keep = () => Math.max(1, Number(cfg('MOSAIC_BACKUP_KEEP', '14')) || 14);
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const stamp = (d = new Date()) => d.toISOString().replace(/[:-]|\.\d{3}/g, '');

export const s3Config = (): (S3Config & { prefix: string }) | null => {
  const endpoint = cfg('MOSAIC_S3_ENDPOINT');
  const bucket = cfg('MOSAIC_S3_BUCKET');
  const accessKeyId = secret('MOSAIC_S3_ACCESS_KEY_ID');
  const secretAccessKey = secret('MOSAIC_S3_SECRET_ACCESS_KEY');
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const prefix = cfg('MOSAIC_S3_PREFIX', 'mosaic/').replace(/^\/+/, '');
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: cfg('MOSAIC_S3_REGION', 'auto'), prefix };
};

const passphrase = () => {
  const p = secret('MOSAIC_BACKUP_PASSPHRASE');
  if (!p) throw new Error('MOSAIC_BACKUP_PASSPHRASE is not set (environment or secrets file)');
  return p;
};

/** A consistent copy of the live database, safe while the server keeps writing (WAL). */
export const snapshot = (): Buffer => {
  const tmp = join(tmpdir(), `mosaic-snap-${process.pid}-${Date.now()}.db`);
  try {
    getDb().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    return readFileSync(tmp);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
};

export type BackupResult = { name: string; bytes: number; sha256: string; local: string; remote: string | null; pruned: string[] };

export const createBackup = async (opts: { s3?: S3; now?: Date } = {}): Promise<BackupResult> => {
  const blob = encrypt(snapshot(), passphrase());
  const name = `mosaic-${stamp(opts.now)}.db.gz.enc`;
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const local = join(dir, name);
  const sum = sha256(blob);
  writeFileSync(local, blob, { mode: 0o600 });
  writeFileSync(`${local}.sha256`, `${sum}  ${name}\n`, { mode: 0o600 });

  const pruned: string[] = [];
  const old = readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - keep()))) {
    unlinkSync(join(dir, f));
    if (existsSync(join(dir, `${f}.sha256`))) unlinkSync(join(dir, `${f}.sha256`));
    pruned.push(f);
  }

  let remote: string | null = null;
  const conf = s3Config();
  const s3 = opts.s3 ?? (conf ? new S3(conf) : null);
  if (s3) {
    const prefix = conf?.prefix ?? 'mosaic/';
    remote = `${prefix}${name}`;
    await s3.put(remote, blob);
    const objects = (await s3.list(prefix)).filter((o) => BACKUP_RE.test(o.key.slice(prefix.length)));
    for (const o of objects.slice(0, Math.max(0, objects.length - keep()))) await s3.delete(o.key);
  }
  return { name, bytes: blob.length, sha256: sum, local, remote, pruned };
};

export const listBackups = async (opts: { s3?: S3 } = {}) => {
  const dir = backupDir();
  const local = existsSync(dir)
    ? readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort().map((f) => ({ name: f, bytes: statSync(join(dir, f)).size }))
    : [];
  const conf = s3Config();
  const s3 = opts.s3 ?? (conf ? new S3(conf) : null);
  const prefix = conf?.prefix ?? 'mosaic/';
  const remote = s3
    ? (await s3.list(prefix)).filter((o) => BACKUP_RE.test(o.key.slice(prefix.length))).map((o) => ({ name: o.key.slice(prefix.length), bytes: o.size }))
    : [];
  return { local, remote, s3: Boolean(s3) };
};

/**
 * Decrypt a backup (local file name/path, or `s3:<name>`) into a new SQLite file and check its integrity.
 * Never overwrites the live database: stop the server and swap the file yourself.
 */
export const restoreBackup = async (source: string, to: string, opts: { s3?: S3 } = {}) => {
  if (existsSync(to)) throw new Error(`${to} already exists; pick a new path`);
  let blob: Buffer;
  if (source.startsWith('s3:')) {
    const conf = s3Config();
    const s3 = opts.s3 ?? (conf ? new S3(conf) : null);
    if (!s3) throw new Error('S3 is not configured');
    blob = await s3.get(`${conf?.prefix ?? 'mosaic/'}${source.slice(3)}`);
  } else {
    const path = existsSync(source) ? source : join(backupDir(), source);
    if (!existsSync(path)) throw new Error(`No backup at ${source}`);
    blob = readFileSync(path);
    const side = `${path}.sha256`;
    if (existsSync(side) && readFileSync(side, 'utf8').split(/\s+/)[0] !== sha256(blob)) throw new Error('Checksum mismatch');
  }
  const db = decrypt(blob, passphrase());
  if (!db.subarray(0, 16).equals(Buffer.from('SQLite format 3\0', 'binary'))) throw new Error('Decrypted file is not SQLite');
  writeFileSync(to, db, { mode: 0o600 });
  const check = new DatabaseSync(to, { readOnly: true });
  try {
    const row = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (row.integrity_check !== 'ok') throw new Error(`Integrity check failed: ${row.integrity_check}`);
  } finally {
    check.close();
  }
  return { path: to, bytes: db.length };
};
