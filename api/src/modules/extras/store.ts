// Backlog extras (2026-11-11): day anchors + timer guard, Done list, Rescue + bad-day menu, Close-the-day,
// document expiry, cooling-off wishlist, "Can I afford it?", price memory, estimate learning, FSRS flashcards,
// brain dump, local dish seed, weather, today's routine, return-after-gap, parking lot, ntfy action tokens.
// Rules: no streaks, no scores, no red, no guilt.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../errors.ts';
import { kvGet, kvSet } from '../../db.ts';
import { cfg, secret, setSecret } from '../../config.ts';
import { captureNote } from '../../notes.ts';
import { canonicalMode, setMode, type Mode } from '../../sheet.ts';
import { keepRescue as keepRescueState, recordMode, rescueState } from '../../modeState.ts';
import { TZ, OFFSET, dateOf, hhmm, dowOf, isDate, addDays, lifeDay, lifeToday, daysBetween } from '../../time.ts';
import { all, one, run, insert, patch, softDelete, need, round, idOr, now, j } from '../util.ts';
import type { Row } from '../util.ts';
import * as tasks from '../tasks/store.ts';
import * as money from '../money/store.ts';
import * as food from '../food/store.ts';
import * as gym from '../gym/store.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
/** Long digit runs look like ID / card / account numbers. Those never get stored. */
const NUMBERY = /\d[\d\s-]{11,}\d/;
const clean = (s: unknown, max: number, what: string) => {
  const t = String(s ?? '').trim().slice(0, max);
  if (NUMBERY.test(t)) bad(`${what}: no ID, card or account numbers here (see password manager)`);
  return t;
};
// =====================================================================================================
// Location (weather only). Default London 51.5 N, 0.13 W (MOSAIC_LAT / MOSAIC_LNG / MOSAIC_CITY override).
// =====================================================================================================
const coord = (key: string, fallback: number, limit: number) => {
  const n = Number(cfg(key, String(fallback)));
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : fallback;
};
export const LOCATION = {
  name: cfg('MOSAIC_CITY', 'London') || 'London',
  lat: coord('MOSAIC_LAT', 51.5, 90),
  lng: coord('MOSAIC_LNG', -0.13, 180),
};

// =====================================================================================================
// Day anchors: fixed meal and sleep times. The timer guard and "what now" stop short of the next one.
// =====================================================================================================
export const ANCHORS = [
  { key: 'breakfast', name: 'Breakfast', hhmm: '07:30' },
  { key: 'lunch', name: 'Lunch', hhmm: '13:00' },
  { key: 'dinner', name: 'Dinner', hhmm: '19:30' },
  { key: 'sleep', name: 'Sleep', hhmm: '23:30' },
] as const;
const atIso = (day: string, hm: string) => new Date(`${day}T${hm}:00${OFFSET}`);

/** The next day anchor after `at`, with minutes until it. */
export const nextAnchor = (at = new Date()) => {
  const today = dateOf(at);
  for (const day of [today, addDays(today, 1)]) {
    for (const a of ANCHORS) {
      const when = atIso(day, a.hhmm);
      if (when.getTime() > at.getTime()) {
        return { name: a.name, key: a.key, at: when.toISOString(), hhmm: a.hhmm, in_minutes: Math.round((when.getTime() - at.getTime()) / 60000) };
      }
    }
  }
  return null;
};

// whatNow (tasks store) passes over tasks that would run into the next anchor.
tasks.setAnchorSource((at) => nextAnchor(at)?.in_minutes ?? null);

/** Timer guard: if an anchor lands inside the sprint, suggest a sprint that ends 5 min before it. */
export const timerGuard = (minutes: number, at = new Date()) => {
  if (!(minutes > 0 && minutes <= 240)) bad('minutes must be 1–240');
  const next = nextAnchor(at);
  if (!next || next.in_minutes > minutes) return { ok: true, minutes, next };
  const suggest = Math.max(5, next.in_minutes - 5);
  return { ok: false, minutes, suggest_minutes: suggest, next,
    message: `${next.name} at ${next.hhmm}. Sprint ${suggest} min, then stop.` };
};

// =====================================================================================================
// Done list (no scoring): what got done in a range of life-days.
// =====================================================================================================
const inDays = (iso: string | null | undefined, from: string, to: string) => {
  if (!iso) return false;
  const d = lifeDay(new Date(iso));
  return d >= from && d <= to;
};
const isoFrom = (day: string) => `${addDays(day, -1)}T00:00:00${OFFSET}`;
const isoTo = (day: string) => `${addDays(day, 2)}T00:00:00${OFFSET}`;

export const doneList = (from = lifeToday(), to = from) => {
  if (!isDate(from) || !isDate(to)) bad('from/to must be YYYY-MM-DD');
  if (to < from) bad('to must be on or after from');
  const a = isoFrom(from), b = isoTo(to);
  const done = all<Row>(`SELECT t.id, t.title, t.done_at, t.tags, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.status = 'done' AND t.deleted_at IS NULL AND t.done_at >= ? AND t.done_at < ? ORDER BY t.done_at`, a, b)
    .filter((r) => inDays(r.done_at, from, to)).map((r) => ({ ...r, tags: j<string[]>(r.tags, []) }));
  const focus = all<Row>(`SELECT minutes, started_at FROM focus_sessions WHERE started_at >= ? AND started_at < ?`, a, b)
    .filter((r) => inDays(r.started_at, from, to));
  const sets = all<Row>(`SELECT done_at FROM sets WHERE deleted_at IS NULL AND done_at >= ? AND done_at < ?`, a, b).filter((r) => inDays(r.done_at, from, to));
  const one1 = (sql: string, ...p: unknown[]) => Number(one<{ n: number }>(sql, ...p)?.n ?? 0);
  return {
    from, to,
    tasks: done,
    counts: {
      tasks: done.length,
      focus_minutes: round(focus.reduce((s, r) => s + Number(r.minutes || 0), 0), 0),
      focus_sessions: focus.length,
      sets: sets.length,
      workouts: one1(`SELECT COUNT(*) AS n FROM workouts WHERE deleted_at IS NULL AND status = 'done' AND day BETWEEN ? AND ?`, from, to),
      food_entries: one1(`SELECT COUNT(*) AS n FROM food_log WHERE deleted_at IS NULL AND day BETWEEN ? AND ?`, from, to),
      water_ml: one1(`SELECT COALESCE(SUM(ml), 0) AS n FROM water_log WHERE deleted_at IS NULL AND day BETWEEN ? AND ?`, from, to),
      money_records: one1(`SELECT COUNT(*) AS n FROM records WHERE deleted_at IS NULL AND day BETWEEN ? AND ?`, from, to),
      habit_checks: one1(`SELECT COALESCE(SUM(count), 0) AS n FROM habit_checks WHERE day BETWEEN ? AND ?`, from, to),
      cards_reviewed: all<Row>(`SELECT at FROM card_reviews WHERE at >= ? AND at < ?`, a, b).filter((r) => inDays(r.at, from, to)).length,
    },
    note: 'A record of what happened. Nothing here is a score.',
  };
};

