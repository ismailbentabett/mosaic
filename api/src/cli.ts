// CLI used by cron, run.sh, health.sh and mosaic-connect.sh. Exit codes: 0 ok, 1 fail, 2 usage, 75 retry later.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, setSecret } from './config.ts';
import { getDb, kvGet, kvSet } from './db.ts';
import { iso, today, tomorrow } from './time.ts';
import { healthRun } from './health.ts';
import { push } from './ntfy.ts';
import { runOnce } from './claude.ts';
import { googleConnected, checkGoogle } from './google.ts';
import { sheetTabs, sheetValues, tab, rowsToObjects } from './sheet.ts';
import { logAction } from './log.ts';
import { setPassword, setOwnerEmail, emailSet, totpBegin, totpConfirm, setupMissing, recoveryLeft, listSessions, signOutAll } from './auth.ts';

const [cmd, ...args] = process.argv.slice(2);
const out = (s: string) => process.stdout.write(s + '\n');
const die = (msg: string, code = 1): never => { process.stderr.write(msg + '\n'); process.exit(code); };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const readStdin = async (): Promise<string> => {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
};

const m2 = {
  tasks: await import('./modules/tasks/store.ts'),
  food: await import('./modules/food/store.ts'),
  gym: await import('./modules/gym/store.ts'),
  money: await import('./modules/money/store.ts'),
  brain: await import('./modules/brain/store.ts'),
  imports: await import('./modules/imports.ts'),
};
/** All app tasks (open, done, dropped; not trashed) as CSV for the monthly export. */
const tasksCsv = (): string => {
  const cols = ['id', 'title', 'project_name', 'status', 'priority', 'due_date', 'due_time', 'tags', 'done_at', 'created_at'] as const;
  const cell = (v: unknown) => {
    const s = Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = m2.tasks.listTasks({ view: 'all', includeSubtasks: true, limit: 2000 });
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
};
/** `--name=value` flag, or undefined. */
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || undefined;
/** Read args[0] as UTF-8 (BOM stripped), run the importer, print its JSON result. */
const importFile = async (fn: (text: string, dryRun: boolean) => unknown): Promise<number> => {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) die(`usage: cli ${cmd} <file> [--dry-run]`, 2);
  const text = readFileSync(file!, 'utf8').replace(/^﻿/, '');
  m2.money.seedCategories();
  out(JSON.stringify(fn(text, args.includes('--dry-run'))));
  return 0;
};

