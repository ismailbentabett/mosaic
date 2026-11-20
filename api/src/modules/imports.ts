// Third-party CSV importers: Todoist (tasks) and YNAB (money). MyFitnessPal lives in food/store.ts (importMfp).
// Every importer is idempotent (a stable hash per row), supports dry_run, and returns
// { rows, created, skipped, errors, dryRun } so the API, CLI, MCP and app all report the same thing.
import { createHash } from 'node:crypto';
import { AppError } from '../errors.ts';
import { insert, one, parseCsv, round, uuid, type Row } from './util.ts';
import { addTask, ensureProject } from './tasks/store.ts';
import { addAccount, findCategory, getAccount, rateFor } from './money/store.ts';

export type ImportResult = { rows: number; created: number; skipped: number; errors: string[]; dryRun: boolean; [k: string]: unknown };

const sha = (s: string) => createHash('sha1').update(s).digest('hex');
const bad = (m: string): never => { throw new AppError('bad_request', m); };
/** Case- and space-insensitive column lookup: "Category Group/Category" == "category group/category". */
const col = (r: Row, ...names: string[]) => {
  const keys = Object.keys(r);
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase().replace(/\s+/g, ' ').trim() === n);
    if (k !== undefined && String(r[k] ?? '').trim() !== '') return String(r[k]).trim();
  }
  return '';
};
const hasCol = (r: Row, name: string) => Object.keys(r).some((k) => k.toLowerCase().trim() === name);

// ---------------------------------------------------------------- Todoist

/** Todoist priority 1 (urgent, p1) … 4 (none) → Mosaic 3 … 0. */
const TD_PRIORITY: Record<string, number> = { '1': 3, '2': 2, '3': 1, '4': 0 };

/**
 * Todoist "Export as CSV" (one file per project). Columns: TYPE, CONTENT, DESCRIPTION, PRIORITY, INDENT, DATE …
 * - TYPE section sets the section for the tasks under it; note rows are appended to the previous task's notes.
 * - INDENT > 1 makes the row a subtask of the nearest shallower task.
 * - Inline @labels become tags. An ISO DATE becomes due_date; free-text dates ("every monday") go into notes.
 */
export const importTodoist = (csv: string, opts: { project?: string; dryRun?: boolean } = {}): ImportResult => {
  const rows = parseCsv(csv);
  if (!rows.length || !hasCol(rows[0], 'type') || !hasCol(rows[0], 'content')) bad('Not a Todoist export: needs TYPE and CONTENT columns');
  const dryRun = !!opts.dryRun;
  const project = (opts.project ?? 'Inbox').trim().slice(0, 80) || 'Inbox';
  if (!dryRun) ensureProject(project);
  let created = 0, skipped = 0, section: string | null = null;
  const errors: string[] = [];
  const stack: { indent: number; id: string }[] = []; // ancestors by indent
  let last: { id: string; notes: string[] } | null = null;
  const pending: { row: number; notes: string[]; task: Parameters<typeof addTask>[0] }[] = [];

  rows.forEach((r, i) => {
    const type = col(r, 'type').toLowerCase();
    const content = col(r, 'content');
    if (type === 'section') { section = content.slice(0, 80) || null; stack.length = 0; return; }
    if (type === 'note') { if (last && content) last.notes.push(content); return; }
    if (type !== 'task') return; // meta rows (view_style …)
    if (!content) { errors.push(`row ${i + 2}: empty task`); return; }

    const tags = [...content.matchAll(/(?:^|\s)@([\p{L}\p{N}_-]{1,40})/gu)].map((m) => m[1].toLowerCase());
    const title = content.replace(/(?:^|\s)@[\p{L}\p{N}_-]{1,40}/gu, '').replace(/\s+/g, ' ').trim().slice(0, 250) || content.slice(0, 250);
    const indent = Math.max(1, Number(col(r, 'indent')) || 1);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = indent > 1 ? stack[stack.length - 1]?.id ?? null : null;
    const date = col(r, 'date');
    const isoDate = /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null;
    const notes = [col(r, 'description'), date && !isoDate ? `Todoist date: ${date}` : ''].filter(Boolean);
    const id = 'td-' + sha(`${project}|${section ?? ''}|${parent ?? ''}|${content}`).slice(0, 24);
    stack.push({ indent, id });

    if (one(`SELECT id FROM tasks WHERE id = ?`, id)) { skipped++; last = null; return; }
    last = { id, notes };
    pending.push({ row: i + 2, notes, task: { id, title, project, section, parent_id: parent, tags, priority: TD_PRIORITY[col(r, 'priority')] ?? 0, due_date: isoDate } });
  });

  // Note rows arrive after their task, so tasks are written once the whole file is read (parents first: file order).
  for (const p of pending) {
    if (dryRun) { created++; continue; }
    try {
      addTask({ ...p.task, notes: p.notes.join('\n\n') || undefined, source: 'import-todoist' });
      created++;
    } catch (e) { errors.push(`row ${p.row}: ${(e as Error).message}`); }
  }
  return { rows: rows.length, created, skipped, errors: errors.slice(0, 20), dryRun, project };
};