// =====================================================================================================
// Rescue (bad day) + the pre-decided bad-day menu.
// =====================================================================================================
export const DEFAULT_BADDAY = [
  'Drink a glass of water',
  'Eat a real meal',
  'One 10-min task: the first step of one priority',
  'Walk 10 minutes outside',
  'Shower and change clothes',
  'Lights out at 23:30',
];
export const getBadday = () => j<string[]>(kvGet('badday_menu'), DEFAULT_BADDAY);
export const setBadday = (items: unknown) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > 12) bad('menu needs 1–12 items');
  const list = (items as unknown[]).map((x) => clean(x, 80, 'menu item')).filter(Boolean);
  if (!list.length) bad('menu needs 1–12 items');
  kvSet('badday_menu', JSON.stringify(list));
  return list;
};

/** Next 07:30 local time after `at` (pushes stay quiet until then). */
const next1030 = (at = new Date()) => {
  const d = dateOf(at);
  const t = atIso(d, '07:30');
  return (t.getTime() > at.getTime() ? t : atIso(addDays(d, 1), '07:30')).toISOString();
};

/**
 * Rescue: Zero mode for this life-day only, pushes quiet until 07:30, block titles stripped.
 * At the next 04:00 roll the mode goes back on its own (modeState.expireRescueMode), unless kept.
 * The nightly run plans tomorrow in the mode after Rescue.
 */
export const rescue = async (at = new Date()) => {
  const prev = canonicalMode(kvGet('mode')) ?? 'Normal';
  if (prev !== 'Zero') kvSet('rescue_prev_mode', prev);
  const after: Mode = prev !== 'Zero' ? prev : (canonicalMode(kvGet('rescue_prev_mode')) ?? 'Normal');
  kvSet('mode', 'Zero');
  let sheet: 'ok' | 'cache' = 'cache';
  try { await setMode('Zero'); sheet = 'ok'; } catch { /* Sheet down: app mode still Zero */ }
  recordMode('Zero', 'rescue', at, after);
  const until = next1030(at);
  kvSet('push_silence_until', until);
  kvSet('rescue_at', at.toISOString());
  const day = lifeDay(at);
  let titles_cleared = 0;
  let titles_error: string | null = null;
  try {
    const r = await (await import('../../rules.ts')).clearBlockTask({ date: day }, 'rescue');
    titles_cleared = r.cleared?.length ?? 0;
  } catch (e) { titles_error = e instanceof Error ? e.message : String(e); }
  const r = rescueState(at);
  return { mode: 'Zero', sheet, push_silence_until: until, menu: getBadday(), titles_cleared, titles_error,
    ends_at: r?.ends_at ?? null, after,
    next: tasks.whatNow(day, { at, mode: 'Zero' }),
    message: `Zero mode until 04:00. One 10-minute thing from the menu is the whole day. Tonight's run plans tomorrow in ${after} mode.` };
};

/** Keep the Zero day past 04:00 (it then stays until the mode is changed). */
export const keepRescue = () => keepRescueState();

export const endRescue = async (at = new Date()) => {
  const back = canonicalMode(kvGet('rescue_prev_mode')) ?? 'Normal';
  kvSet('mode', back);
  kvSet('push_silence_until', '');
  let sheet: 'ok' | 'cache' = 'cache';
  try { await setMode(back); sheet = 'ok'; } catch { /* keep app mode */ }
  recordMode(back, 'user', at);
  return { mode: back, sheet };
};

/** True while Rescue has pushes muted (priority 5 still goes through). */
export const pushSilenced = (at = new Date()) => {
  const u = kvGet('push_silence_until');
  return !!u && Date.parse(u) > at.getTime();
};

// =====================================================================================================
// Close the day (23:00): a short record + one line for tomorrow's first thing.
// =====================================================================================================
export const closeDay = (o: { day?: string; first_thing?: string; note?: string } = {}, at = new Date()) => {
  const day = o.day ?? lifeDay(at);
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  const first = o.first_thing ? clean(o.first_thing, 120, 'first_thing') : '';
  const note = o.note ? clean(o.note, 500, 'note') : '';
  const d = doneList(day, day);
  const rec = { day, closed_at: at.toISOString(), first_thing: first, note, counts: d.counts };
  kvSet(`close_day:${day}`, JSON.stringify(rec));
  if (first) kvSet('tomorrow_first', JSON.stringify({ for: addDays(day, 1), text: first }));
  return { ...rec, done: d.tasks.map((t) => t.title), message: 'Day closed. Screens down, wind-down starts.' };
};
export const closedDay = (day = lifeToday()) => j<Row | null>(kvGet(`close_day:${day}`), null);
export const tomorrowFirst = (today = lifeToday()) => {
  const t = j<{ for: string; text: string } | null>(kvGet('tomorrow_first'), null);
  return t && t.for === today ? t.text : null;
};

// =====================================================================================================
// Document expiry register (passport, ID card, licence, insurance...). Never the numbers.
// =====================================================================================================
// One register for every paper with a date: passport, ID, licence, and the car papers (car_id + tag "car").
// Expired documents are never hidden: they sort first and say "ended N days ago".
// Reminders: 60, 30, 7 and 0 days before the end date, plus once after it. Each pushes once; a new date resets them.
export const DOC_THRESHOLDS = [60, 30, 7, 0] as const;
const REMIND_COLS = ['reminded_60', 'reminded_30', 'reminded_7', 'reminded_0', 'reminded_after'] as const;
const tagsOf = (v: unknown): string[] => {
  const t = Array.isArray(v) ? v : j<string[]>(typeof v === 'string' ? v : '[]', []);
  return [...new Set(t.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[a-z0-9_-]{1,24}$/.test(x)))].slice(0, 8);
};
const docState = (n: number | null, renewed = false) =>
  (renewed ? 'renewed' : n === null ? 'no_date' : n < 0 ? 'ended' : n <= 30 ? 'soon' : 'ok');
const isRenewed = (d: Row) => /Renewed$/.test(String(d.note ?? ''));
/** Plain words for a document's date: "ends in 12 days", "ends today", "ended 3 days ago — renew when you can". */
export const docLine = (name: string, n: number | null) =>
  n === null ? `${name}: no end date` : n > 1 ? `${name}: ends in ${n} days` : n === 1 ? `${name}: ends tomorrow`
    : n === 0 ? `${name}: ends today` : `${name}: ended ${-n} day${n === -1 ? '' : 's'} ago. Renew when you can.`;