const commands: Record<string, () => Promise<number>> = {
  async health() {
    const checks = await healthRun(args.includes('--boot'));
    for (const c of checks) out(`${c.level.padEnd(5)} ${c.id.padEnd(10)} ${c.message}${c.fix && c.level !== 'ok' ? `  · fix: ${c.fix}` : ''}`);
    return checks.some((c) => c.level === 'error') ? 1 : 0;
  },

  async push() {
    const [title, body, prio] = args;
    if (!title || !body) die('usage: cli push <title> <message> [priority 1-5]', 2);
    const p = Math.min(5, Math.max(1, Number(prio) || 3)) as 1 | 2 | 3 | 4 | 5;
    return (await push({ title, message: body, priority: p })) ? 0 : 1;
  },

  async 'job-start'() {
    const job = args[0];
    if (!job || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(job)) die('usage: cli job-start <job>', 2);
    const r = getDb().prepare('INSERT INTO job_runs (job, started) VALUES (?, ?)').run(job, iso());
    out(String(r.lastInsertRowid));
    return 0;
  },

  async 'job-end'() {
    const [job, runId, okArg, ...rest] = args;
    const id = Number(runId);
    if (!job || !Number.isInteger(id) || id <= 0) die('usage: cli job-end <job> <run_id> <0|1> <message>', 2);
    getDb().prepare('UPDATE job_runs SET ended = ?, ok = ?, message = ? WHERE id = ? AND job = ?')
      .run(iso(), okArg === '1' ? 1 : 0, rest.join(' ').slice(0, 500), id, job);
    // keep the table small
    getDb().prepare("DELETE FROM job_runs WHERE started < ?").run(iso(new Date(Date.now() - 90 * 86400000)));
    return 0;
  },

  async nightly() {
    const day = today();
    const done = getDb().prepare("SELECT id FROM job_runs WHERE job = 'nightly' AND ok = 1 AND substr(ended, 1, 10) = ? LIMIT 1").get(day);
    if (done && !args.includes('--force')) { out('nightly: already planned today'); return 0; }
    let prompt: string;
    try { prompt = readFileSync(join(ROOT, 'scheduled', 'nightly-plan.prompt.txt'), 'utf8'); }
    catch { return die('nightly: scheduled/nightly-plan.prompt.txt missing'); }
    prompt = prompt.replaceAll('{{TODAY}}', day).replaceAll('{{TOMORROW}}', tomorrow());
    out(`nightly: planning ${tomorrow()}`);
    const r = await runOnce(prompt, 'Nightly plan', { source: 'nightly', waitForLockMs: 10 * 60_000 });
    if (r.ok) { out(`nightly: ok · ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`); return 0; }
    out(`nightly: ${r.error ?? 'failed'}${r.limitResetAt ? ` (limit resets ${r.limitResetAt})` : ''}`);
    if (r.limitResetAt || /busy|conflict|another run|limit/i.test(r.error ?? '')) {
      if (process.env.RUN_FINAL === '1') {
        await push({ title: 'Tomorrow not planned', message: 'Mosaic was busy or at its usage limit. Open Chat and say "plan tomorrow".', priority: 4, cat: 'nightly', key: 'nightly' });
        return 1;
      }
      return 75;
    }
    return 1;
  },

  async export() {
    const dir = args[0];
    if (!dir) die('usage: cli export <dir>', 2);
    mkdirSync(dir, { recursive: true });
    let failed = 0;
    try { writeFileSync(join(dir, 'tasks.csv'), tasksCsv()); out('tasks.csv'); }
    catch (e) { failed++; process.stderr.write(`tasks export failed: ${msg(e)}\n`); }
    if (googleConnected()) {
      try {
        for (const t of await sheetTabs()) {
          const rows = await sheetValues(tab(t.title));
          const csv = rows.map((r) => r.map((v) => (/[",\r\n]/.test(v ?? '') ? `"${String(v).replace(/"/g, '""')}"` : v ?? '')).join(',')).join('\r\n') + '\r\n';
          const name = `sheet-${t.title.replace(/[^A-Za-z0-9+_-]+/g, '_')}.csv`;
          writeFileSync(join(dir, name), csv);
          out(name);
        }
      } catch (e) { failed++; process.stderr.write(`sheet export failed: ${msg(e)}\n`); }
    } else { failed++; process.stderr.write('sheet export skipped: Google not connected\n'); }
    return failed ? 1 : 0;
  },

  async 'weekly-review-task'() {
    const day = today();
    if (kvGet('weekly-review-task') === day) { out('already created today'); return 0; }
    const t = m2.tasks.addTask({ title: 'Weekly review', project: 'Admin', due_date: day, due_time: '14:30', source: 'cron',
      notes: 'Sunday 🗓️ Weekly review: run /weekly-review, then one build batch.', priority: 2 });
    kvSet('weekly-review-task', day);
    logAction('cron', 'weekly_review_task', `#${t.id}`);
    out(`created #${t.id}`);
    return 0;
  },

  async 'oneoff-task'() {
    const [title, description] = args;
    if (!title) die('usage: cli oneoff-task <title> [description]', 2);
    const key = `oneoff:${title}`;
    if (kvGet(key)) { out('already created'); return 0; }
    const t = m2.tasks.addTask({ title: title.slice(0, 250), project: 'Admin', due_date: today(), due_time: '18:00', notes: description ?? '', priority: 3, source: 'cron' });
    kvSet(key, iso());
    logAction('cron', 'oneoff_task', `#${t.id} ${title}`);
    out(`created #${t.id}`);
    return 0;
  },

  /** Copy the retired Sheet Tasks and Inbox tabs into app tasks. Idempotent per row. Never edits the Sheet. */
  async 'migrate-sheet'() {
    const dry = args.includes('--dry-run');
    if (!googleConnected()) die('Google not connected. Run mosaic-connect google first.');
    const tabs = (await sheetTabs()).map((t) => t.title);
    let made = 0, skipped = 0;
    for (const [name, project] of [['Inbox', 'Inbox'], ['Tasks', 'Inbox']] as const) {
      const real = tabs.find((t) => t === name) ?? tabs.find((t) => t === `${name} (old)`);
      if (!real) { out(`${name}: tab not found, skipped`); continue; }
      const rows = await sheetValues(tab(real));
      const headerAt = rows.findIndex((r) => r.some((c) => /^(task|title|item|text)$/i.test((c ?? '').trim())));
      if (headerAt < 0) { out(`${real}: no header row with task/title/item/text, skipped`); continue; }
      const objs = rowsToObjects(rows.slice(headerAt));
      for (let i = 0; i < objs.length; i++) {
        const o = Object.fromEntries(Object.entries(objs[i]).map(([k, v]) => [k.toLowerCase().trim(), (v ?? '').trim()]));
        const title = o.task || o.title || o.item || o.text;
        if (!title) continue;
        const status = (o.status || o.done || '').toLowerCase();
        if (/^(done|x|true|yes|✅)$/.test(status)) { skipped++; continue; }
        const rowNo = headerAt + i + 2;
        const key = `migrated:${name}:${rowNo}`;
        if (kvGet(key)) { skipped++; continue; }
        const due = /^\d{4}-\d{2}-\d{2}$/.test(o.due || o.date || '') ? (o.due || o.date) : null;
        const desc = [o.notes || o.note || '', `From Sheet ${real} row ${rowNo}.`].filter(Boolean).join('\n');
        if (dry) { out(`[dry] ${real}#${rowNo} → ${project}: ${title}`); made++; continue; }
        const t = m2.tasks.addTask({ title: title.slice(0, 250), project: project === 'Inbox' ? undefined : project, due_date: due, notes: desc, source: 'sheet' });
        kvSet(key, String(t.id));
        made++;
        out(`${real}#${rowNo} → #${t.id} ${title}`);
      }
    }
    out(`${dry ? 'would create' : 'created'} ${made}, skipped ${skipped}`);
    if (!dry) logAction('cli', 'migrate_sheet', `created ${made}`);
    return 0;
  },

  /** New app password on stdin. Stores only a scrypt hash and signs out every session. */
  async password() {
    const pw = (await readStdin()).replace(/[\r\n]+$/, '');
    if (!pw) die('no password on stdin', 2);
    try { setPassword(pw); } catch (e) { die((e as Error).message, 2); }
    out('App password set. All sessions signed out.');
    return 0;
  },

  /** The only email that can sign in. Signs out every session. */
  async 'owner-email'() {
    const e = args[0] ?? (await readStdin()).trim();
    if (!e) die('usage: cli owner-email <email>', 2);
    try { setOwnerEmail(e); } catch (err) { die((err as Error).message, 2); }
    out('Owner email set. All sessions signed out.');
    return 0;
  },

  /** Step 1 of 2FA: new pending secret for the authenticator app. */
  async '2fa-setup'() {
    if (!emailSet()) die('Set the owner email first: cli owner-email <email>', 2);
    const { key, uri } = totpBegin();
    out('Authenticator app (Google Authenticator, Aegis, 2FAS, Authy…): Add account → Enter a setup key.');
    out(`  Account: Mosaic   Key: ${key}   Type: Time-based`);
    out(`  Or paste this link into an app that accepts otpauth links:\n  ${uri}`);
    out('Then run: cli 2fa-confirm <6-digit code from the app>');
    return 0;
  },

  /** Step 2 of 2FA: confirm a code, activate, print recovery codes once. */
  async '2fa-confirm'() {
    const code = args[0] ?? (await readStdin()).trim();
    if (!code) die('usage: cli 2fa-confirm <6-digit code>', 2);
    let codes: string[] = [];
    try { codes = totpConfirm(code); } catch (err) { die((err as Error).message, 1); }
    out('2FA is on. All sessions signed out.');
    out('Recovery codes (each works once instead of a 6-digit code). Save them in your password manager now; they are not shown again:');
    for (const c of codes) out(`  ${c}`);
    logAction('cli', '2fa_on', '');
    return 0;
  },

  async 'auth-status'() {
    const missing = setupMissing();
    out(missing.length ? `locked · missing: ${missing.join(', ')}` : `ready · recovery codes left: ${recoveryLeft()}`);
    return missing.length ? 1 : 0;
  },

  async sessions() {
    const s = listSessions();
    if (!s.length) out('no sessions');
    for (const r of s) out(`${r.last_seen.slice(0, 16)}  until ${r.expires.slice(0, 10)}  ${r.agent ?? ''}`);
    return 0;
  },

  async 'signout-all'() {
    signOutAll();
    out('All sessions signed out.');
    logAction('cli', 'signout_all', '');
    return 0;
  },

  // ---------- Phase 2 imports (each: <file> [--dry-run]; prints JSON counts) ----------
  /** Fill the app with known life facts, goals, habits and dates. Idempotent. [file] [--dry-run] */
  async 'import-life'() {
    const dryRun = args.includes('--dry-run');
    const file = args.find((a) => !a.startsWith('--')) ?? new URL('../data/demo-seed.json', import.meta.url);
    const { importLife } = await import('./modules/lifeseed.ts');
    out(JSON.stringify(importLife(JSON.parse(readFileSync(file, 'utf8')), dryRun), null, 2));
    return 0;
  },
  /** Write the quarter review to vault Reviews/YYYY-Qn.md. [--dry-run] prints it instead. */
  async 'quarter-export'() {
    const { quarterReport } = await import('./modules/grades/store.ts');
    const r = quarterReport(undefined, !args.includes('--dry-run'));
    out(args.includes('--dry-run') ? r.content : `Wrote ${r.path} (${r.weeks} weeks, ${r.milestones} milestones, ${r.goals} goals).`);
    return 0;
  },
  async 'import-tasks-csv'() { return importFile((csv, d) => m2.tasks.importTaskCsv(csv, d)); },
  async 'import-foods'() {
    const src = (args.find((a) => a.startsWith('--source='))?.slice(9) ?? 'own') as 'ciqual' | 'usda' | 'off' | 'own' | 'estimated';
    return importFile((csv, d) => m2.food.importFoodsCsv(csv, src, d));
  },
  async 'import-exercises'() { return importFile((txt, d) => m2.gym.importExercises(JSON.parse(txt), d)); },
  async 'import-strong'() { return importFile((csv, d) => m2.gym.importStrong(csv, d, args.includes('--lb') ? 'lb' : 'kg')); },
  async 'import-hevy'() { return importFile((csv, d) => m2.gym.importHevy(csv, d)); },
  async 'import-mfp'() { return importFile((csv, d) => m2.food.importMfp(csv, d)); },
  async 'import-wallet'() { return importFile((csv, d) => m2.money.importWallet(csv, d)); },
  async 'import-todoist'() { return importFile((csv, d) => m2.imports.importTodoist(csv, { project: flag('project'), dryRun: d })); },
  async 'import-ynab'() { return importFile((csv, d) => m2.imports.importYnab(csv, { currency: flag('currency'), dryRun: d })); },
  async 'scan-vault'() { out(JSON.stringify(m2.brain.scanVault())); return 0; },
  /** Encrypted snapshot of app.db to BACKUP_DIR and, when MOSAIC_S3_* is set, to the bucket. See docs/BACKUPS.md. */
  async backup() {
    const b = await import('./backup/index.ts');
    out(JSON.stringify(await b.createBackup(), null, 2));
    return 0;
  },
  async 'backup-list'() {
    const b = await import('./backup/index.ts');
    out(JSON.stringify(await b.listBackups(), null, 2));
    return 0;
  },
  /** plugins: load MOSAIC_PLUGINS_DIR, apply pending plugin migrations, print what loaded and what failed. */
  async plugins() {
    const p = await import('./plugins/index.ts');
    await p.loadPlugins();
    const d = p.describePlugins();
    out(JSON.stringify(d, null, 2));
    return d.failed.length ? 1 : 0;
  },
  /** restore <name | path | s3:name> --to <new.db>: decrypt + integrity check into a new file; never touches the live DB. */
  async restore() {
    const b = await import('./backup/index.ts');
    const to = args[args.indexOf('--to') + 1];
    const src = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--to');
    if (!src || !args.includes('--to') || !to) die('usage: cli restore <name|path|s3:name> --to <new.db>', 2);
    out(JSON.stringify(await b.restoreBackup(src!, to)));
    return 0;
  },
  async 'seed-local-foods'() { const x = await import('./modules/extras/store.ts'); out(JSON.stringify(x.seedLocalFoods())); return 0; },
  // Screen-time ingest token: printed once for the device sync scripts; only its sha256 is stored. `--revoke` closes ingest.
  async 'ingest-token'() {
    if (args.includes('--revoke')) { setSecret('MOSAIC_INGEST_HASH', null); out('Ingest token revoked. Screen-time sync is closed.'); return 0; }
    const { randomBytes } = await import('node:crypto');
    const { hashToken } = await import('./modules/screentime/store.ts');
    const token = randomBytes(32).toString('base64url');
    setSecret('MOSAIC_INGEST_HASH', hashToken(token));
    out('New ingest token (shown once; put it in the device env MOSAIC_INGEST_TOKEN, nowhere else; older token stops working):');
    out(token);
    return 0;
  },
  async purge() {
    const days = Number(args[0]) || 30;
    out(JSON.stringify(m2.tasks.purgeTasks(days)));
    return 0;
  },

  async 'google-status'() {
    if (!googleConnected()) { out('Google: not connected'); return 1; }
    const r = await checkGoogle();
    out(`Google: ${r.message}`);
    return r.ok ? 0 : 1;
  },

  async status() {
    out(`google: ${googleConnected() ? 'connected' : 'not connected'}`);
    return 0;
  },
};

const fn = cmd ? commands[cmd] : undefined;
if (!fn) die(`usage: cli <${Object.keys(commands).join('|')}> …`, 2);
try {
  process.exitCode = await fn!();
} catch (e) {
  process.stderr.write(`${cmd}: ${msg(e)}\n`);
  process.exitCode = 1;
}
// claude.ts / timers may hold handles; exit once the command is done.
setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
process.on('beforeExit', () => process.exit(process.exitCode ?? 0));
