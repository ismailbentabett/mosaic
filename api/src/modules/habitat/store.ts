// Brainstorm round 3 (habitat): double-log catch, undo shelf, last-done board, free to spend, lent/borrowed things,
// closed days (national calendar), leave-by, workout finish forecast, usual buys, what-helped bank, tiny experiments,
// lost-block swap options.
// Rules: no streaks, no scores, no guilt words, nothing medical, no pushes from here. Saturday is rest.
import { AppError } from '../../errors.ts';
import { kvGet, kvSet } from '../../db.ts';
import { OFFSET, addDays, dateOf, daysBetween, dowOf, hhmm, isDate, iso, lifeDay, lifeToday } from '../../time.ts';
import { all, checkId, idOr, insert, j, need, now, one, patch, restore, round, run, softDelete } from '../util.ts';
import type { Row } from '../util.ts';
import { normalise } from '../ideas/store.ts';
import { restoreTask } from '../tasks/store.ts';
import { recomputePrs } from '../gym/store.ts';
import { getAccount, listBudgets, listPlanned, periodOf, rateFor, summary } from '../money/store.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
const clean = (s: unknown, max: number, what: string, required = true): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (required && !t) bad(`${what} is required`);
  if (t.length > max) bad(`${what} max ${max} characters`);
  return t;
};
const toDate = (at: Date | string | undefined, what = 'at'): Date => {
  const d = at instanceof Date ? at : at === undefined ? new Date() : new Date(at);
  if (Number.isNaN(d.getTime())) bad(`${what} must be an ISO time`);
  return d;
};
const minsOf = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const atHHMM = (day: string, s: string) => Date.parse(`${day}T${s}:00${OFFSET}`);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const tableExists = (t: string) => !!one(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, t);
const hasColumn = (t: string, c: string) => all<{ name: string }>(`PRAGMA table_info(${t})`).some((x) => x.name === c);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

// =====================================================================================================
// 1. Double-log catch: a near-identical entry saved within 15 minutes (sets: under 20 s = a double tap).
// =====================================================================================================
export const DOUBLE_KINDS = ['money', 'food', 'water', 'set'] as const;
export type DoubleKind = (typeof DOUBLE_KINDS)[number];
const DOUBLE_TABLE: Record<DoubleKind, string> = { money: 'records', food: 'food_log', water: 'water_log', set: 'sets' };
const DOUBLE_WINDOW_MS: Record<DoubleKind, number> = { money: 15 * 60000, food: 15 * 60000, water: 15 * 60000, set: 20000 };
const timeOf = (kind: DoubleKind, r: Row) => Date.parse(String(kind === 'set' ? r.done_at ?? r.created_at : kind === 'water' ? r.created_at : r.at ?? r.created_at));
const near = (a: unknown, b: unknown, pct = 0.01) => {
  if (a === null || a === undefined || b === null || b === undefined) return a === b || (a == null && b == null);
  const x = Number(a), y = Number(b);
  return Math.abs(x - y) <= Math.max(Math.abs(x), Math.abs(y)) * pct + 1e-9;
};
const dupOk = (a: string, b: string) => kvGet(`dup_ok:${a}`) === b || kvGet(`dup_ok:${b}`) === a;

/**
 * Find a near-identical row saved close to this one. `row` is the saved row (only `id` is needed if it is in the DB)
 * or the fields about to be saved. Returns the other row plus gap_s and at_hhmm, or null. Pure read.
 */
