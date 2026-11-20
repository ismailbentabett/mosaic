// Thrift: recipe → shopping, rate freshness ask, recurring-cost check, skipped-buy credit, for-whom spending,
// shop grouping, gym note carry-forward. Personal track only. Neutral wording: no streaks, no alarm words.
// Never store account/card numbers: free text is checked like the money store does.
import { AppError } from '../../errors.ts';
import { kvGet, kvSet } from '../../db.ts';
import { daysBetween, isDate, lifeDay, lifeToday } from '../../time.ts';
import { all, idOr, insert, need, now, one, patch, round, run, softDelete, type Row } from '../util.ts';
import * as money from '../money/store.ts';
import * as food from '../food/store.ts';
import * as gym from '../gym/store.ts';
import * as profile from '../profile/store.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
const NUMBERY = /\d[\d\s-]{11,}\d/;
const safeText = (s: unknown, max = 200) => {
  const t = String(s ?? '').trim().slice(0, max);
  if (NUMBERY.test(t)) bad('That looks like an account or card number. Do not store it here: see password manager.');
  return t;
};
/** Lowercase, no accents, no punctuation, single spaces. */
export const normName = (s: string) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const checkDay = (d: string | undefined, what = 'day') => { if (d !== undefined && !isDate(d)) bad(`${what} must be YYYY-MM-DD`); return d; };

// =====================================================================================================
// 1. Recipe → shopping list
// =====================================================================================================
const parseGrams = (q: unknown): number | null => {
  const m = String(q ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(g|kg)$/i);
  if (!m) return null;
  return Number(m[1]) * (m[2].toLowerCase() === 'kg' ? 1000 : 1);
};
export const fmtGrams = (g: number) => (g >= 1000 ? `${round(g / 1000, 2)} kg` : `${Math.ceil(g)} g`);

/**
 * Add a recipe's ingredients to the shopping list, scaled to `portions` × `days` (recipe base = its own portions).
 * An open item with the same name on that list is merged (grams summed); `skip` names are left out (already at home).
 */
export const recipeToShopping = (recipe: string, portions: number, opts: { days?: number; list?: string; skip?: string[] } = {}) => {
  const p = Number(portions);
  if (!Number.isFinite(p) || p <= 0 || p > 100) bad('portions must be > 0 and at most 100');
  const days = opts.days ?? 1;
  if (!Number.isInteger(days) || days < 1 || days > 31) bad('days must be a whole number 1-31');
  const r = food.getRecipe(recipe);
  const factor = (p * days) / Number(r.portions || 1);
  const list = safeText(opts.list ?? 'Groceries', 40) || 'Groceries';
  const skip = new Set((opts.skip ?? []).map(normName));
  const byFood = new Map<string, { name: string; grams: number }>();
  for (const it of r.items as Row[]) {
    const cur = byFood.get(String(it.food_id)) ?? { name: String(it.name), grams: 0 };
    cur.grams += Number(it.grams) * factor;
    byFood.set(String(it.food_id), cur);
  }
  const added: Row[] = [], merged: Row[] = [], skipped: string[] = [];
  for (const { name, grams } of byFood.values()) {
    if (skip.has(normName(name))) { skipped.push(name); continue; }
    const g = Math.ceil(grams);
    const open = all<Row>(`SELECT * FROM shopping_items WHERE deleted_at IS NULL AND done = 0 AND list = ?`, list)
      .find((s) => normName(String(s.name)) === normName(name));
    if (open) {
      const had = parseGrams(open.qty);
      const qty = had !== null ? fmtGrams(had + g) : open.qty ? `${open.qty} + ${fmtGrams(g)}` : fmtGrams(g);
      patch('shopping_items', String(open.id), { qty });
      merged.push({ id: open.id, name: open.name, qty });
    } else {
      added.push(money.addShopping(name, list, fmtGrams(g)));
    }
  }
  return { recipe: r.name, portions: p, days, factor: round(factor, 3), list, added, merged, skipped };
};

// =====================================================================================================
// 2. Rate freshness: one ask for today's EUR per USD when the last EUR rate is older than 7 days.
//    USD is the base currency, so the answer becomes the EUR rate directly (1 / answer).
// =====================================================================================================
export const RATE_ASK_PREFIX = 'money.rate_eur_per_usd.';
export const RATE_MAX_AGE_DAYS = 7;
export const EUR_PER_USD_RANGE = [0.3, 3] as const;