// ---------------------------------------------------------------- YNAB

/** "$1,234.56", "1.234,56 €", "(12.00)", "-3" → number. Empty → 0. */
export const parseMoney = (s: string): number => {
  let t = String(s ?? '').trim();
  if (!t) return 0;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t) || /-$/.test(t);
  t = t.replace(/[^\d.,]/g, '');
  if (!t) return NaN;
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else t = t.replace(/,/g, ''); // 1,234.56
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
};

/** Pick MM/DD/YYYY or DD/MM/YYYY for the whole file: any first part > 12 means day-first. ISO passes through. */
const dateOrder = (dates: string[]): 'mdy' | 'dmy' => {
  for (const d of dates) { const m = d.match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/); if (m && Number(m[1]) > 12) return 'dmy'; }
  return 'mdy';
};
const toIso = (d: string, order: 'mdy' | 'dmy'): string | null => {
  const s = d.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const [mo, dd] = order === 'mdy' ? [a, b] : [b, a];
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso + 'T00:00:00Z')) ? null : iso;
};

/**
 * YNAB "Export budget" → Register.csv. Columns: Account, Flag, Date, Payee, Category Group/Category, Memo, Outflow, Inflow, Cleared.
 * Transfers ("Transfer : …" payees) are skipped and counted: both sides are in the file, and a one-sided import would double count.
 * Missing accounts are created in `currency` (default USD). "Inflow: Ready to Assign" rows become uncategorised income.
 */
export const importYnab = (csv: string, opts: { currency?: string; dryRun?: boolean } = {}): ImportResult => {
  const rows = parseCsv(csv);
  if (!rows.length || !hasCol(rows[0], 'account') || !(hasCol(rows[0], 'outflow') || hasCol(rows[0], 'inflow'))) {
    bad('Not a YNAB register: needs Account and Outflow/Inflow columns');
  }
  const dryRun = !!opts.dryRun;
  const currency = (opts.currency ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) bad('currency must be a 3-letter code');
  const order = dateOrder(rows.map((r) => col(r, 'date')));
  let created = 0, skipped = 0, transfers = 0;
  const errors: string[] = [];
  const seen = new Map<string, number>(); // identical rows on one day are real (two coffees): number them

  rows.forEach((r, i) => {
    const account = col(r, 'account').slice(0, 80);
    const payee = col(r, 'payee');
    if (!account) { errors.push(`row ${i + 2}: no account`); return; }
    if (/^transfer\s*:/i.test(payee)) { transfers++; return; }
    const day = toIso(col(r, 'date'), order);
    if (!day) { errors.push(`row ${i + 2}: bad date`); return; }
    const out = parseMoney(col(r, 'outflow')), inn = parseMoney(col(r, 'inflow'));
    if (Number.isNaN(out) || Number.isNaN(inn)) { errors.push(`row ${i + 2}: bad amount`); return; }
    const net = round(inn - out, 2);
    if (net === 0) { skipped++; return; }

    const catRaw = col(r, 'category group/category', 'category');
    const group = col(r, 'category group');
    const cat = catRaw.includes('/') || !group ? catRaw : `${group}/${catRaw}`;
    const memo = col(r, 'memo');
    const base = `${account}|${day}|${payee}|${cat}|${memo}|${net}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const ref = 'ynab:' + sha(`${base}|${n}`).slice(0, 20);
    if (one(`SELECT id FROM records WHERE import_ref = ?`, ref)) { skipped++; return; }
    created++;
    if (dryRun) return;

    try {
      const acct = getAccount(account) ?? addAccount({ name: account, currency, type: 'other' });
      const kind = net < 0 ? 'expense' : 'income';
      const isReady = /ready to assign|to be budgeted/i.test(cat);
      const category = cat && !isReady ? findCategory(cat.replace(/\s*[:/]\s*/g, '/'), kind) : undefined;
      const amount = Math.abs(net);
      const rate = rateFor(acct.currency, day);
      insert('records', {
        id: uuid(), account_id: acct.id, kind, amount, currency: acct.currency, rate_to_usd: rate.rate, rate_estimated: rate.estimated,
        usd: round(amount * rate.rate, 2), category_id: category?.id ?? null, labels: ['ynab'], note: memo.slice(0, 1000),
        payee: payee ? payee.slice(0, 120) : null, day, at: `${day}T12:00:00Z`, direction: net < 0 ? -1 : 1, import_ref: ref,
      });
    } catch (e) { created--; errors.push(`row ${i + 2}: ${(e as Error).message}`); }
  });
  return { rows: rows.length, created, skipped, transfers, errors: errors.slice(0, 20), dryRun };
};

/** One entry point for the MCP tool and the app's Import card. */
export const importCsv = (source: 'todoist' | 'ynab', csv: string, opts: { project?: string; currency?: string; dryRun?: boolean } = {}) =>
  source === 'todoist' ? importTodoist(csv, opts) : importYnab(csv, opts);

export const _internals = { toIso, dateOrder };
