// Settings: env vars first, then $MOSAIC_ROOT/services/config.env (non-secret), then defaults.
// Secrets: env vars first, then $MOSAIC_SECRETS (default ~/.config/mosaic/secrets.env, mode 600). Secrets are never logged.
// Every external integration (Google, ntfy, Claude) is optional: unset means that feature reports "not connected".
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const parseEnv = (text: string) => {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
};
const readEnv = (p: string) => (existsSync(p) ? parseEnv(readFileSync(p, 'utf8')) : {});

export const ROOT = process.env.MOSAIC_ROOT || join(homedir(), 'mosaic');
export const SECRETS_PATH = process.env.MOSAIC_SECRETS || join(homedir(), '.config', 'mosaic', 'secrets.env');
export const DATA_DIR = process.env.MOSAIC_DATA || join(homedir(), '.local', 'share', 'mosaic');
export const DEV = process.env.MOSAIC_DEV === '1';

const fileCfg = readEnv(join(ROOT, 'services', 'config.env'));
let secrets: Record<string, string> = readEnv(SECRETS_PATH);

/** Non-secret setting: env var wins, then services/config.env, then fallback. */
export const cfg = (key: string, fallback = '') => process.env[key] ?? fileCfg[key] ?? fallback;

/** Secret: env var wins (tests), then secrets.env. Re-read each call so mosaic-connect changes apply live. */
export const secret = (key: string): string | undefined => {
  if (process.env[key]) return process.env[key];
  secrets = readEnv(SECRETS_PATH);
  return secrets[key] || undefined;
};

/** Atomic update of one key in secrets.env (tmp + rename, mode 600). null removes it. Value never logged. */
export const setSecret = (key: string, value: string | null) => {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error('bad secret key');
  if (value !== null && /[\r\n]/.test(value)) throw new Error('secret has a newline');
  mkdirSync(dirname(SECRETS_PATH), { recursive: true, mode: 0o700 });
  const lines = existsSync(SECRETS_PATH) ? readFileSync(SECRETS_PATH, 'utf8').split(/\r?\n/) : [];
  const kept = lines.filter((l) => l.trim() !== '' && !l.startsWith(`${key}=`));
  if (value !== null) kept.push(`${key}=${value}`);
  const tmp = `${SECRETS_PATH}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, kept.join('\n') + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, SECRETS_PATH);
  secrets = readEnv(SECRETS_PATH);
};

export const PORT = Number(cfg('MOSAIC_API_PORT', '8787'));
export const PUBLIC_URL = cfg('MOSAIC_PUBLIC_URL', 'http://localhost:8787');
export const VAULT = process.env.MOSAIC_VAULT || join(ROOT, 'vault');
export const WEB_DIST = process.env.MOSAIC_WEB_DIST || join(ROOT, 'app', 'web', 'dist');
export const LOG_DIR = join(ROOT, 'logs');