const docRow = (d: Row, today: string) => {
  const n = d.expires_on ? daysBetween(today, String(d.expires_on)) : null;
  const renewed = isRenewed(d);
  const out: Row = { ...d, tags: tagsOf(d.tags), days_left: n, renewed, state: docState(n, renewed),
    line: renewed ? `${d.name}: renewed (old copy)` : docLine(String(d.name), n) };
  for (const c of REMIND_COLS) if (c in d) out[c] = !!d[c];
  return out;
};
/** All documents (expired first, then by date). Optional filters: car (car id) or tag. */
export const listDocuments = (today = lifeToday(), f: { car_id?: string; tag?: string } = {}) => all<Row>(
  `SELECT * FROM documents WHERE deleted_at IS NULL ${f.car_id ? 'AND car_id = ?' : ''}
   ORDER BY expires_on IS NULL, expires_on, name`, ...(f.car_id ? [f.car_id] : []),
).map((d) => docRow(d, today)).filter((d) => !f.tag || (d.tags as string[]).includes(f.tag.toLowerCase()));

export type DocumentInput = { id?: string; name: string; expires_on?: string | null; where_kept?: string; note?: string; tags?: string[] | string;
  car_id?: string | null; kind?: string | null; amount?: number | null; currency?: string | null; paid_on?: string | null; record_id?: string | null };