/** Queue one app ask for today's rate if the newest EUR rate is older than 7 days. Dedup: one unanswered at a time. */
export const rateFreshnessAsk = (today = lifeToday()) => {
  checkDay(today, 'today');
  const latest = one<{ d: string | null }>(`SELECT MAX(day) AS d FROM rates WHERE currency = 'EUR'`)!.d;
  const age = latest ? daysBetween(latest, today) : null;
  if (latest && age! <= RATE_MAX_AGE_DAYS) return { queued: false, latest, age_days: age, key: null as string | null };
  const pending = one<{ key: string }>(`SELECT key FROM asks WHERE key LIKE ? AND status != 'answered' ORDER BY key DESC LIMIT 1`,
    `${RATE_ASK_PREFIX}%`);
  if (pending) return { queued: false, latest, age_days: age, key: pending.key };
  const key = `${RATE_ASK_PREFIX}${today.replace(/-/g, '')}`;
  if (one(`SELECT 1 FROM asks WHERE key = ?`, key)) return { queued: false, latest, age_days: age, key };
  profile.addAsk({ key, module: 'money', answer_type: 'number', priority: 76,
    question: 'How many EUR for 1 USD today?', why: 'Keeps totals close to today. The last rate is over a week old.' });
  return { queued: true, latest, age_days: age, key };
};

/** Turn answered rate asks into an EUR rate on the day answered. Each answer applies once. */
export const applyRateAnswers = () => {
  const done = all<{ key: string; answered_at: string | null }>(`SELECT key, answered_at FROM asks WHERE key LIKE ? AND status = 'answered'`,
    `${RATE_ASK_PREFIX}%`);
  const applied: Row[] = [];
  for (const a of done) {
    if (kvGet(`thrift.rate_applied.${a.key}`)) continue;
    const fact = profile.profileGet(a.key).find((f) => f.key === a.key);
    const per = Number(fact?.value);
    kvSet(`thrift.rate_applied.${a.key}`, now());
    const day = a.answered_at ? lifeDay(new Date(a.answered_at)) : lifeToday();
    if (!Number.isFinite(per) || per < EUR_PER_USD_RANGE[0] || per > EUR_PER_USD_RANGE[1]) continue; // not a plausible EUR/USD number
    applied.push(money.setRate('EUR', 1 / per, day));
  }
  return applied;
};

// =====================================================================================================
// 3. Recurring-cost check. Rule: no recurring cost except Claude.
// =====================================================================================================
export const RECUR_ALLOWED = /claude|anthropic/i;
export type RecurringItem = {
  source: 'records' | 'planned'; name: string; currency: string; amount: number; occurrences: number; last_day: string | null;
  avg_gap_days: number | null; monthly_usd: number; record_ids: string[]; planned_id: string | null;
};

const monthlyFactor = (r: { freq: string; interval?: number; byday?: number[] }) => {
  const n = r.interval ?? 1;
  if (r.freq === 'daily') return 30.44 / n;
  if (r.freq === 'weekly') return (30.44 / (7 * n)) * Math.max(1, r.byday?.length ?? 1);
  if (r.freq === 'monthly') return 1 / n;
  return 1 / (12 * n);
};

/**
 * Personal expenses that look recurring: same payee (or note), amount within ±15%, 3+ occurrences 25–35 days apart;
 * plus planned payments. Anything mentioning Claude/Anthropic is left out. Records posted by a listed planned payment count once.
 */
