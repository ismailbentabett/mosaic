// Self-hosted app updates. The apps are never in a store: `npm run release` (app/web/release.mjs) builds the
// Android APK and the Windows installer and uploads them with latest.json to DATA_DIR/releases on the VPS.
// The apps ask GET /api/app/update on launch and every 30 min, then download the file and install it.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import { fail } from './errors.ts';

export type Platform = 'android' | 'windows';
export type ReleaseFile = { file: string; size: number; sha256: string };
export type Release = { version: string; notes: string; date: string; android?: ReleaseFile; windows?: ReleaseFile };

export const PLATFORMS: Platform[] = ['android', 'windows'];
export const releasesDir = () => join(DATA_DIR, 'releases');

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FILE: Record<Platform, RegExp> = { android: /^[A-Za-z0-9._-]{1,120}\.apk$/, windows: /^[A-Za-z0-9._-]{1,120}\.exe$/ };
const SHA = /^[0-9a-f]{64}$/;

const isPlatform = (p: string): p is Platform => (PLATFORMS as string[]).includes(p);

/** -1, 0 or 1. Plain x.y.z only. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function cleanFile(p: Platform, v: unknown): ReleaseFile | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const file = String(r.file ?? '');
  const sha256 = String(r.sha256 ?? '').toLowerCase();
  if (!FILE[p].test(file) || !SHA.test(sha256)) return undefined;
  const path = join(releasesDir(), file);
  if (!existsSync(path)) return undefined;
  // The size on disk wins: a half-uploaded file never matches the manifest.
  const size = statSync(path).size;
  if (Number(r.size) !== size) return undefined;
  return { file, size, sha256 };
}

/** The published release, or null when none is published or latest.json is broken. */
export function latestRelease(): Release | null {
  const path = join(releasesDir(), 'latest.json');
  if (!existsSync(path)) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  const version = String(raw.version ?? '');
  if (!VERSION.test(version)) return null;
  const out: Release = {
    version,
    notes: String(raw.notes ?? '').slice(0, 2000),
    date: String(raw.date ?? '').slice(0, 40),
  };
  for (const p of PLATFORMS) {
    const f = cleanFile(p, raw[p]);
    if (f) out[p] = f;
  }
  return out;
}

/** What GET /api/app/update returns. `url` is relative to the API origin. */
export function updateInfo() {
  const r = latestRelease();
  if (!r) return { version: null };
  const files: Partial<Record<Platform, ReleaseFile & { url: string }>> = {};
  for (const p of PLATFORMS) {
    const f = r[p];
    if (f) files[p] = { ...f, url: `/api/app/update/${p}` };
  }
  return { version: r.version, notes: r.notes, date: r.date, ...files };
}

/** The installer bytes for one platform. */
export function releaseBytes(platform: string): { file: ReleaseFile; bytes: Buffer } {
  if (!isPlatform(platform)) return fail('not_found', 'No such platform. Use android or windows.');
  const f = latestRelease()?.[platform];
  if (!f) return fail('not_found', `No ${platform} build is published yet.`);
  return { file: f, bytes: readFileSync(join(releasesDir(), f.file)) };
}