export const getDocument = (id: string, today = lifeToday()) =>
  docRow(need(one<Row>('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id), 'document'), today);
export const addDocument = (d: DocumentInput) => {
  const name = clean(d.name, 120, 'name');
  if (!name) bad('name is required');
  if (d.expires_on && !isDate(d.expires_on)) bad('expires_on must be YYYY-MM-DD');
  if (d.paid_on && !isDate(d.paid_on)) bad('paid_on must be YYYY-MM-DD');
  const id = idOr(d.id);
  const hit = one<Row>('SELECT id FROM documents WHERE id = ?', id);
  if (hit) return getDocument(id);
  const tags = tagsOf(d.tags);
  if (d.car_id && !tags.includes('car')) tags.unshift('car');
  insert('documents', { id, name, expires_on: d.expires_on ?? null, where_kept: clean(d.where_kept, 120, 'where_kept'), note: clean(d.note, 1000, 'note'),
    tags: JSON.stringify(tags), car_id: d.car_id ?? null, kind: d.kind ?? null, amount: d.amount ?? null, currency: d.currency ?? null,
    paid_on: d.paid_on ?? null, record_id: d.record_id ?? null });
  return getDocument(id);
};
export const updateDocument = (id: string, f: Partial<DocumentInput>) => {
  need(one('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL', id), 'document');
  const out: Row = {};
  if (f.name !== undefined) out.name = clean(f.name, 120, 'name') || bad('name is required');
  if (f.expires_on !== undefined) {
    if (f.expires_on !== null && !isDate(f.expires_on)) bad('expires_on must be YYYY-MM-DD');
    out.expires_on = f.expires_on;
    for (const c of REMIND_COLS) out[c] = 0;
  }
  if (f.where_kept !== undefined) out.where_kept = clean(f.where_kept, 120, 'where_kept');
  if (f.note !== undefined) out.note = clean(f.note, 1000, 'note');
  if (f.tags !== undefined) out.tags = JSON.stringify(tagsOf(f.tags));
  if (f.kind !== undefined) out.kind = f.kind;
  if (f.record_id !== undefined) out.record_id = f.record_id;
  patch('documents', id, out);
  return getDocument(id);
};
export const deleteDocument = (id: string) => { softDelete('documents', id); return { id, deleted: true }; };

export type DocReminder = { id: string; name: string; days_left: number; threshold: 60 | 30 | 7 | 0 | 'after'; message: string; car_id: string | null };
/**
 * Documents that crossed a reminder point: 60, 30, 7, 0 days left, or once after the end date.
 * Only the nearest point crossed pushes (a document first seen at 5 days left gets the 7-day line, not three pushes).
 */
export const documentReminders = (today = lifeToday()): DocReminder[] => {
  const out: DocReminder[] = [];
  for (const d of listDocuments(today)) {
    const n = d.days_left as number | null;
    if (n === null || d.renewed) continue;
    const ref ={ id: String(d.id), name: String(d.name), days_left: n, car_id: (d.car_id as string | null) ?? null };
    if (n < 0) {
      if (d.reminded_after) continue;
      patch('documents', ref.id, Object.fromEntries(REMIND_COLS.map((c) => [c, 1])));
      out.push({ ...ref, threshold: 'after', message: docLine(ref.name, n) });
      continue;
    }
    const hit = [...DOC_THRESHOLDS].reverse().find((t) => n <= t); // nearest point crossed: 0, then 7, 30, 60
    if (hit === undefined || d[`reminded_${hit}`]) continue;
    patch('documents', ref.id, Object.fromEntries(DOC_THRESHOLDS.filter((t) => t >= hit).map((t) => [`reminded_${t}`, 1])));
    out.push({ ...ref, threshold: hit, message: docLine(ref.name, n) + '.' });
  }
  return out;
};

// =====================================================================================================
// Cooling-off wishlist (72 h above $20) + "Can I afford it?"
// =====================================================================================================
export const COOL_OFF_USD = 20;
export const COOL_OFF_HOURS = 72;

export const listWishlist = (status = 'open', at = new Date()) => all<Row>(
  `SELECT * FROM wishlist WHERE deleted_at IS NULL AND (? = 'all' OR status = ?) ORDER BY ready_on, created_at`, status, status,
).map((w) => {
  const left = Date.parse(String(w.ready_on)) - at.getTime();
  return { ...w, pushed: !!w.pushed, ready: left <= 0, hours_left: left > 0 ? Math.ceil(left / 3600000) : 0 };
});

export const addWish = (w: { id?: string; name: string; price: number; currency?: string; note?: string }, at = new Date()) => {
  const name = clean(w.name, 120, 'name');
  if (!name) bad('name is required');
  const price = Number(w.price);
  if (!Number.isFinite(price) || price < 0 || price > 1e9) bad('price must be >= 0');
  const currency = String(w.currency ?? 'USD').toUpperCase();
  if (!(money.CURRENCIES as readonly string[]).includes(currency)) bad(`currency must be one of ${money.CURRENCIES.join(', ')}`);
  const usd = round(price * money.rateFor(currency, lifeDay(at)).rate, 2);
  const ready_on = usd > COOL_OFF_USD ? new Date(at.getTime() + COOL_OFF_HOURS * 3600000).toISOString() : at.toISOString();
  const id = idOr(w.id);
  insert('wishlist', { id, name, price, currency, usd, ready_on, note: clean(w.note, 500, 'note'), pushed: usd > COOL_OFF_USD ? 0 : 1 });
  return need(listWishlist('all', at).find((x) => x.id === id), 'wish');
};
export const setWishStatus = (id: string, status: 'open' | 'bought' | 'dropped') => {
  if (!['open', 'bought', 'dropped'].includes(status)) bad('status must be open, bought or dropped');
  need(one('SELECT id FROM wishlist WHERE id = ? AND deleted_at IS NULL', id), 'wish');
  patch('wishlist', id, { status });
  return need(listWishlist('all').find((x) => x.id === id), 'wish');
};
export const deleteWish = (id: string) => { softDelete('wishlist', id); return { id, deleted: true }; };
/** Wishes whose cooling-off just ended (pushed once). */
export const wishlistReady = (at = new Date()) => {
  const rows = all<Row>(`SELECT id, name, price, currency FROM wishlist WHERE deleted_at IS NULL AND status = 'open' AND pushed = 0 AND ready_on <= ?`, at.toISOString());
  for (const r of rows) patch('wishlist', String(r.id), { pushed: 1 });
  return rows;
};

/**
 * What a purchase does to living cash and runway. Neutral numbers, no verdict words.
 * `from`: a savings-goal name, its account, or "car". Default is living cash: the car fund is untouched and no
 * car-fund delta is shown. Only a purchase paid from a savings-goal account moves that goal.
 */
export const afford = (amount: number, currency = 'USD', today = lifeToday(), from?: string) => {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0 || a > 1e10) bad('amount must be > 0');
  const cur = String(currency).toUpperCase();
  if (!(money.CURRENCIES as readonly string[]).includes(cur)) bad(`currency must be one of ${money.CURRENCIES.join(', ')}`);
  const rate = money.rateFor(cur, today);
  const usd = round(a * rate.rate, 2);
  const r = money.runway(today);
  const burn = r.weekly_burn_usd;
  const ref = from?.trim().toLowerCase();
  const goals = ref ? money.listSavingsGoals(today) : [];
  const isCar = !!ref && /^car( ?fund|_fund)?$/.test(ref);
  const goal = !ref ? undefined : isCar
    ? goals.find((g) => /car|merc|c-?class/i.test(String(g.name)))
    : goals.find((g) => {
      const acct = g.account_id ? money.getAccount(String(g.account_id)) : undefined;
      return String(g.id) === from || String(g.name).toLowerCase() === ref || (!!acct && (acct.id === from || String(acct.name).toLowerCase() === ref));
    });
  if (isCar && !goal) bad('No car-fund savings goal yet.');
  const after = goal ? r.cash_usd : round(r.cash_usd - usd, 2);
  const goalOut = goal ? (() => {
    const months = goal.monthly_needed_usd && goal.left_usd > 0 ? goal.left_usd / goal.monthly_needed_usd : null;
    const leftAfter = round(Number(goal.left_usd) + usd, 2);
    return { name: goal.name, saved_usd: goal.saved_usd, saved_after_usd: round(Number(goal.saved_usd) - usd, 2), left_usd: goal.left_usd,
      left_after_usd: leftAfter, target_date: goal.target_date ?? null, monthly_needed_usd: goal.monthly_needed_usd,
      monthly_needed_after_usd: months ? round(leftAfter / months, 2) : null };
  })() : null;
  return {
    amount: a, currency: cur, usd, rate_estimated: rate.estimated,
    from: goal ? 'savings_goal' : 'living_cash',
    cash_usd: r.cash_usd, cash_after_usd: after, weekly_burn_usd: burn,
    runway_weeks: r.runway_weeks, runway_after_weeks: burn > 0 ? round(Math.max(0, after) / burn, 1) : null,
    under_8_weeks_after: burn > 0 && after / burn < 8,
    weeks_of_spend: burn > 0 ? round(usd / burn, 1) : null,
    car_fund: goalOut,
    cooling_off: usd > COOL_OFF_USD ? `Above $${COOL_OFF_USD}: add it to the wishlist, decide in ${COOL_OFF_HOURS} h.` : null,
  };
};

// =====================================================================================================
// Price memory: what did this cost last time?
// =====================================================================================================
export const priceMemory = (q: string, limit = 20) => {
  const term = String(q ?? '').trim().toLowerCase().slice(0, 60);
  if (term.length < 2) bad('search needs 2+ letters');
  const like = `%${term.replace(/[%_]/g, '')}%`;
  const rows = all<Row>(`SELECT r.id, r.amount, r.currency, r.usd, r.day, r.note, r.payee FROM records r
    WHERE r.deleted_at IS NULL AND r.kind = 'expense' AND (LOWER(r.note) LIKE ? OR LOWER(COALESCE(r.payee, '')) LIKE ?)
    ORDER BY r.day DESC, r.at DESC LIMIT ?`, like, like, Math.min(Math.max(1, limit), 100));
  const byCur = new Map<string, number[]>();
  for (const r of rows) { const l = byCur.get(r.currency) ?? []; l.push(Number(r.amount)); byCur.set(r.currency, l); }
  const stats = [...byCur.entries()].map(([currency, v]) => ({
    currency, n: v.length, last: v[0], min: Math.min(...v), max: Math.max(...v), avg: round(v.reduce((s, x) => s + x, 0) / v.length, 2),
  }));
  return { q: term, count: rows.length, last: rows[0] ?? null, stats, entries: rows };
};


// =====================================================================================================
// Estimate learning: real focus minutes vs est_minutes on done tasks, per tag.
// =====================================================================================================
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const estimates = (minSamples = 3) => {
  const rows = all<Row>(`SELECT t.id, t.est_minutes, t.tags, SUM(f.minutes) AS actual FROM tasks t JOIN focus_sessions f ON f.task_id = t.id AND f.paused_ms <= 600000
    WHERE t.status = 'done' AND t.deleted_at IS NULL AND t.est_minutes > 0 GROUP BY t.id HAVING actual > 0`);
  const ratios = rows.map((r) => ({ tags: j<string[]>(r.tags, []), ratio: Number(r.actual) / Number(r.est_minutes) }));
  const groups = new Map<string, number[]>();
  for (const r of ratios) for (const t of r.tags.length ? r.tags : ['untagged']) { const l = groups.get(t) ?? []; l.push(r.ratio); groups.set(t, l); }
  const by_tag = [...groups.entries()].map(([tag, v]) => ({ tag, n: v.length, ratio: round(median(v), 2) }))
    .sort((a, b) => b.n - a.n);
  return {
    overall: { n: ratios.length, ratio: ratios.length ? round(median(ratios.map((r) => r.ratio)), 2) : null },
    by_tag, min_samples: minSamples,
    note: 'Ratio = real minutes ÷ estimate (median). 1.5 means tasks take half again as long as planned.',
  };
};
/** Suggested minutes for a new estimate, if there is enough history. */
export const estimateHint = (minutes: number, tags: string[] = []) => {
  const e = estimates();
  const t = tags.map((x) => e.by_tag.find((b) => b.tag === x)).find((b) => b && b.n >= e.min_samples);
  const ratio = t?.ratio ?? (e.overall.n >= e.min_samples ? e.overall.ratio : null);
  if (!ratio || Math.abs(ratio - 1) < 0.1) return null;
  return { minutes, suggest: Math.max(5, Math.round((minutes * ratio) / 5) * 5), ratio, from: t ? `#${t.tag}` : 'all tasks' };
};

// =====================================================================================================
// FSRS-4.5 flashcards.
// =====================================================================================================
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5, FACTOR = 19 / 81, RETENTION = 0.9;
const clampD = (d: number) => Math.min(10, Math.max(1, d));
const d0 = (g: number) => clampD(W[4] - (g - 3) * W[5]);
export const retrievability = (elapsedDays: number, s: number) => (1 + FACTOR * elapsedDays / s) ** DECAY;
export const intervalDays = (s: number) => Math.max(1, Math.round((s / FACTOR) * (RETENTION ** (1 / DECAY) - 1)));
export const fsrsNext = (c: { state: string; stability: number; difficulty: number; last_review: string | null }, grade: number, at = new Date()) => {
  if (![1, 2, 3, 4].includes(grade)) bad('grade must be 1 (again), 2 (hard), 3 (good) or 4 (easy)');
  let s: number, d: number;
  if (c.state === 'new' || !c.last_review || !(c.stability > 0)) {
    s = W[grade - 1]; d = d0(grade);
  } else {
    const t = Math.max(0, (at.getTime() - Date.parse(c.last_review)) / 86400000);
    const r = retrievability(t, c.stability);
    const dPrime = c.difficulty - W[6] * (grade - 3);
    d = clampD(W[7] * d0(3) + (1 - W[7]) * dPrime);
    if (grade === 1) {
      s = Math.min(c.stability, W[11] * c.difficulty ** -W[12] * ((c.stability + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r)));
    } else {
      s = c.stability * (Math.exp(W[8]) * (11 - c.difficulty) * c.stability ** -W[9] * (Math.exp(W[10] * (1 - r)) - 1)
        * (grade === 2 ? W[15] : 1) * (grade === 4 ? W[16] : 1) + 1);
    }
  }
  s = Math.max(0.1, s);
  const due = grade === 1 ? new Date(at.getTime() + 10 * 60000) : new Date(at.getTime() + intervalDays(s) * 86400000);
  return { stability: round(s, 4), difficulty: round(d, 4), due: due.toISOString(), state: grade === 1 ? 'learning' : 'review',
    interval_days: grade === 1 ? 0 : intervalDays(s) };
};

const toCard = (r: Row) => ({ ...r, stability: Number(r.stability), difficulty: Number(r.difficulty) });
export const getCard = (id: string) => toCard(need(one<Row>('SELECT * FROM cards WHERE id = ? AND deleted_at IS NULL', id), 'card'));
export const addCard = (c: { id?: string; front: string; back: string; deck?: string; gender?: string | null; example?: string }, at = new Date()) => {
  const front = clean(c.front, 200, 'front'), back = clean(c.back, 300, 'back');
  if (!front || !back) bad('front and back are required');
  const gender = c.gender === undefined || c.gender === null || c.gender === '' ? null : String(c.gender);
  if (gender !== null && !['m', 'f'].includes(gender)) bad('gender must be m, f or empty');
  const dup = one<{ id: string }>(`SELECT id FROM cards WHERE deleted_at IS NULL AND LOWER(front) = LOWER(?) AND deck = ?`, front, c.deck ?? 'General');
  if (dup && !c.id) return { ...getCard(dup.id), duplicate: true };
  const id = idOr(c.id);
  insert('cards', { id, front, back, deck: clean(c.deck ?? 'General', 40, 'deck') || 'General', gender, example: c.example ? clean(c.example, 300, 'example') : null,
    due: at.toISOString(), stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 'new', last_review: null });
  return getCard(id);
};
export const listCards = (deck?: string, limit = 200) => all<Row>(
  `SELECT * FROM cards WHERE deleted_at IS NULL ${deck ? 'AND deck = ?' : ''} ORDER BY created_at DESC LIMIT ?`, ...(deck ? [deck, limit] : [limit]),
).map(toCard);
export const deleteCard = (id: string) => { softDelete('cards', id); return { id, deleted: true }; };
/** Cards due now (reviews first, then up to `newPerDay` new ones). */
export const cardQueue = (limit = 20, at = new Date(), newPerDay = 10) => {
  const nowIso = at.toISOString();
  const due = all<Row>(`SELECT * FROM cards WHERE deleted_at IS NULL AND state != 'new' AND due <= ? ORDER BY due LIMIT ?`, nowIso, limit).map(toCard);
  const today = lifeDay(at);
  const newToday = all<Row>(`SELECT r.at FROM card_reviews r JOIN cards c ON c.id = r.card_id WHERE c.reps = 1 AND r.at >= ?`, isoFrom(today))
    .filter((r) => lifeDay(new Date(r.at)) === today).length;
  const room = Math.max(0, Math.min(limit - due.length, newPerDay - newToday));
  const fresh = room ? all<Row>(`SELECT * FROM cards WHERE deleted_at IS NULL AND state = 'new' ORDER BY created_at LIMIT ?`, room).map(toCard) : [];
  const counts = one<Row>(`SELECT SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END) AS new_total,
    SUM(CASE WHEN state != 'new' AND due <= ? THEN 1 ELSE 0 END) AS due_total, COUNT(*) AS total FROM cards WHERE deleted_at IS NULL`, nowIso);
  return { cards: [...due, ...fresh], due: Number(counts?.due_total ?? 0), new: Number(counts?.new_total ?? 0), total: Number(counts?.total ?? 0) };
};
export const reviewCard = (id: string, grade: number, at = new Date()) => {
  const c = getCard(id);
  const n = fsrsNext({ state: String(c.state), stability: c.stability, difficulty: c.difficulty, last_review: c.last_review ?? null }, grade, at);
  patch('cards', id, { stability: n.stability, difficulty: n.difficulty, due: n.due, state: n.state, reps: Number(c.reps) + 1,
    lapses: Number(c.lapses) + (grade === 1 && c.state !== 'new' ? 1 : 0), last_review: at.toISOString() });
  run('INSERT INTO card_reviews (id, card_id, grade, at) VALUES (?, ?, ?, ?)', idOr(), id, grade, at.toISOString());
  return { ...getCard(id), interval_days: n.interval_days };
};

/** "la maison - the house" → card draft with gender from the article. Shared text from the phone lands here. */
export const draftCard = (text: string) => {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 400);
  if (!t) bad('text is required');
  const m = t.match(/^(.+?)\s*(?:\s[-–—=:]\s|\t|\s?=\s?|\s?:\s)\s*(.+)$/);
  const front = (m ? m[1] : t).trim().replace(/^["“«]|["”»]$/g, '');
  const back = m ? m[2].trim() : '';
  const lower = front.toLowerCase();
  const gender = /^(le|un|ce|mon|ton|son)\s/.test(lower) ? 'm' : /^(la|une|cette|ma|ta|sa)\s/.test(lower) ? 'f' : null;
  return { front, back, gender, deck: 'General', needs_back: !back,
    note: gender === null && /^(l'|l’|les\s|des\s)/.test(lower) ? 'Gender hidden by the article: add it if you know it.' : undefined };
};

// =====================================================================================================
// Brain dump → plan: split a wall of text into task / expense / note guesses. Nothing saves without commit.
// =====================================================================================================
type DumpItem = { kind: 'task' | 'expense' | 'note'; text: string };
const MONEY_RE = /(^|\s)[+-]?\d[\d,.]*\s*(usd|\$|eur|€)(\s|$)|(^|\s)(usd|\$|eur|€)\s*\d/i;
const SPENT_RE = /\b(paid|spent|bought|cost|pay|achet|payé)\b/i;
export const brainDumpDraft = (text: string): DumpItem[] => {
  const raw = String(text ?? '');
  if (raw.length > 20000) bad('dump is too long (max 20,000 characters)');
  return raw.split(/\r?\n|;\s+|•/).map((l) => l.replace(/^\s*([-*]|\d+[.)])\s+/, '').trim()).filter((l) => l.length > 1).slice(0, 100).map((l) => {
    if (/^(note|idea|thought)s?:/i.test(l)) return { kind: 'note' as const, text: l.replace(/^[a-z]+:\s*/i, '') };
    if (MONEY_RE.test(l) || (SPENT_RE.test(l) && /\d/.test(l))) return { kind: 'expense' as const, text: l };
    if (/\?$/.test(l) || /^(i feel|i think|maybe|why)\b/i.test(l)) return { kind: 'note' as const, text: l };
    return { kind: 'task' as const, text: l };
  });
};
export const brainDumpCommit = async (items: unknown) => {
  if (!Array.isArray(items) || items.length > 100) bad('items must be a list (max 100)');
  const out = { tasks: 0, expenses: 0, notes: 0, failed: [] as { text: string; error: string }[] };
  for (const it of items as DumpItem[]) {
    const text = String(it?.text ?? '').trim().slice(0, 500);
    if (!text) continue;
    try {
      if (it.kind === 'task') { tasks.quickAdd(text, { source: 'brain_dump' }); out.tasks++; }
      else if (it.kind === 'expense') { money.quickLog(text.replace(/€/g, ' EUR').replace(/\$/g, ' USD ')); out.expenses++; }
      else if (it.kind === 'note') { await captureNote(clean(text, 500, 'note')); out.notes++; }
      else out.failed.push({ text, error: 'kind must be task, expense or note' });
    } catch (e) { out.failed.push({ text, error: e instanceof Error ? e.message : String(e) }); }
  }
  return out;
};

// =====================================================================================================
// Parking lot: a thought during focus goes to the Inbox tagged #parked. Back to work in 2 s.
// =====================================================================================================
export const park = (text: string) => {
  const t = clean(text, 300, 'text');
  if (!t) bad('text is required');
  const task = tasks.quickAdd(t, { tags: ['parked'], source: 'parked' });
  return { id: task.id, title: task.title, message: 'Parked. Back to the timer.' };
};
export const parked = () => tasks.listTasks({ view: 'all', tag: 'parked', limit: 50 }).filter((t) => t.status === 'open');

// =====================================================================================================
// Local dish seed (estimates per 100 g) + bread fractions.
// =====================================================================================================
type Dish = [slug: string, name: string, kcal: number, p: number, c: number, f: number, servings: [string, number][]];
export const LOCAL_FOODS: Dish[] = [
  ['khobz', 'Khobz (baguette-style bread)', 270, 9, 55, 1.5, [['¼ khobz', 60], ['½ khobz', 120], ['1 khobz', 240]]],
  ['kesra', 'Kesra (semolina flatbread)', 300, 8, 52, 7, [['¼ kesra', 70], ['½ kesra', 140], ['1 kesra', 280]]],
  ['matlou3', 'Matlou3 (pan bread)', 265, 8.5, 52, 2.5, [['¼ matlou3', 75], ['½ matlou3', 150], ['1 matlou3', 300]]],
  ['msemen', 'Msemen', 330, 7, 45, 14, [['1 msemen', 80]]],
  ['baghrir', 'Baghrir', 190, 5, 38, 1.5, [['1 baghrir', 50]]],
  ['harcha', 'Harcha', 380, 7, 55, 14, [['1 harcha', 70]]],
  ['couscous-plain', 'Couscous, plain cooked', 112, 3.8, 23, 0.2, [['1 plate', 250]]],
  ['couscous-legumes', 'Couscous with vegetables', 130, 4, 22, 3, [['1 plate', 350]]],
  ['couscous-lham', 'Couscous with lamb', 165, 8, 20, 6, [['1 plate', 400]]],
  ['couscous-djedj', 'Couscous with chicken', 150, 9, 20, 4, [['1 plate', 400]]],
  ['mesfouf', 'Mesfouf (sweet couscous, raisins)', 200, 5, 38, 3.5, [['1 bowl', 250]]],
  ['berkoukes', 'Berkoukes', 140, 5.5, 21, 4, [['1 plate', 350]]],
  ['chorba-frik', 'Chorba frik (djari)', 60, 3.5, 7, 2, [['1 bowl', 300]]],
  ['hrira', 'Hrira', 70, 3.5, 10, 1.8, [['1 bowl', 300]]],
  ['chorba-beida', 'Chorba beida', 65, 3.5, 6, 3, [['1 bowl', 300]]],
  ['loubia', 'Loubia (white bean stew)', 110, 6, 15, 3, [['1 plate', 300]]],
  ['adas', 'Lentil stew (adas)', 105, 6.5, 15, 2.5, [['1 plate', 300]]],
  ['doubara', 'Doubara (chickpea stew)', 140, 7, 18, 4.5, [['1 bowl', 300]]],
  ['chakhchoukha', 'Chakhchoukha', 170, 6, 24, 5.5, [['1 plate', 400]]],
  ['rechta', 'Rechta', 155, 6, 23, 4.5, [['1 plate', 400]]],
  ['tlitli', 'Tlitli', 160, 6.5, 24, 4.5, [['1 plate', 350]]],
  ['chtitha-djedj', 'Chtitha djedj (chicken in sauce)', 150, 14, 4, 9, [['1 portion', 250]]],
  ['chtitha-lham', 'Chtitha lham (meat in sauce)', 190, 15, 4, 13, [['1 portion', 250]]],
  ['tajine-zitoune', 'Tajine zitoune (chicken, olives)', 140, 13, 5, 8, [['1 portion', 250]]],
  ['lham-lahlou', 'Lham lahlou (sweet meat tajine)', 210, 10, 25, 8, [['1 portion', 200]]],
  ['tajine-jelbana', 'Tajine jelbana (peas)', 120, 7, 10, 6, [['1 portion', 250]]],
  ['dolma', 'Dolma', 130, 6, 10, 7.5, [['1 portion', 250]]],
  ['mtewem', 'Mtewem', 190, 12, 7, 13, [['1 portion', 250]]],
  ['batata-kbab', 'Batata kbab', 140, 8, 12, 7, [['1 portion', 250]]],
  ['mloukhia', 'Mloukhia', 120, 8, 5, 8, [['1 portion', 250]]],
  ['gratin', 'Gratin (potato, béchamel)', 150, 6, 12, 9, [['1 portion', 250]]],
  ['tajine-sardine', 'Kefta sardine tajine', 170, 15, 5, 10, [['1 portion', 250]]],
  ['roz-marqa', 'Rice with sauce', 150, 4, 25, 3.5, [['1 plate', 300]]],
  ['chakchouka', 'Chakchouka (peppers, tomato, egg)', 95, 4.5, 6, 6, [['1 plate', 250]]],
  ['hmiss', 'Hmiss', 85, 1.5, 7, 6, [['1 side', 100]]],
  ['mechouia', 'Salade méchouia', 80, 1.5, 7, 5.5, [['1 side', 100]]],
  ['karantika', 'Karantika (garantita)', 220, 7, 18, 13, [['1 portion', 150]]],
  ['bourek', 'Bourek (meat, fried)', 280, 11, 22, 16, [['1 bourek', 60]]],
  ['maakouda', 'Maakouda', 210, 5, 22, 11, [['1 piece', 70]]],
  ['mhajeb', 'Mhajeb', 250, 6, 35, 9.5, [['1 mhajeb', 120]]],
  ['sfenj', 'Sfenj', 330, 6, 42, 15, [['1 sfenj', 70]]],
  ['merguez', 'Merguez, grilled', 300, 15, 2, 26, [['1 merguez', 50]]],
  ['kefta', 'Kefta, grilled', 250, 18, 4, 18, [['1 kefta', 40]]],
  ['djedj-forn', 'Roast chicken (djaj forn)', 200, 25, 0, 11, [['1 thigh', 150]]],
  ['sardine-grill', 'Sardines, grilled', 210, 25, 0, 12, [['1 portion', 150]]],
  ['pizza-dz', 'Pizza (street, square)', 260, 10, 32, 10, [['1 slice', 120]]],
  ['shawarma', 'Shawarma sandwich', 230, 12, 24, 9.5, [['1 sandwich', 300]]],
  ['casse-croute', 'Casse-croûte (frites, meat)', 260, 9, 30, 12, [['1 sandwich', 350]]],
  ['frites', 'Frites', 300, 3.5, 38, 15, [['1 portion', 150]]],
  ['makrout', 'Makrout', 420, 5, 60, 18, [['1 makrout', 40]]],
  ['zlabia', 'Zlabia', 400, 2, 70, 13, [['1 piece', 30]]],
  ['kalb-el-louz', 'Kalb el louz', 380, 5, 60, 13, [['1 piece', 80]]],
  ['griwech', 'Griwech', 470, 6, 55, 25, [['1 piece', 25]]],
  ['baklawa', 'Baklawa', 450, 7, 50, 25, [['1 piece', 40]]],
  ['mchewek', 'Mchewek', 450, 10, 50, 23, [['1 piece', 30]]],
  ['tamina', 'Tamina', 420, 5, 60, 18, [['1 portion', 50]]],
  ['lben', 'Lben', 40, 3, 4.5, 1.5, [['1 glass', 250]]],
  ['raib', 'Raib', 60, 3.5, 4.5, 3.2, [['1 cup', 200]]],
  ['yaourt-sucre', 'Yogurt, sweetened', 95, 3.5, 14, 2.8, [['1 pot', 110]]],
  ['fromage-portion', 'Cheese triangle', 240, 10, 6, 20, [['1 triangle', 17.5]]],
  ['deglet-nour', 'Dates (deglet nour)', 282, 2.5, 75, 0.4, [['1 date', 8], ['3 dates', 24]]],
  ['atay', 'Mint tea, sweetened', 40, 0, 10, 0, [['1 glass', 150]]],
  ['cafe-lait', 'Café au lait, sweetened', 45, 1.7, 7, 1.2, [['1 cup', 200]]],
];
export const seedLocalFoods = () => {
  let added = 0;
  for (const [slug, name, kcal, protein, carbs, fat, servings] of LOCAL_FOODS) {
    const ref = `dz-${slug}`;
    const exists = one('SELECT id FROM foods WHERE source = ? AND source_ref = ?', 'estimated', ref);
    if (exists) continue;
    food.addFood({ id: `dzfood-${slug}`, source: 'estimated', source_ref: ref, name, kcal, protein, carbs, fat, state: 'cooked',
      servings: servings.map(([label, grams]) => ({ label, grams })) });
    added++;
  }
  return { added, total: LOCAL_FOODS.length, note: 'Home-cooking estimates. Portions vary; edit to taste.' };
};

// =====================================================================================================
// Weather strip (Open-Meteo, free, no key). 30-min cache. Fails soft.
// =====================================================================================================
const WMO: Record<number, string> = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
export const weather = async (fetcher: (url: string) => Promise<Row> = async (u) => {
  const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`weather ${r.status}`);
  return r.json();
}, at = new Date()) => {
  const cached = j<Row | null>(kvGet('weather_cache'), null);
  if (cached && at.getTime() - Date.parse(cached.fetched_at) < 30 * 60000) return { ...cached, cached: true };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LOCATION.lat}&longitude=${LOCATION.lng}` +
    '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=' + encodeURIComponent(TZ) + '&forecast_days=1';
  try {
    const d = await fetcher(url);
    const code = Number(d?.current?.weather_code);
    const out = { place: LOCATION.name, temp_c: round(Number(d?.current?.temperature_2m), 0), code, text: WMO[code] ?? 'Weather',
      max_c: round(Number(d?.daily?.temperature_2m_max?.[0]), 0), min_c: round(Number(d?.daily?.temperature_2m_min?.[0]), 0),
      rain_pct: Number(d?.daily?.precipitation_probability_max?.[0] ?? 0), fetched_at: at.toISOString() };
    if (!Number.isFinite(out.temp_c)) throw new Error('weather: bad data');
    kvSet('weather_cache', JSON.stringify(out));
    return { ...out, cached: false };
  } catch (e) {
    if (cached) return { ...cached, cached: true, stale: true };
    return { place: LOCATION.name, error: e instanceof Error ? e.message : String(e) };
  }
};

// =====================================================================================================
// Gym door tap: which routine is next (the one after the last finished routine).
// =====================================================================================================
export const todayRoutine = () => {
  const active = gym.activeWorkout();
  const routines = gym.listRoutines();
  const last = one<Row>(`SELECT routine_id, name, day FROM workouts WHERE deleted_at IS NULL AND status = 'done' AND routine_id IS NOT NULL ORDER BY started_at DESC LIMIT 1`);
  if (!routines.length) return { active, routine: null, last: last ?? null };
  const i = last ? routines.findIndex((r: Row) => r.id === last.routine_id) : -1;
  return { active, routine: routines[(i + 1) % routines.length], last: last ?? null };
};

// =====================================================================================================
// Return screen after a gap: days since anything was logged.
// =====================================================================================================
export const daysAway = (today = lifeToday()) => {
  const q = (sql: string) => one<{ t: string | null }>(sql)?.t ?? null;
  const stamps = [
    q(`SELECT MAX(updated_at) AS t FROM tasks`),
    q(`SELECT MAX(at) AS t FROM food_log WHERE deleted_at IS NULL`),
    q(`SELECT MAX(at) AS t FROM records WHERE deleted_at IS NULL`),
    q(`SELECT MAX(done_at) AS t FROM sets WHERE deleted_at IS NULL`),
    q(`SELECT MAX(started_at) AS t FROM focus_sessions`),
    q(`SELECT MAX(at) AS t FROM card_reviews`),
  ].filter((x): x is string => !!x);
  if (!stamps.length) return { days: 0, last_at: null, returning: false };
  const last = stamps.sort().at(-1)!;
  const days = Math.max(0, daysBetween(lifeDay(new Date(last)), today));
  return { days, last_at: last, returning: days >= 3,
    message: days >= 3 ? 'Welcome back. Nothing to catch up on. Pick one thing for today.' : null };
};

// =====================================================================================================
// ntfy action tokens: signed, short-lived links for the buttons on a push (work from the lock screen).
//   done / later / start / snooze carry a task id; `more` carries a timer label (adds 5 min).
// =====================================================================================================
export const ACTIONS = ['done', 'later', 'start', 'snooze', 'more'] as const;
export type ActionKind = (typeof ACTIONS)[number];
let memKey: string | null = null;
const actionKey = () => {
  const k = secret('MOSAIC_ACTION_KEY');
  if (k) return k;
  const fresh = randomBytes(32).toString('hex');
  try { setSecret('MOSAIC_ACTION_KEY', fresh); return fresh; } catch { memKey ??= fresh; return memKey; }
};
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
export const signAction = (a: ActionKind, ref: string, ttlHours = 36, at = new Date()) => {
  if (!ACTIONS.includes(a)) bad('unknown action');
  const payload = b64(JSON.stringify({ a, t: String(ref).slice(0, 80), e: Math.floor(at.getTime() / 1000) + ttlHours * 3600 }));
  const sig = b64(createHmac('sha256', actionKey()).update(payload).digest());
  return `${payload}.${sig}`;
};
export const verifyAction = (token: string, at = new Date()): { a: ActionKind; t: string } => {
  const [payload, sig] = String(token ?? '').split('.');
  if (!payload || !sig || payload.length > 400) throw new AppError('bad_request', 'bad action link');
  const want = createHmac('sha256', actionKey()).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new AppError('bad_request', 'bad action link');
  const p = j<Row>(Buffer.from(payload, 'base64url').toString('utf8'), null);
  if (!p || !ACTIONS.includes(p.a) || typeof p.t !== 'string') throw new AppError('bad_request', 'bad action link');
  if (Number(p.e) * 1000 < at.getTime()) throw new AppError('bad_request', 'This link has expired. Open the app.');
  return { a: p.a, t: p.t };
};
export type ActionResult = { action: ActionKind; message: string; task?: string; task_id?: string; minutes?: number; label?: string };
/**
 * Runs a verified action. `start` and `more` return minutes + label so the caller starts the timer;
 * `snooze` returns the task id so the caller schedules the reminder again.
 */
export const performAction = (token: string, today = lifeToday(), at = new Date()): ActionResult => {
  const { a, t } = verifyAction(token, at);
  if (a === 'more') return { action: a, minutes: 5, label: t || 'Focus', message: `Timer 5 more min: ${t || 'Focus'}` };
  const task = tasks.resolveRef(t);
  if (a === 'done') { tasks.completeTask(task.id, today); return { action: a, task: task.title, task_id: task.id, message: 'Done.' }; }
  if (a === 'later') { tasks.setDay([task.id], addDays(today, 1)); return { action: a, task: task.title, task_id: task.id, message: 'Moved to tomorrow.' }; }
  if (a === 'snooze') return { action: a, task: task.title, task_id: task.id, message: 'Snoozed.' };
  const g = timerGuard(Math.min(50, task.est_minutes || 10), at);
  const minutes = g.ok ? g.minutes : g.suggest_minutes!;
  return { action: a, task: task.title, task_id: task.id, minutes, label: task.title, message: `Timer ${minutes} min: ${task.first_action || task.title}` };
};
const ACTION_LABEL: Record<ActionKind, string> = { done: 'Done', later: 'Tomorrow', start: 'Start timer', snooze: 'Snooze', more: '+5 min' };
/** One ntfy `http` action button (POST to /act/<token>). */
export const pushAction = (publicUrl: string, a: ActionKind, ref: string, label = ACTION_LABEL[a]) =>
  ({ action: 'http' as const, label, url: `${publicUrl}/act/${signAction(a, ref)}`, method: 'POST', clear: true });
/** ntfy `actions` for a task push. Default Done / Tomorrow / Start timer. */
export const taskPushActions = (publicUrl: string, task_id: string, kinds: ActionKind[] = ['done', 'later', 'start'], snoozeMin?: number) =>
  kinds.slice(0, 3).map((k) => pushAction(publicUrl, k, task_id, k === 'snooze' && snoozeMin ? `Snooze ${snoozeMin}m` : ACTION_LABEL[k]));

// timer clock helpers used by the Home countdown ring
export const clock = (at = new Date()) => ({ now: at.toISOString(), hhmm: hhmm(at), day: dateOf(at), life_day: lifeDay(at), tz: TZ, at_ms: at.getTime(), ts: now() });