export const recurringCosts = (o: { from?: string; to?: string; today?: string } = {}) => {
  checkDay(o.from, 'from'); checkDay(o.to, 'to');
  const today = checkDay(o.today, 'today') ?? lifeToday();
  const planned = money.listPlanned();
  const plannedIds = new Set(planned.map((p) => String(p.id)));
  const rows = all<Row>(`SELECT r.id, r.amount, r.currency, r.usd, r.day, r.note, r.payee, r.planned_id, c.name AS cat, pc.name AS parent
    FROM records r JOIN accounts a ON a.id = r.account_id LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
    WHERE r.deleted_at IS NULL AND r.kind = 'expense' AND a.track = 'personal' AND (? IS NULL OR r.day >= ?) AND (? IS NULL OR r.day <= ?)
    ORDER BY r.day, r.at`, o.from ?? null, o.from ?? null, o.to ?? null, o.to ?? null);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.planned_id && plannedIds.has(String(r.planned_id))) continue;
    if (RECUR_ALLOWED.test(`${r.payee ?? ''} ${r.note ?? ''} ${r.cat ?? ''} ${r.parent ?? ''}`)) continue;
    const base = normName(String(r.payee ?? '')) || normName(String(r.note ?? '')).replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base) continue;
    const k = `${base}|${r.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const items: RecurringItem[] = [];
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    let best: Row[] = [];
    for (let i = 0; i < g.length; i++) {
      const chain = [g[i]];
      const ref = Number(g[i].amount);
      for (let k = i + 1; k < g.length; k++) {
        const gap = daysBetween(String(chain[chain.length - 1].day), String(g[k].day));
        if (gap > 35) break;
        if (gap >= 25 && Math.abs(Number(g[k].amount) - ref) <= ref * 0.15) chain.push(g[k]);
      }
      if (chain.length > best.length) best = chain;
    }
    if (best.length < 3) continue;
    const gaps = best.slice(1).map((r, i) => daysBetween(String(best[i].day), String(r.day)));
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const avgUsd = best.reduce((a, r) => a + Number(r.usd), 0) / best.length;
    const avgAmt = best.reduce((a, r) => a + Number(r.amount), 0) / best.length;
    const last = best[best.length - 1];
    items.push({ source: 'records', name: String(last.payee || last.note), currency: String(last.currency), amount: round(avgAmt, 2),
      occurrences: best.length, last_day: String(last.day), avg_gap_days: round(avgGap, 1), monthly_usd: round(avgUsd * (30.44 / avgGap), 2),
      record_ids: best.map((r) => String(r.id)), planned_id: null });
  }
  for (const p of planned) {
    const t = (p.template ?? {}) as Row;
    if (RECUR_ALLOWED.test(`${p.name} ${t.note ?? ''} ${t.payee ?? ''} ${t.category ?? ''}`)) continue;
    const acct = t.account ? money.getAccount(String(t.account)) : undefined;
    if (acct && acct.track !== 'personal') continue;
    if (t.kind === 'income') continue;
    const currency = String(t.currency ?? acct?.currency ?? 'USD').toUpperCase();
    const amount = Number(t.amount) || 0;
    const usd = amount * money.rateFor(currency, today).rate;
    items.push({ source: 'planned', name: String(p.name), currency, amount, occurrences: 0, last_day: null, avg_gap_days: null,
      monthly_usd: round(usd * monthlyFactor((p.recur ?? { freq: 'monthly' }) as Row), 2), record_ids: [], planned_id: String(p.id) });
  }
  items.sort((a, b) => b.monthly_usd - a.monthly_usd);
  return {
    rule: 'No recurring cost except Claude.', items, count: items.length,
    monthly_usd: round(items.reduce((a, b) => a + b.monthly_usd, 0), 2),
    message: items.length ? `${items.length} cost${items.length === 1 ? '' : 's'} look recurring. Keep, cancel or ignore: your call.` : 'Nothing looks recurring besides Claude.',
  };
};

// =====================================================================================================
// 4. Skipped-buy credit. A note to self, never income, never touches balances.
// =====================================================================================================
const getSkip = (id: string) => one<Row>(`SELECT * FROM skipped_buys WHERE id = ? AND deleted_at IS NULL`, id);
const hydSkip = (r: Row) => ({ ...r, rate_estimated: !!r.rate_estimated });

/** "I didn't buy X for amount". With wish_id, name/price default from that wish and the wish is marked dropped. */
export const logSkippedBuy = (s: { id?: string; name?: string; amount?: number; currency?: string; day?: string; wish_id?: string; note?: string }) => {
  const id = idOr(s.id);
  const existing = getSkip(id);
  if (existing) return hydSkip(existing);
  const wish = s.wish_id ? need(one<Row>(`SELECT * FROM wishlist WHERE id = ? AND deleted_at IS NULL`, s.wish_id), 'wish') : undefined;
  const name = safeText(s.name ?? wish?.name ?? '', 120) || bad('name is required');
  const amount = Number(s.amount ?? wish?.price);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) bad('amount must be > 0');
  const currency = String(s.currency ?? wish?.currency ?? 'USD').toUpperCase();
  if (!(money.CURRENCIES as readonly string[]).includes(currency)) bad(`currency must be one of ${money.CURRENCIES.join(', ')}`);
  const day = checkDay(s.day) ?? lifeToday();
  const rate = money.rateFor(currency, day);
  insert('skipped_buys', { id, name, amount, currency, rate_to_usd: rate.rate, rate_estimated: rate.estimated, usd: round(amount * rate.rate, 2),
    day, wish_id: wish?.id ?? null, note: safeText(s.note ?? '', 500) });
  if (wish && wish.status === 'open') patch('wishlist', String(wish.id), { status: 'dropped' });
  return hydSkip(need(getSkip(id), 'skipped buy'));
};
export const listSkippedBuys = (o: { from?: string; to?: string; limit?: number } = {}) => {
  checkDay(o.from, 'from'); checkDay(o.to, 'to');
  return all<Row>(`SELECT * FROM skipped_buys WHERE deleted_at IS NULL AND (? IS NULL OR day >= ?) AND (? IS NULL OR day <= ?) ORDER BY day DESC, created_at DESC LIMIT ?`,
    o.from ?? null, o.from ?? null, o.to ?? null, o.to ?? null, Math.min(Math.max(o.limit ?? 200, 1), 2000)).map(hydSkip);
};
export const deleteSkippedBuy = (id: string) => { need(getSkip(id), 'skipped buy'); softDelete('skipped_buys', id); return { id, deleted: true }; };
/** Total not spent, by month (YYYY-MM), in USD. */
export const skippedSummary = (o: { from?: string; to?: string } = {}) => {
  checkDay(o.from, 'from'); checkDay(o.to, 'to');
  const rows = all<{ month: string; usd: number; n: number }>(`SELECT substr(day, 1, 7) AS month, SUM(usd) AS usd, COUNT(*) AS n FROM skipped_buys
    WHERE deleted_at IS NULL AND (? IS NULL OR day >= ?) AND (? IS NULL OR day <= ?) GROUP BY month ORDER BY month`,
  o.from ?? null, o.from ?? null, o.to ?? null, o.to ?? null);
  const months = rows.map((r) => ({ month: r.month, usd: round(Number(r.usd), 2), count: Number(r.n) }));
  return { months, total_usd: round(months.reduce((a, b) => a + b.usd, 0), 2), count: months.reduce((a, b) => a + b.count, 0) };
};

// =====================================================================================================
// 5. For-whom spending
// =====================================================================================================
export const WHO_DEFAULTS = ['self', 'family', 'gift', 'other'] as const;
const personalExpense = (recordId: string) => {
  const r = need(money.getRecord(recordId), 'record') as Row;
  if (r.track !== 'personal') bad('only personal records can be tagged');
  if (r.kind !== 'expense') bad('only expenses can be tagged');
  return r;
};
/** Tag a personal expense with who it was for (self, family, gift, or a name). Re-tagging replaces it. */
export const setRecordFor = (recordId: string, who: string) => {
  personalExpense(recordId);
  const w = normName(safeText(who, 40));
  if (!w) bad('who is required');
  const cur = one<Row>(`SELECT * FROM record_for WHERE record_id = ?`, recordId);
  if (cur) run(`UPDATE record_for SET who = ?, deleted_at = NULL, updated_at = ? WHERE record_id = ?`, w, now(), recordId);
  else insert('record_for', { id: idOr(), record_id: recordId, who: w });
  return { record_id: recordId, who: w };
};
export const getRecordFor = (recordId: string) => one<{ who: string }>(`SELECT who FROM record_for WHERE record_id = ? AND deleted_at IS NULL`, recordId)?.who ?? null;
export const clearRecordFor = (recordId: string) => {
  run(`UPDATE record_for SET deleted_at = ?, updated_at = ? WHERE record_id = ? AND deleted_at IS NULL`, now(), now(), recordId);
  return { record_id: recordId, who: null };
};
/** Personal spend by who over a period, USD. Untagged spend is shown on its own line. */
export const spendByWho = (p: { from: string; to: string }) => {
  if (!isDate(p.from) || !isDate(p.to)) bad('from and to must be YYYY-MM-DD');
  const rows = all<{ who: string | null; usd: number; n: number }>(`SELECT f.who, SUM(r.usd) AS usd, COUNT(*) AS n FROM records r JOIN accounts a ON a.id = r.account_id
    LEFT JOIN record_for f ON f.record_id = r.id AND f.deleted_at IS NULL
    WHERE r.deleted_at IS NULL AND r.kind = 'expense' AND a.track = 'personal' AND r.day >= ? AND r.day <= ? GROUP BY f.who`, p.from, p.to);
  const tagged = rows.filter((r) => r.who !== null).map((r) => ({ who: String(r.who), usd: round(Number(r.usd), 2), count: Number(r.n) }))
    .sort((a, b) => b.usd - a.usd);
  const un = rows.find((r) => r.who === null);
  return { ...p, by_who: tagged, untagged_usd: round(Number(un?.usd ?? 0), 2), untagged_count: Number(un?.n ?? 0),
    total_usd: round(rows.reduce((a, r) => a + Number(r.usd), 0), 2) };
};

// =====================================================================================================
// 6. Shop grouping
// =====================================================================================================
export const STORE_ORDER = ['market', 'boucherie', 'boulangerie', 'épicerie', 'droguerie', 'pharmacie'];
export const DEFAULT_STORE = 'épicerie';
const KEYWORDS: Record<string, string[]> = {
  market: ['vegetable', 'veg', 'fruit', 'legume', 'tomato', 'tomate', 'onion', 'oignon', 'potato', 'pomme de terre', 'carrot', 'carotte',
    'pepper', 'poivron', 'lettuce', 'salade', 'cucumber', 'concombre', 'zucchini', 'courgette', 'eggplant', 'aubergine', 'garlic', 'ail',
    'parsley', 'persil', 'coriander', 'coriandre', 'mint', 'menthe', 'lemon', 'citron', 'apple', 'pomme', 'banana', 'banane', 'orange',
    'grape', 'raisin', 'melon', 'watermelon', 'pasteque', 'date', 'datte', 'fig', 'figue', 'spinach', 'epinard', 'bean', 'haricot', 'pea', 'petit pois'],
  boucherie: ['meat', 'viande', 'beef', 'boeuf', 'lamb', 'agneau', 'mouton', 'chicken', 'poulet', 'turkey', 'dinde', 'kefta', 'merguez', 'liver', 'foie'],
  boulangerie: ['bread', 'pain', 'baguette', 'croissant', 'khobz', 'matlouh', 'msemen', 'brioche'],
  droguerie: ['cleaning', 'detergent', 'soap', 'savon', 'bleach', 'javel', 'sponge', 'eponge', 'dish', 'vaisselle', 'toilet paper', 'papier toilette',
    'shampoo', 'shampoing', 'trash bag', 'sac poubelle', 'lessive', 'laundry', 'toothpaste', 'dentifrice'],
  pharmacie: ['med', 'meds', 'medicine', 'medicament', 'pill', 'paracetamol', 'doliprane', 'ibuprofen', 'vitamin', 'vitamine', 'bandage',
    'pansement', 'sunscreen', 'creme solaire', 'syrup', 'sirop'],
};
const KW_RE = Object.entries(KEYWORDS).map(([store, kws]) => ({ store, re: new RegExp(`(^| )(${kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(s|es|x)?( |$)`) }));

export const getShopOverride = (name: string) => one<{ store: string }>(`SELECT store FROM shop_overrides WHERE name_key = ? AND deleted_at IS NULL`, normName(name))?.store ?? null;
/** Store for an item: the remembered override, else the keyword map, else épicerie. */
export const storeFor = (name: string) => {
  const o = getShopOverride(name);
  if (o) return { store: o, how: 'override' as const };
  const n = normName(name);
  const hit = KW_RE.find((k) => k.re.test(n));
  return { store: hit?.store ?? DEFAULT_STORE, how: hit ? ('keyword' as const) : ('default' as const) };
};
/** Remember a store for an item name (applies to every future item with that name). */
export const setShopOverride = (name: string, store: string) => {
  const key = normName(safeText(name, 120));
  if (!key) bad('name is required');
  const s = safeText(store, 40).toLowerCase();
  if (!s) bad('store is required');
  const cur = one<Row>(`SELECT id FROM shop_overrides WHERE name_key = ?`, key);
  if (cur) run(`UPDATE shop_overrides SET store = ?, name = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`, s, String(name).trim(), now(), cur.id);
  else insert('shop_overrides', { id: idOr(), name_key: key, name: String(name).trim(), store: s });
  return { name: String(name).trim(), store: s };
};
export const clearShopOverride = (name: string) => {
  run(`UPDATE shop_overrides SET deleted_at = ?, updated_at = ? WHERE name_key = ? AND deleted_at IS NULL`, now(), now(), normName(name));
  return { name, store: storeFor(name).store };
};
export const listShopOverrides = () => all<Row>(`SELECT name, store FROM shop_overrides WHERE deleted_at IS NULL ORDER BY name`);
/** Open shopping items grouped by store, in walking order (market first). */
export const shopGroups = (list?: string) => {
  const items = money.listShopping(list);
  const by = new Map<string, Row[]>();
  for (const it of items) {
    const s = storeFor(String(it.name));
    by.set(s.store, [...(by.get(s.store) ?? []), { ...it, store: s.store, how: s.how }]);
  }
  const rank = (s: string) => { const i = STORE_ORDER.indexOf(s); return i === -1 ? STORE_ORDER.length : i; };
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([store, its]) => ({ store, count: its.length, items: its }));
};

// =====================================================================================================
// 7. Gym note carry-forward
// =====================================================================================================
const exerciseOf = (ref: string) => need(gym.findExercise(ref), `exercise "${ref}"`);
const activeNext = (exerciseId: string) => one<Row>(`SELECT * FROM gym_next_notes WHERE exercise_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`, exerciseId);

/** Set the "next time" note for an exercise. Replaces any earlier one. Empty text clears it. */
export const setNextNote = (exercise: string, note: string) => {
  const ex = exerciseOf(exercise);
  const text = safeText(note, 300);
  run(`UPDATE gym_next_notes SET deleted_at = ?, updated_at = ? WHERE exercise_id = ? AND deleted_at IS NULL`, now(), now(), ex.id);
  if (!text) return { exercise: ex.name, next_time: null };
  const id = idOr();
  insert('gym_next_notes', { id, exercise_id: ex.id, note: text });
  return { exercise: ex.name, next_time: { id, note: text } };
};

/**
 * What to show when this exercise comes up: notes from the last finished workout with it, plus the "next time" note.
 * Marks the next-time note as shown; it stays until acknowledged.
 */
export const gymCarryForward = (exercise: string) => {
  const ex = exerciseOf(exercise);
  const w = one<Row>(`SELECT w.id, w.day, w.notes FROM workouts w WHERE w.deleted_at IS NULL AND w.status = 'done'
    AND EXISTS (SELECT 1 FROM sets s WHERE s.workout_id = w.id AND s.exercise_id = ? AND s.deleted_at IS NULL) ORDER BY w.started_at DESC LIMIT 1`, ex.id);
  const setNotes = w ? [...new Set(all<{ note: string }>(`SELECT note FROM sets WHERE workout_id = ? AND exercise_id = ? AND deleted_at IS NULL AND note != '' ORDER BY idx`,
    w.id, ex.id).map((s) => s.note.trim()).filter(Boolean))] : [];
  const nx = activeNext(ex.id);
  if (nx && !nx.shown_at) patch('gym_next_notes', String(nx.id), { shown_at: now() });
  return { exercise: ex.name, exercise_id: ex.id, last_day: w?.day ?? null, set_notes: setNotes,
    workout_note: w?.notes ? String(w.notes) : null, next_time: nx ? { id: String(nx.id), note: String(nx.note) } : null };
};

/** Acknowledge the next-time note after it was shown. Clears it. */
export const ackNextNote = (exercise: string) => {
  const ex = exerciseOf(exercise);
  const nx = activeNext(ex.id);
  if (!nx) return { exercise: ex.name, cleared: false };
  if (!nx.shown_at) bad('this note has not been shown yet');
  run(`UPDATE gym_next_notes SET acked_at = ?, deleted_at = ?, updated_at = ? WHERE id = ?`, now(), now(), now(), nx.id);
  return { exercise: ex.name, cleared: true };
};