export const possibleDouble = (kind: DoubleKind, row: Row): (Row & { gap_s: number; at_hhmm: string }) | null => {
  if (!DOUBLE_KINDS.includes(kind)) bad(`kind must be one of ${DOUBLE_KINDS.join(', ')}`);
  const table = DOUBLE_TABLE[kind];
  const saved = row?.id ? one<Row>(`SELECT * FROM ${table} WHERE id = ?`, row.id) : undefined;
  const r: Row = { ...(saved ?? {}), ...(saved ? {} : row) };
  if (!r || typeof r !== 'object') return null;
  const t = timeOf(kind, r.created_at || r.at || r.done_at ? r : { ...r, created_at: now(), at: now(), done_at: now() });
  if (!Number.isFinite(t)) return null;
  let cands: Row[] = [];
  if (kind === 'money') {
    if (r.kind === 'transfer' || r.transfer_id) return null;
    cands = all(`SELECT * FROM records WHERE deleted_at IS NULL AND kind = ? AND kind != 'transfer' AND category_id IS ? AND day >= ? AND day <= ?`,
      r.kind ?? 'expense', r.category_id ?? null, addDays(String(r.day ?? lifeDay(new Date(t))), -1), addDays(String(r.day ?? lifeDay(new Date(t))), 1))
      .filter((c) => near(c.amount, r.amount) && (!r.account_id || c.account_id === r.account_id));
  } else if (kind === 'food') {
    const d = String(r.day ?? lifeDay(new Date(t)));
    cands = all(`SELECT * FROM food_log WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, addDays(d, -1), addDays(d, 1))
      .filter((c) => (r.food_id || r.recipe_id
        ? (c.food_id ?? null) === (r.food_id ?? null) && (c.recipe_id ?? null) === (r.recipe_id ?? null)
        : normalise(c.name) === normalise(r.name)) && near(c.grams ?? null, r.grams ?? null));
  } else if (kind === 'water') {
    const d = String(r.day ?? lifeDay(new Date(t)));
    cands = all(`SELECT * FROM water_log WHERE deleted_at IS NULL AND day = ?`, d).filter((c) => near(c.ml, r.ml));
  } else {
    if (!r.workout_id) return null;
    cands = all(`SELECT * FROM sets WHERE deleted_at IS NULL AND workout_id = ? AND exercise_id = ?`, r.workout_id, r.exercise_id ?? '')
      .filter((c) => near(c.weight ?? null, r.weight ?? null, 0) && (c.reps ?? null) === (r.reps ?? null) && (c.type ?? 'working') === (r.type ?? 'working'));
  }
  const hits = cands.filter((c) => c.id !== r.id && !(r.id && dupOk(String(r.id), String(c.id))))
    .map((c) => ({ c, gap: Math.abs(timeOf(kind, c) - t) }))
    .filter((x) => Number.isFinite(x.gap) && x.gap <= DOUBLE_WINDOW_MS[kind])
    .sort((a, b) => a.gap - b.gap);
  if (!hits.length) return null;
  const { c, gap } = hits[0];
  return { ...c, gap_s: Math.round(gap / 1000), at_hhmm: hhmm(new Date(timeOf(kind, c))) };
};

/** "Keep both": remember the pair so it is never flagged again. */
export const keepBoth = (id: string, otherId: string) => {
  checkId(id); checkId(otherId, 'other id');
  kvSet(`dup_ok:${id}`, otherId);
  kvSet(`dup_ok:${otherId}`, id);
  return { id, other: otherId, kept: true };
};

// =====================================================================================================
// 2. Undo shelf: recently removed rows across modules; restore by whitelist.
// =====================================================================================================
export const SHELF_TABLES = ['tasks', 'records', 'food_log', 'sets', 'body_metrics', 'shopping_items', 'documents'] as const;
export type ShelfTable = (typeof SHELF_TABLES)[number];
const LABEL_SQL: Record<ShelfTable, string> = {
  // subtasks removed together with their parent are restored with it, so only the parent is listed
  tasks: `SELECT t.id, t.title AS label, t.deleted_at FROM tasks t WHERE t.deleted_at >= ?
    AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_id AND p.deleted_at IS NOT NULL)`,
  // a transfer is listed once (outgoing leg); restoring it restores both legs
  records: `SELECT id, kind, amount, currency, note, payee, deleted_at FROM records WHERE deleted_at >= ?
    AND (transfer_id IS NULL OR direction = -1)`,
  food_log: `SELECT id, name, grams, deleted_at FROM food_log WHERE deleted_at >= ?`,
  sets: `SELECT s.id, e.name AS exercise, s.weight, s.reps, s.deleted_at FROM sets s LEFT JOIN exercises e ON e.id = s.exercise_id
    WHERE s.deleted_at >= ? AND NOT EXISTS (SELECT 1 FROM workouts w WHERE w.id = s.workout_id AND w.deleted_at IS NOT NULL)`,
  body_metrics: `SELECT id, kind, value, unit, deleted_at FROM body_metrics WHERE deleted_at >= ?`,
  shopping_items: `SELECT id, name, qty, done, deleted_at FROM shopping_items WHERE deleted_at >= ?`,
  documents: `SELECT id, name, deleted_at FROM documents WHERE deleted_at >= ?`,
};
const labelOf = (t: ShelfTable, r: Row): string => {
  switch (t) {
    case 'tasks': return String(r.label);
    case 'records': return `${r.kind === 'transfer' ? 'Transfer' : r.kind === 'income' ? 'Income' : 'Expense'} ${fmt(Number(r.amount))} ${r.currency}${r.payee || r.note ? ` · ${r.payee || r.note}` : ''}`;
    case 'food_log': return `${r.name}${r.grams ? ` ${round(Number(r.grams), 0)} g` : ''}`;
    case 'sets': return `${r.exercise ?? 'Set'}${r.weight != null ? ` ${r.weight} kg` : ''}${r.reps != null ? ` × ${r.reps}` : ''}`;
    case 'body_metrics': return `${r.kind} ${r.value} ${r.unit}`;
    case 'shopping_items': return `${r.name}${r.qty ? ` (${r.qty})` : ''}${r.done ? ' · bought' : ''}`;
    case 'documents': return String(r.name);
  }
};
const shelfTables = () => SHELF_TABLES.filter((t) => tableExists(t) && hasColumn(t, 'deleted_at'));

/** Rows soft-deleted in the last `days` days (default 14), newest first. */
export const recentlyRemoved = (days = 14, limit = 50) => {
  if (!(days > 0 && days <= 60)) bad('days must be 1-60');
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const out: { table: ShelfTable; id: string; label: string; deleted_at: string }[] = [];
  for (const t of shelfTables()) {
    for (const r of all<Row>(LABEL_SQL[t], since)) out.push({ table: t, id: String(r.id), label: labelOf(t, r).slice(0, 120), deleted_at: String(r.deleted_at) });
  }
  return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)).slice(0, Math.min(Math.max(limit, 1), 200));
};

/** Restore one removed row. Tasks bring their subtasks back, transfers both legs, sets recompute PRs. */
export const restoreRemoved = (table: string, id: string) => {
  if (!SHELF_TABLES.includes(table as ShelfTable) || !shelfTables().includes(table as ShelfTable)) bad(`table must be one of ${SHELF_TABLES.join(', ')}`);
  checkId(id);
  const t = table as ShelfTable;
  const row = need(one<Row>(`SELECT * FROM ${t} WHERE id = ?`, id), 'removed row');
  if (!row.deleted_at) return { table: t, id, restored: false, reason: 'not removed' };
  if (t === 'tasks') restoreTask(id);
  else if (t === 'records' && row.transfer_id) run(`UPDATE records SET deleted_at = NULL, updated_at = ? WHERE transfer_id = ?`, now(), row.transfer_id);
  else restore(t, id);
  if (t === 'sets') recomputePrs(String(row.exercise_id));
  return { table: t, id, restored: true };
};

// =====================================================================================================
// 3. Last-done board: "when did I last…" with no thresholds, sorted by name.
// =====================================================================================================
export type LastDone = { id: string; name: string; last_at: string | null; note: string; created_at: string; updated_at: string };
const findLastDone = (ref: string) => one<LastDone>(`SELECT * FROM last_done WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref);
const shapeLast = (r: LastDone, day = lifeToday()) => {
  const last_day = r.last_at ? lifeDay(new Date(r.last_at)) : null;
  return { ...r, last_day, days_since: last_day ? Math.max(0, daysBetween(last_day, day)) : null, line: last_day ? null : 'not yet' };
};
const stampTime = (at?: string) => {
  if (at === undefined) return now();
  if (isDate(at)) return new Date(`${at}T12:00:00${OFFSET}`).toISOString();
  const d = toDate(at);
  if (d.getTime() > Date.now() + 60000) bad('at cannot be in the future');
  return d.toISOString();
};

export const addLastDone = (name: string, o: { id?: string; note?: string } = {}) => {
  const n = clean(name, 60, 'name');
  const hit = findLastDone(n);
  if (hit) return shapeLast(hit);
  const id = idOr(o.id);
  const replay = one<LastDone>(`SELECT * FROM last_done WHERE id = ?`, id);
  if (replay) return shapeLast(replay);
  insert('last_done', { id, name: n, last_at: null, note: clean(o.note, 200, 'note', false) });
  return shapeLast(need(findLastDone(id), 'last-done item'));
};

/** "Did it now" (or at a past time/day). Creates the item when the name is new. */
export const stampLastDone = (name: string, at?: string, id?: string) => {
  const item = (id && findLastDone(id)) || findLastDone(clean(name, 60, 'name')) || need(findLastDone(addLastDone(name, { id }).id), 'last-done item');
  patch('last_done', item.id, { last_at: stampTime(at) });
  return shapeLast(need(findLastDone(item.id), 'last-done item'));
};

export const lastDoneBoard = (day = lifeToday()) =>
  all<LastDone>(`SELECT * FROM last_done WHERE deleted_at IS NULL ORDER BY lower(name)`).map((r) => shapeLast(r, day));

export const renameLastDone = (id: string, name: string, note?: string) => {
  const cur = need(findLastDone(id), 'last-done item');
  const n = clean(name, 60, 'name');
  const clash = findLastDone(n);
  if (clash && clash.id !== cur.id) throw new AppError('conflict', `"${n}" is already on the board`);
  patch('last_done', cur.id, { name: n, note: note === undefined ? undefined : clean(note, 200, 'note', false) });
  return shapeLast(need(findLastDone(cur.id), 'last-done item'));
};

export const deleteLastDone = (id: string) => { need(findLastDone(id), 'last-done item'); softDelete('last_done', id); return { id, deleted: true }; };

// =====================================================================================================
// 4. Free to spend this week (estimate). Weekly budget − this life-week's personal spend − planned payments due this week.
// =====================================================================================================
export const freeToSpend = (day = lifeToday()) => {
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  const week = periodOf('week', day);
  const budgets = listBudgets(day);
  const weekly = budgets.filter((b) => b.period === 'week');
  const whole = weekly.find((b) => !b.category_ids.length);
  let source: 'week' | 'week_categories' | 'month_share';
  let budget = 0, used = 0;
  if (whole) { source = 'week'; budget = Number(whole.amount_usd); used = Number(whole.spent_usd); }
  else if (weekly.length) { source = 'week_categories'; for (const b of weekly) { budget += Number(b.amount_usd); used += Number(b.spent_usd); } }
  else {
    const month = budgets.find((b) => b.period === 'month' && !b.category_ids.length);
    if (!month) return { free: null, reason: 'no weekly budget set yet: set one in Money → Budgets or with money_budget', estimate: true };
    const m = periodOf('month', day);
    source = 'month_share';
    budget = Number(month.amount_usd) * 7 / (daysBetween(m.from, m.to) + 1);
    // spend this week, whole personal track (same rule as budgets: transfers and business excluded)
    used = weekSpendUsd(week.from, week.to);
  }
  const planned = listPlanned(week.to).filter((p) => String(p.next_due) >= week.from).flatMap((p) => {
    const t = p.template as Row;
    if ((t.kind ?? 'expense') !== 'expense') return [];
    const acct = t.account ? getAccount(String(t.account)) : undefined;
    if (acct && acct.track !== 'personal') return [];
    const currency = String(t.currency ?? acct?.currency ?? 'USD').toUpperCase();
    let rate = 1;
    try { rate = rateFor(currency, String(p.next_due)).rate; } catch { return []; }
    return [{ id: String(p.id), name: String(p.name), due: String(p.next_due), usd: round(Number(t.amount) * rate, 2) }];
  });
  const plannedUsd = planned.reduce((a, p) => a + p.usd, 0);
  const avail = budget - plannedUsd;
  const free = avail - used;
  const money = (usd: number) => `$${fmt(usd)}`;
  const line = avail <= 0 ? 'No free amount this week; essentials only.'
    : free >= 0 ? `About ${money(free)} free this week · ${money(used)} used`
      : `Used ${money(used)} of about ${money(avail)} this week`;
  return {
    estimate: true, week_from: week.from, week_to: week.to, source,
    budget_usd: round(budget, 2), used_usd: round(used, 2), planned_usd: round(plannedUsd, 2), free_usd: round(free, 2),
    planned, line,
  };
};
// One spend rule for the whole app: money summary (refund = income in an expense category; transfers excluded).
const weekSpendUsd = (from: string, to: string) => summary({ from, to }, 'personal').spend_usd;

// =====================================================================================================
// 5. Lent and borrowed things (objects; money loans stay in Debts).
// =====================================================================================================
const MONEYISH = /^\s*(\$|€)?\s*\d[\d\s.,]*\s*(k|usd|eur|\$|€)?\s*$/i;
export const addLent = (l: { id?: string; thing: string; person: string; direction: 'lent' | 'borrowed'; since?: string; back_by?: string; note?: string }) => {
  const thing = clean(l.thing, 100, 'thing');
  if (MONEYISH.test(thing)) bad('this looks like money: add it to Debts instead');
  const person = clean(l.person, 80, 'person');
  if (!['lent', 'borrowed'].includes(l.direction)) bad('direction must be lent or borrowed');
  const since = l.since ?? lifeToday();
  if (!isDate(since)) bad('since must be YYYY-MM-DD');
  if (l.back_by !== undefined && l.back_by !== null && !isDate(l.back_by)) bad('back_by must be YYYY-MM-DD');
  const id = idOr(l.id);
  insert('lent_things', { id, thing, person, direction: l.direction, since, back_by: l.back_by ?? null, note: clean(l.note, 200, 'note', false) });
  return need(one<Row>(`SELECT * FROM lent_things WHERE id = ?`, id), 'lent thing');
};
export const listLent = (o: { open?: boolean; direction?: string } = {}) => {
  const open = o.open ?? true;
  if (o.direction && !['lent', 'borrowed'].includes(o.direction)) bad('direction must be lent or borrowed');
  return all<Row>(`SELECT * FROM lent_things WHERE deleted_at IS NULL ${open ? 'AND returned_at IS NULL' : ''} ${o.direction ? 'AND direction = ?' : ''}
    ORDER BY since, created_at`, ...(o.direction ? [o.direction] : []));
};
export const returnLent = (id: string, at?: string) => {
  const cur = need(one<Row>(`SELECT * FROM lent_things WHERE id = ? AND deleted_at IS NULL`, id), 'lent thing');
  if (!cur.returned_at) patch('lent_things', id, { returned_at: toDate(at).toISOString() });
  return need(one<Row>(`SELECT * FROM lent_things WHERE id = ?`, id), 'lent thing');
};
export const deleteLent = (id: string) => { need(one(`SELECT id FROM lent_things WHERE id = ? AND deleted_at IS NULL`, id), 'lent thing'); softDelete('lent_things', id); return { id, deleted: true }; };

// =====================================================================================================
// 6. Closed days (national calendar): national holidays, Fri–Sat weekend, own extra days.
// =====================================================================================================
export type ClosedReason = { name: string; kind: 'national' | 'weekly' | 'extra'; estimate: boolean; shifted?: boolean };
const NATIONAL: Record<string, string> = {
  '01-01': 'New Year', '01-12': 'Yennayer', '05-01': 'Labour Day', '07-05': 'Independence Day', '11-01': 'Revolution Day',
};
/** Days in [from, to] when offices are likely closed. */
export const closedDays = (from: string, to: string) => {
  if (!isDate(from) || !isDate(to)) bad('from and to must be YYYY-MM-DD');
  const n = daysBetween(from, to);
  if (n < 0) bad('to must be on or after from');
  if (n > 400) bad('range max 400 days');
  const map = new Map<string, ClosedReason[]>();
  const add = (d: string, r: ClosedReason) => {
    const list = map.get(d) ?? [];
    const base = (x: ClosedReason) => `${x.kind}:${x.name.split(' (')[0]}`;
    const i = list.findIndex((x) => base(x) === base(r));
    if (i < 0) list.push(r);
    else if (list[i].shifted && !r.shifted) list[i] = r; // a real holiday day wins over a possible shift
    map.set(d, list);
  };
  const extra = j<{ day: string; name?: string }[]>(kvGet('closed_extra'), []);
  for (let i = 0; i <= n; i++) {
    const d = addDays(from, i);
    const md = d.slice(5);
    if (NATIONAL[md]) add(d, { name: NATIONAL[md], kind: 'national', estimate: false });
    const dow = dowOf(d);
    if (dow === 5) add(d, { name: 'Friday: offices closed', kind: 'weekly', estimate: false });
    if (dow === 6) add(d, { name: 'Saturday: offices closed', kind: 'weekly', estimate: false });
    for (const e of extra) if (e?.day === d) add(d, { name: String(e.name ?? 'Closed').slice(0, 80), kind: 'extra', estimate: false });
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([day, reasons]) => ({ day, reasons, estimate: reasons.every((r) => r.estimate) }));
};

// =====================================================================================================
// 7. Leave-by line (pure).
// =====================================================================================================
export const leaveBy = (arriveAt: string, travelMin: number, bufferMin = 10) => {
  const a = toDate(arriveAt, 'arriveAt');
  if (!(Number.isFinite(travelMin) && travelMin >= 0 && travelMin <= 600)) bad('travelMin must be 0-600');
  if (!(Number.isFinite(bufferMin) && bufferMin >= 0 && bufferMin <= 240)) bad('bufferMin must be 0-240');
  const leave = new Date(a.getTime() - (travelMin + bufferMin) * 60000);
  return { arrive_at: iso(a), leave_at: iso(leave), leave_hhmm: hhmm(leave), travel_min: travelMin, buffer_min: bufferMin,
    line: `${hhmm(a)} · leave ${hhmm(leave)}` };
};

// =====================================================================================================
// 8. Workout finish forecast: remaining routine sets × median set+rest gap of past workouts.
// =====================================================================================================
const LONG_PAUSE_S = 600;
const gapsOf = (workoutId: string) => {
  const ts = all<{ done_at: string }>(`SELECT done_at FROM sets WHERE workout_id = ? AND deleted_at IS NULL AND done_at IS NOT NULL ORDER BY done_at`, workoutId)
    .map((s) => Date.parse(s.done_at)).filter(Number.isFinite);
  const g: number[] = [];
  for (let i = 1; i < ts.length; i++) { const s = (ts[i] - ts[i - 1]) / 1000; if (s > 0 && s <= LONG_PAUSE_S) g.push(s); }
  return g;
};
export const workoutForecast = (workoutId: string, at: Date | string = new Date()) => {
  const w = need(one<Row>(`SELECT * FROM workouts WHERE id = ? AND deleted_at IS NULL`, workoutId), 'workout');
  if (!w.routine_id) return null;
  const items = all<{ exercise_id: string; sets: number }>(`SELECT exercise_id, SUM(sets) AS sets FROM routine_items WHERE routine_id = ? AND deleted_at IS NULL GROUP BY exercise_id`, w.routine_id);
  if (!items.length) return null;
  const doneBy = new Map(all<{ exercise_id: string; n: number }>(`SELECT exercise_id, COUNT(*) AS n FROM sets WHERE workout_id = ? AND deleted_at IS NULL AND type != 'warmup' GROUP BY exercise_id`, workoutId)
    .map((r) => [r.exercise_id, Number(r.n)]));
  const remaining = items.reduce((a, it) => a + Math.max(0, Number(it.sets) - (doneBy.get(it.exercise_id) ?? 0)), 0);
  const past = (sameRoutine: boolean) => all<{ id: string }>(`SELECT id FROM workouts WHERE deleted_at IS NULL AND status = 'done' AND id != ?
    ${sameRoutine ? 'AND routine_id = ?' : ''} ORDER BY started_at DESC LIMIT 3`, ...(sameRoutine ? [workoutId, w.routine_id] : [workoutId]));
  let hist = past(true);
  if (!hist.length) hist = past(false);
  const gaps = [...hist.flatMap((h) => gapsOf(h.id)), ...gapsOf(workoutId)];
  if (!gaps.length) return null;
  const pace = median(gaps)!;
  const last = one<{ t: string | null }>(`SELECT MAX(done_at) AS t FROM sets WHERE workout_id = ? AND deleted_at IS NULL`, workoutId)!.t;
  const nowMs = toDate(at instanceof Date ? at : at).getTime();
  const base = Math.max(nowMs, last ? Date.parse(last) : 0);
  const finish = new Date(base + remaining * pace * 1000);
  return { workout_id: workoutId, remaining_sets: remaining, pace_s: Math.round(pace), based_on_gaps: gaps.length,
    finish_at: iso(finish), finish_hhmm: hhmm(finish), line: remaining ? `at this pace: done ${hhmm(finish)}` : 'all planned sets logged' };
};

// =====================================================================================================
// 9. Usual-buys forecast: shopping items bought at a regular rhythm, 3+ times.
// =====================================================================================================
export const usualBuys = (day = lifeToday(), soonDays = 3) => {
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  const bought = all<Row>(`SELECT name, list, updated_at FROM shopping_items WHERE done = 1`);
  const open = new Set(all<{ name: string }>(`SELECT name FROM shopping_items WHERE done = 0 AND deleted_at IS NULL`).map((r) => normalise(r.name)));
  const groups = new Map<string, { name: string; list: string; days: Set<string> }>();
  for (const r of bought) {
    const k = normalise(r.name);
    if (!k) continue;
    const d = lifeDay(new Date(String(r.updated_at)));
    if (d > day) continue;
    const g = groups.get(k) ?? { name: String(r.name), list: String(r.list), days: new Set<string>() };
    g.days.add(d);
    groups.set(k, g);
  }
  const out: { name: string; list: string; every_days: number; last_day: string; next_day: string; line: string }[] = [];
  for (const [k, g] of groups) {
    if (open.has(k)) continue;
    const ds = [...g.days].sort();
    if (ds.length < 3) continue;
    const gaps = ds.slice(1).map((d, i) => daysBetween(ds[i], d));
    const med = median(gaps)!;
    if (med < 1) continue;
    const spread = Math.max(...gaps.map((x) => Math.abs(x - med)));
    if (spread > Math.max(2, med * 0.5)) continue; // irregular: not suggested
    const last = ds[ds.length - 1];
    const next = addDays(last, Math.round(med));
    if (daysBetween(last, day) < 1 || daysBetween(day, next) > soonDays) continue;
    out.push({ name: g.name, list: g.list, every_days: Math.round(med), last_day: last, next_day: next, line: `${g.name} · usually every ~${Math.round(med)} days` });
  }
  return out.sort((a, b) => a.next_day.localeCompare(b.next_day) || a.name.localeCompare(b.name));
};

// =====================================================================================================
// 10. What-helped bank.
// =====================================================================================================
export const addHelped = (h: { id?: string; situation: string; thing: string; note?: string }) => {
  const id = idOr(h.id);
  insert('what_helped', { id, situation: clean(h.situation, 80, 'situation'), thing: clean(h.thing, 120, 'thing'), note: clean(h.note, 300, 'note', false) });
  return need(one<Row>(`SELECT * FROM what_helped WHERE id = ?`, id), 'entry');
};
export const listHelped = (situation?: string, limit = 100) => {
  const rows = all<Row>(`SELECT * FROM what_helped WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`, Math.min(Math.max(limit, 1), 500));
  if (!situation) return rows;
  const q = normalise(situation);
  return rows.filter((r) => normalise(r.situation).includes(q));
};
/** Search situation, thing and note. */
export const searchHelped = (q: string, limit = 50) => {
  const n = normalise(clean(q, 80, 'q'));
  return all<Row>(`SELECT * FROM what_helped WHERE deleted_at IS NULL ORDER BY created_at DESC`)
    .filter((r) => [r.situation, r.thing, r.note].some((x) => normalise(x).includes(n))).slice(0, limit);
};
/** "Things that helped, most often first" (plain counts, no chart). */
export const helpedTop = (n = 10, situation?: string) => {
  const counts = new Map<string, { thing: string; times: number }>();
  for (const r of listHelped(situation, 500).reverse()) {
    const k = normalise(r.thing);
    const c = counts.get(k) ?? { thing: String(r.thing), times: 0 };
    c.times++;
    counts.set(k, c);
  }
  return [...counts.values()].sort((a, b) => b.times - a.times || a.thing.localeCompare(b.thing)).slice(0, n);
};
export const deleteHelped = (id: string) => { need(one(`SELECT id FROM what_helped WHERE id = ? AND deleted_at IS NULL`, id), 'entry'); softDelete('what_helped', id); return { id, deleted: true }; };

// =====================================================================================================
// 11. Tiny experiments: one running at a time, ended with a note. No scores.
// =====================================================================================================
const shapeExp = (e: Row, day = lifeToday()) => {
  const length = daysBetween(String(e.start_day), String(e.end_day)) + 1;
  const dayN = Math.min(length, Math.max(1, daysBetween(String(e.start_day), day) + 1));
  return { ...e, length_days: length, day_n: dayN, past_end: day > String(e.end_day),
    line: e.status === 'running' ? `Trying: ${e.name} (day ${dayN} of ${length})` : null };
};
export const startExperiment = (x: { id?: string; name: string; hypothesis?: string; start_day?: string; end_day?: string; days?: number }) => {
  const id = idOr(x.id);
  const replay = one<Row>(`SELECT * FROM experiments WHERE id = ?`, id);
  if (replay) return shapeExp(replay);
  const name = clean(x.name, 100, 'name');
  const start = x.start_day ?? lifeToday();
  if (!isDate(start)) bad('start_day must be YYYY-MM-DD');
  const end = x.end_day ?? addDays(start, Math.round(x.days ?? 7) - 1);
  if (!isDate(end)) bad('end_day must be YYYY-MM-DD');
  const len = daysBetween(start, end) + 1;
  if (len < 1 || len > 60) bad('an experiment runs 1-60 days');
  if (one(`SELECT 1 FROM experiments WHERE status = 'running' AND deleted_at IS NULL`)) throw new AppError('conflict', 'one experiment is already running; end it first');
  insert('experiments', { id, name, hypothesis: clean(x.hypothesis, 300, 'hypothesis', false), start_day: start, end_day: end, status: 'running' });
  return shapeExp(need(one<Row>(`SELECT * FROM experiments WHERE id = ?`, id), 'experiment'));
};
export const runningExperiment = (day = lifeToday()) => {
  const e = one<Row>(`SELECT * FROM experiments WHERE status = 'running' AND deleted_at IS NULL`);
  return e ? shapeExp(e, day) : null;
};
export const endExperiment = (id: string, outcome_note = '') => {
  const e = need(one<Row>(`SELECT * FROM experiments WHERE id = ? AND deleted_at IS NULL`, id), 'experiment');
  if (e.status === 'running') patch('experiments', id, { status: 'ended', outcome_note: clean(outcome_note, 1000, 'outcome_note', false), ended_at: now() });
  return shapeExp(need(one<Row>(`SELECT * FROM experiments WHERE id = ?`, id), 'experiment'));
};
export const listExperiments = (limit = 50) =>
  all<Row>(`SELECT * FROM experiments WHERE deleted_at IS NULL ORDER BY status = 'running' DESC, start_day DESC LIMIT ?`, Math.min(Math.max(limit, 1), 200)).map((e) => shapeExp(e));

// =====================================================================================================
// 12. Lost-block swap options (pure, from the weekday layout in CLAUDE.md; no calendar call).
// =====================================================================================================
export type Block = { name: string; emoji: string; start: string; end: string; must: boolean; ritual?: boolean };
const WEEKDAY: Block[] = [
  { name: 'Kickoff', emoji: '🚀', start: '11:15', end: '11:30', must: false, ritual: true },
  { name: 'Admin', emoji: '🧱', start: '11:30', end: '12:20', must: false },
  { name: 'Project work', emoji: '🛠️', start: '13:10', end: '14:00', must: true },
  { name: 'Deep work', emoji: '📣', start: '15:30', end: '16:20', must: true },
  { name: 'Meetings', emoji: '📣', start: '16:30', end: '17:20', must: true },
  { name: 'Learning', emoji: '🛠️', start: '20:50', end: '21:25', must: false },
  { name: 'Buffer', emoji: '📣', start: '21:30', end: '22:20', must: false },
];
/** Writable blocks for a day (local time). Saturday: none. Sunday: the weekend build/review block. Friday: Project work 14:10–15:00. */
export const blocksFor = (day: string): Block[] => {
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  const dow = dowOf(day);
  if (dow === 6) return [];
  if (dow === 0) return [{ name: 'Weekly review', emoji: '🗓️', start: '12:00', end: '14:30', must: false }];
  if (dow === 5) return WEEKDAY.map((b) => (b.name === 'Project work' ? { ...b, start: '14:10', end: '15:00' } : b));
  return WEEKDAY;
};
const blockKey = (s: string) => String(s ?? '').split('·')[0].replace(/[^\p{L}\p{N}+/ ]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** Later writable blocks today that have not started at `at`, in time order. Launch (a ritual) is never a target. */
export const swapOptions = (day: string, blockName: string, at: Date | string = new Date()) => {
  const blocks = blocksFor(day);
  if (!blocks.length) return [];
  const key = blockKey(blockName);
  if (!key) bad('block is required');
  const from = blocks.find((b) => blockKey(b.name) === key);
  if (!from) bad(`no writable block "${blockName}" on ${day}`);
  const t = toDate(at).getTime();
  const fromStart = atHHMM(day, from!.start);
  return blocks.filter((b) => !b.ritual && b !== from && atHHMM(day, b.start) > fromStart && atHHMM(day, b.start) > t)
    .map((b) => ({ name: b.name, title: `${b.emoji} ${b.name}`, start: b.start, end: b.end, start_at: `${day}T${b.start}:00${OFFSET}`, must: b.must }));
};

// =====================================================================================================
// Home card: small bits together.
// =====================================================================================================
export const habitatToday = (day = lifeToday()) => {
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  let free: ReturnType<typeof freeToSpend> | null = null;
  try { free = freeToSpend(day); } catch { free = null; }
  const lentOpen = listLent({ open: true });
  return {
    day, rest_day: dowOf(day) === 6,
    usual_buys: usualBuys(day).slice(0, 3),
    last_done_count: Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM last_done WHERE deleted_at IS NULL`)!.n),
    experiment: runningExperiment(day),
    lent_open: { count: lentOpen.length, lent: lentOpen.filter((l) => l.direction === 'lent').length, borrowed: lentOpen.filter((l) => l.direction === 'borrowed').length },
    free_to_spend: free,
  };
};

