// Health checks. Run by `cli health` every 10 min and read by GET /api/status.
// Results are stored in the `checks` table; a push goes out only when a check changes level.
import { statSync, readdirSync, readFileSync, existsSync, statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cfg, secret, ROOT } from './config.ts';
import { getDb } from './db.ts';
import { iso, today, addDays, dowOf } from './time.ts';
import { checkGoogle } from './google.ts';
import { listConflicts } from './notes.ts';
import { lastRunAuth } from './claude.ts';
import { push, cancelHeld } from './ntfy.ts';
import { BACKUP_RE, backupDir } from './backup/index.ts';

export type Level = 'ok' | 'warn' | 'error';
export type Check = { id: string; label: string; ok: boolean; level: Level; message: string; fix: string | null; since: string };
type Result = { id: string; label: string; level: Level; message: string; fix?: string | null };

const ping = async (url: string, ms = 4000) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.ok ? null : `HTTP ${r.status}`;
  } catch (e) {
    return (e as Error).name === 'TimeoutError' ? 'timeout' : 'not reachable';
  }
};

const unitActive = (unit: string) => {
  try {
    return execFileSync('systemctl', ['--user', 'is-active', unit], { encoding: 'utf8', timeout: 4000 }).trim() === 'active';
  } catch { return false; }
};
const hasClaude = () => existsSync(join(process.env.HOME || '', '.local', 'bin', 'claude'));

const lastJob = (job: string) =>
  getDb().prepare('SELECT started, ended, ok, message FROM job_runs WHERE job = ? AND ended IS NOT NULL ORDER BY id DESC LIMIT 1')
    .get(job) as { started: string; ended: string; ok: number; message: string } | undefined;

/** Each check is independent; a thrown error becomes an error result, never a crash. */
const CHECKS: Array<() => Promise<Result> | Result> = [
  async () => {
    const e = await ping(`http://127.0.0.1:${cfg('NTFY_PORT', '2586')}/v1/health`);
    return { id: 'ntfy', label: 'Pushes (ntfy)', level: e ? 'error' : 'ok', message: e ? `ntfy ${e}` : 'ntfy up',
      fix: e ? 'On the VPS: cd ~/mosaic/services && sg docker -c "docker compose up -d ntfy"' : null };
  },
  async () => {
    const e = await ping(`http://127.0.0.1:${cfg('SYNCTHING_GUI_PORT', '8384')}/rest/noauth/health`);
    return { id: 'syncthing', label: 'Sync (Syncthing)', level: e ? 'error' : 'ok', message: e ? `Syncthing ${e}` : 'Syncthing up',
      fix: e ? 'On the VPS: cd ~/mosaic/services && sg docker -c "docker compose up -d syncthing"' : null };
  },
  async () => {
    const c = await listConflicts();
    return { id: 'conflicts', label: 'Note conflicts', level: c.length ? 'warn' : 'ok',
      message: c.length ? `${c.length} note conflict${c.length > 1 ? 's' : ''}` : 'No conflicts',
      fix: c.length ? 'Open Notes → Conflicts and pick a version' : null };
  },
  async () => {
    const r = await checkGoogle();
    return { id: 'google', label: 'Google Calendar + Sheet', level: r.ok ? 'ok' : 'error', message: r.message,
      fix: r.ok ? null : 'Settings → Connect Google' };
  },
  () => {
    if (!hasClaude()) return { id: 'claude', label: 'Claude on the VPS', level: 'warn', message: 'Claude Code not installed',
      fix: 'bash ~/mosaic/scheduled/mosaic-connect.sh claude' };
    const auth = lastRunAuth();
    if (auth && !auth.ok) return { id: 'claude', label: 'Claude on the VPS', level: 'error', message: auth.message,
      fix: 'bash ~/mosaic/scheduled/mosaic-connect.sh claude' };
    if (!unitActive('claude-remote')) return { id: 'claude', label: 'Claude on the VPS', level: 'warn',
      message: 'Remote Control not running', fix: 'systemctl --user restart claude-remote' };
    return { id: 'claude', label: 'Claude on the VPS', level: 'ok', message: 'Claude ready' };
  },
  () => {
    const s = statfsSync(ROOT);
    const used = 1 - s.bavail / s.blocks;
    const pct = Math.round(used * 100);
    return { id: 'disk', label: 'Disk', level: pct >= 90 ? 'error' : pct >= 80 ? 'warn' : 'ok', message: `Disk ${pct}% used`,
      fix: pct >= 80 ? 'Check the backup folder (MOSAIC_BACKUP_KEEP) and docker images (docker image prune)' : null };
  },
  () => {
    const dir = backupDir();
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort() : [];
    const fix = 'node dist/cli.js backup (schedule it daily; see docs/BACKUPS.md)';
    if (!files.length) return { id: 'backup', label: 'Backup', level: 'error', message: 'No backup yet', fix };
    const last = join(dir, files[files.length - 1]);
    const ageH = (Date.now() - statSync(last).mtimeMs) / 3600000;
    if (ageH > 26) return { id: 'backup', label: 'Backup', level: 'error', message: `Last backup ${Math.round(ageH)} h old`, fix };
    const sumFile = `${last}.sha256`;
    if (existsSync(sumFile)) {
      const want = readFileSync(sumFile, 'utf8').trim().split(/\s+/)[0];
      const got = createHash('sha256').update(readFileSync(last)).digest('hex');
      if (want !== got) return { id: 'backup', label: 'Backup', level: 'error', message: 'Last backup checksum mismatch', fix };
    }
    return { id: 'backup', label: 'Backup', level: 'ok', message: `Last backup ${Math.round(ageH)} h ago` };
  },
  () => {
    // Nightly runs Sat–Thu evenings. After 23:45 on those days we expect a success for today.
    const r = lastJob('nightly');
    const fix = 'Chat → Plan tomorrow';
    if (!r) return { id: 'nightly', label: 'Nightly plan', level: 'ok', message: 'No nightly run yet' };
    if (!r.ok) return { id: 'nightly', label: 'Nightly plan', level: 'error', message: `Nightly plan failed: ${r.message || 'see logs/nightly.log'}`, fix };
    const d = today();
    const expectedLast = dowOf(d) === 5 ? addDays(d, -1) : d; // no run Friday night
    const now = iso();
    const lateEnough = now.slice(11, 16) >= '23:45';
    if (lateEnough && r.ended.slice(0, 10) < expectedLast)
      return { id: 'nightly', label: 'Nightly plan', level: 'warn', message: 'Tomorrow not planned yet', fix };
    return { id: 'nightly', label: 'Nightly plan', level: 'ok', message: `Last plan ${r.ended.slice(0, 16).replace('T', ' ')}` };
  },
];

export const runChecks = async (): Promise<Check[]> => {
  const results = await Promise.all(CHECKS.map(async (c, i) => {
    try { return await c(); } catch (e) {
      return { id: `check${i}`, label: 'Check', level: 'error' as Level, message: (e as Error).message.slice(0, 200), fix: null };
    }
  }));
  const db = getDb();
  const now = iso();
  const changed: Check[] = [];
  const out: Check[] = [];
  for (const r of results) {
    const prev = db.prepare('SELECT level, since FROM checks WHERE id = ?').get(r.id) as { level: Level; since: string } | undefined;
    const since = prev && prev.level === r.level ? prev.since : now;
    db.prepare(`INSERT INTO checks (id, label, level, message, fix, since) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label, level=excluded.level, message=excluded.message, fix=excluded.fix, since=excluded.since`)
      .run(r.id, r.label, r.level, r.message, r.fix ?? null, since);
    const c: Check = { ...r, fix: r.fix ?? null, ok: r.level === 'ok', since };
    out.push(c);
    if (!prev ? r.level !== 'ok' : prev.level !== r.level) changed.push(c);
  }
  return Object.assign(out, { changed });
};

/**
 * Run checks and push only what changed (state flips). Pushes go to the ops channel through ntfy's
 * quiet() gate, so nothing arrives during sleep, Zero/Family mode or (below priority 4) Saturday;
 * held pushes arrive at the next waking moment. One key per check: a check that flaps all night leaves
 * at most one held push, and one that broke and fixed itself while held sends nothing.
 * Plain words only; the fix lives in Settings → Checks, never a shell command on the lock screen.
 */
export const healthRun = async (boot = false) => {
  const checks = (await runChecks()) as Check[] & { changed: Check[] };
  if (boot) {
    // A reboot alone is not news. Speak only when something is broken after it.
    const bad = checks.filter((c) => c.level === 'error');
    if (bad.length) await push({ title: 'Mosaic: needs a look after restart', message: `${bad.map((c) => c.label).join(', ')}. Open Settings → Checks.`,
      priority: 4, channel: 'ops', key: 'health:boot' });
    return checks;
  }
  for (const c of checks.changed) {
    const key = `health:${c.id}`;
    if (c.level === 'ok') {
      if (cancelHeld(key)) continue; // broke and fixed while held: he never needs to hear about it
      await push({ title: `Mosaic: ${c.label} fixed`, message: c.message, priority: 2, channel: 'ops', key });
    } else {
      await push({ title: `Mosaic: ${c.label} ${c.level === 'error' ? 'broken' : 'warning'}`,
        message: c.fix ? `${c.message} Open Settings → Checks.` : c.message, priority: c.level === 'error' ? 4 : 3, channel: 'ops', key });
    }
  }
  return checks;
};

/** Stored results for GET /api/status (no live probing on every page load). */
export const storedStatus = () => {
  const rows = getDb().prepare('SELECT id, label, level, message, fix, since FROM checks ORDER BY id').all() as Omit<Check, 'ok'>[];
  const checks: Check[] = rows.map((r) => ({ ...r, ok: r.level === 'ok' }));
  const order: Level[] = ['ok', 'warn', 'error'];
  const overall = checks.reduce<Level>((a, c) => (order.indexOf(c.level) > order.indexOf(a) ? c.level : a), 'ok');
  const updated = getDb().prepare('SELECT MAX(since) AS m FROM checks').get() as { m: string | null };
  // errors first, then warnings
  checks.sort((a, b) => order.indexOf(b.level) - order.indexOf(a.level));
  return { overall, checks, updatedAt: updated.m ?? null };
};
