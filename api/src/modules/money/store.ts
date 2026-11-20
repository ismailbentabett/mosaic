// Money: accounts, records (expense/income/transfer), rates, budgets, planned payments, templates, debts,
// savings goals, shopping list, runway. Replaces Wallet by BudgetBakers. Totals only ever leave app.db.
// Never store account/card numbers: account names are free text, "see password manager" for the rest.
import { createHash } from 'node:crypto';
import { AppError } from '../../errors.ts';
import { addDays, isDate, lifeDay, lifeToday, weekStartOf, zonedDate } from '../../time.ts';
import { all, idOr, insert, j, need, now, one, parseCsv, patch, round, run, softDelete, uuid, type Row } from '../util.ts';
import { nextOccurrence, validRecur, type Recur } from '../tasks/recur.ts';
import { parseQuickAdd } from '../tasks/parse.ts';
import { parseAmount } from './amount.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF'] as const;
const CUR_RE = /^[A-Z]{3}$/;
/** Rough fallback rates (USD per unit) used only until a real rate is entered. Always flagged estimated. */
const FALLBACK: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, JPY: 0.0067, CHF: 1.13 };
// Account numbers look like long digit runs; refuse them anywhere text is stored.
const NUMBERY = /\d[\d\s-]{11,}\d/;
const safeText = (s: unknown, max = 500) => {
  const t = String(s ?? '').trim().slice(0, max);
  if (NUMBERY.test(t)) bad('That looks like an account or card number. Do not store it here: see password manager.');
  return t;
};

// ---------- rates ----------
export const setRate = (currency: string, to_usd: number, day = lifeToday()) => {
  const c = String(currency ?? '').toUpperCase();
  if (!CUR_RE.test(c)) bad('currency must be a 3-letter code');
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  if (typeof to_usd !== 'number' || !(to_usd > 0) || !Number.isFinite(to_usd)) bad('rate must be a number > 0');
  run(`INSERT INTO rates (day, currency, to_usd) VALUES (?, ?, ?) ON CONFLICT (day, currency) DO UPDATE SET to_usd = excluded.to_usd`, day, c, to_usd);
  return { day, currency: c, to_usd };
};
/** Rate for a day: exact, else last known before (estimated), else last known at all (estimated), else fallback (estimated). */
export const rateFor = (currency: string, day: string): { rate: number; estimated: boolean } => {
  const c = currency.toUpperCase();
  if (c === 'USD') return { rate: 1, estimated: false };
  const exact = one<{ to_usd: number }>(`SELECT to_usd FROM rates WHERE currency = ? AND day = ?`, c, day);
  if (exact) return { rate: exact.to_usd, estimated: false };
  const before = one<{ to_usd: number }>(`SELECT to_usd FROM rates WHERE currency = ? AND day < ? ORDER BY day DESC LIMIT 1`, c, day)
    ?? one<{ to_usd: number }>(`SELECT to_usd FROM rates WHERE currency = ? ORDER BY day ASC LIMIT 1`, c);
  if (before) return { rate: before.to_usd, estimated: true };
  if (FALLBACK[c]) return { rate: FALLBACK[c], estimated: true };
  return bad(`No rate known for ${c}. Set one first.`);
};
export const listRates = () => all(`SELECT r.* FROM rates r JOIN (SELECT currency, MAX(day) AS day FROM rates GROUP BY currency) m USING (currency, day)`);

// ---------- accounts ----------
export const listAccounts = (includeArchived = false) => all<Row>(
  `SELECT * FROM accounts WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived = 0'} ORDER BY sort, name`)
  .map((a) => ({ ...a, archived: !!a.archived, balance: balance(String(a.id)) }));
export const getAccount = (ref: string) => one<Row & { id: string; currency: string; track: string; name: string; opening_balance: number }>(
  `SELECT * FROM accounts WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref);
export const addAccount = (a: { id?: string; name: string; type?: string; currency?: string; track?: 'personal' | 'business'; opening_balance?: number }) => {
  const name = safeText(a.name, 80) || bad('name is required');
  if (getAccount(name)) bad(`account "${name}" exists`);
  const currency = (a.currency ?? 'USD').toUpperCase();
  if (!CUR_RE.test(currency)) bad('currency must be a 3-letter code');
  if (a.track && !['personal', 'business'].includes(a.track)) bad('track must be personal or business');
  const type = a.type ?? 'cash';
  if (!['cash', 'bank', 'card', 'savings', 'wallet', 'other'].includes(type)) bad('type must be cash, bank, card, savings, wallet or other');
  const row = { id: idOr(a.id), name, type, currency, track: a.track ?? 'personal', opening_balance: Number(a.opening_balance ?? 0) };
  insert('accounts', row);
  return need(getAccount(row.id), 'account');
};
export const updateAccount = (id: string, f: { name?: string; archived?: boolean; opening_balance?: number; sort?: number; track?: string }) => {
  need(getAccount(id), 'account');
  patch('accounts', id, { ...f, name: f.name !== undefined ? safeText(f.name, 80) : undefined });
  return getAccount(id);
};
/** Balance in the account's own currency. */
export const balance = (accountId: string, upTo?: string) => {
  const a = need(getAccount(accountId), 'account');
  const s = one<{ s: number }>(`SELECT COALESCE(SUM(direction * amount), 0) AS s FROM records WHERE account_id = ? AND deleted_at IS NULL ${upTo ? 'AND day <= ?' : ''}`,
    ...(upTo ? [a.id, upTo] : [a.id]))!.s;
  return round(a.opening_balance + s, 2);
};
const defaultAccount = () => one<{ id: string }>(`SELECT id FROM accounts WHERE deleted_at IS NULL AND archived = 0 AND track = 'personal' ORDER BY sort, created_at LIMIT 1`)
  ?? addAccount({ name: 'Cash', type: 'cash', currency: 'USD' });

// ---------- categories ----------
export const DEFAULT_CATEGORIES: Record<string, string[]> = {
  'Food & Drinks': ['Groceries', 'Restaurant', 'Café', 'Snacks'],
  Shopping: ['Clothes', 'Electronics', 'Home', 'Gifts'],
  Housing: ['Rent', 'Utilities', 'Repairs'],
  Transport: ['Fuel', 'Taxi', 'Bus', 'Car maintenance'],
  'Life & Health': ['Gym', 'Health', 'Skincare', 'Barber', 'Education'],
  Communication: ['Phone', 'Internet'],
  Software: ['Claude', 'Domains', 'Tools'],
  Family: ['Family support', 'Charity'],
  Financial: ['Fees', 'Taxes'],
  Other: [],
};
export const seedCategories = () => {
  if (one(`SELECT id FROM categories LIMIT 1`)) return 0;
  let n = 0;
  for (const [parent, kids] of Object.entries(DEFAULT_CATEGORIES)) {
    const pid = uuid();
    insert('categories', { id: pid, name: parent, kind: 'expense' }); n++;
    for (const k of kids) { insert('categories', { id: uuid(), parent_id: pid, name: k, kind: 'expense' }); n++; }
  }
  for (const k of ['Salary', 'Side income', 'Gifts received', 'Refunds', 'Other income']) { insert('categories', { id: uuid(), name: k, kind: 'income' }); n++; }
  return n;
};
export const listCategories = () => all(`SELECT c.*, p.name AS parent_name FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
  WHERE c.deleted_at IS NULL ORDER BY c.kind, COALESCE(p.name, c.name), c.parent_id IS NOT NULL, c.name`);
/** Find a category by id, name, or "Parent/Child". Creates it if missing and `create` is set. */
export const findCategory = (ref: string, kind: 'expense' | 'income' = 'expense', create = true): { id: string; name: string } | undefined => {
  const r = ref.trim();
  if (!r) return undefined;
  const byId = one<{ id: string; name: string }>(`SELECT id, name FROM categories WHERE id = ? AND deleted_at IS NULL`, r);
  if (byId) return byId;
  const [a, b] = r.split('/').map((x) => x.trim());
  if (b) {
    const parent = findCategory(a, kind, create);
    if (!parent) return undefined;
    const kid = one<{ id: string; name: string }>(`SELECT id, name FROM categories WHERE parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL`, parent.id, b);
    if (kid || !create) return kid;
    const id = uuid(); insert('categories', { id, parent_id: parent.id, name: b, kind });
    return { id, name: b };
  }
  const hit = one<{ id: string; name: string }>(`SELECT id, name FROM categories WHERE lower(name) = lower(?) AND deleted_at IS NULL ORDER BY parent_id IS NOT NULL DESC LIMIT 1`, a);
  if (hit || !create) return hit;
  const id = uuid(); insert('categories', { id, name: a, kind });
  return { id, name: a };
};

// ---------- records ----------
export type RecordInput = {
  id?: string; account?: string; kind?: 'expense' | 'income'; amount: number; currency?: string; category?: string;
  labels?: string[]; note?: string; payee?: string; day?: string; at?: string; planned_id?: string; debt_id?: string;
  warranty_until?: string; photo?: string; import_ref?: string; rate_to_usd?: number;
};
const SELECT = `SELECT r.*, a.name AS account_name, a.track AS track, c.name AS category_name, pc.name AS parent_category
  FROM records r JOIN accounts a ON a.id = r.account_id LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN categories pc ON pc.id = c.parent_id`;
const hydrate = (r: Row) => ({ ...r, labels: j<string[]>(r.labels, []), rate_estimated: !!r.rate_estimated });
export const getRecord = (id: string) => { const r = one(`${SELECT} WHERE r.id = ?`, id); return r ? hydrate(r) : undefined; };

const dayAt = (day?: string, at?: string) => {
  if (day && !isDate(day)) bad('day must be YYYY-MM-DD');
  const atIso = at ? new Date(at) : new Date();
  if (Number.isNaN(atIso.getTime())) bad('at must be an ISO time');
  return { day: day ?? lifeDay(atIso), at: atIso.toISOString() };
};

export const addRecord = (r: RecordInput) => {
  const id = idOr(r.id);
  const existing = getRecord(id);
  if (existing) return existing;
  if (r.import_ref) { const hit = one<{ id: string }>(`SELECT id FROM records WHERE import_ref = ?`, r.import_ref); if (hit) return getRecord(hit.id)!; }
  const amount = Number(r.amount);
  if (!Number.isFinite(amount) || amount <= 0) bad('amount must be > 0');
  if (amount > 1e10) bad('amount is too large');
  const kind = r.kind ?? 'expense';
  if (!['expense', 'income'].includes(kind)) bad('kind must be expense or income (use transfer() for transfers)');
  const acct = r.account ? need(getAccount(r.account), `account ${r.account}`) : need(getAccount(defaultAccount().id), 'account');
  const currency = (r.currency ?? acct.currency).toUpperCase();
  if (currency !== acct.currency) bad(`account ${acct.name} is in ${acct.currency}; log in ${acct.currency} or pick another account`);
  const { day, at } = dayAt(r.day, r.at);
  const rate = r.rate_to_usd ? { rate: r.rate_to_usd, estimated: false } : rateFor(currency, day);
  const cat = r.category ? findCategory(r.category, kind) : undefined;
  if (r.warranty_until && !isDate(r.warranty_until)) bad('warranty_until must be YYYY-MM-DD');
  insert('records', {
    id, account_id: acct.id, kind, amount, currency, rate_to_usd: rate.rate, rate_estimated: rate.estimated, usd: round(amount * rate.rate, 2),
    category_id: cat?.id ?? null, labels: (r.labels ?? []).map((x) => String(x).toLowerCase().trim()).filter(Boolean),
    note: safeText(r.note ?? '', 1000), payee: r.payee ? safeText(r.payee, 120) : null, day, at,
    direction: kind === 'income' ? 1 : -1, planned_id: r.planned_id ?? null, debt_id: r.debt_id ?? null,
    warranty_until: r.warranty_until ?? null, photo: r.photo ?? null, import_ref: r.import_ref ?? null,
  });
  return need(getRecord(id), 'record');
};

/** Move money between two accounts. Two rows share transfer_id; both are excluded from spend/income. */
export const transfer = (t: { id?: string; from: string; to: string; amount: number; to_amount?: number; note?: string; day?: string; at?: string }) => {
  if (typeof t.from !== 'string' || typeof t.to !== 'string' || !t.from || !t.to) bad('from and to accounts are needed');
  if (t.to_amount !== undefined && !(typeof t.to_amount === 'number' && t.to_amount > 0)) bad('to_amount must be a number > 0');
  const from = need(getAccount(t.from), `account ${t.from}`);
  const to = need(getAccount(t.to), `account ${t.to}`);
  if (from.id === to.id) bad('pick two different accounts');
  const amount = Number(t.amount);
  if (!(amount > 0)) bad('amount must be > 0');
  const { day, at } = dayAt(t.day, t.at);
  const rf = rateFor(from.currency, day);
  const rt = rateFor(to.currency, day);
  const toAmount = t.to_amount ?? (from.currency === to.currency ? amount : round((amount * rf.rate) / rt.rate, 2));
  const tid = idOr(t.id);
  if (one(`SELECT id FROM records WHERE transfer_id = ?`, tid)) return { transfer_id: tid, replay: true };
  const base = { kind: 'transfer', note: safeText(t.note ?? '', 500), day, at, transfer_id: tid };
  insert('records', { ...base, id: uuid(), account_id: from.id, amount, currency: from.currency, rate_to_usd: rf.rate, rate_estimated: rf.estimated, usd: round(amount * rf.rate, 2), direction: -1 });
  insert('records', { ...base, id: uuid(), account_id: to.id, amount: toAmount, currency: to.currency, rate_to_usd: rt.rate, rate_estimated: rt.estimated, usd: round(toAmount * rt.rate, 2), direction: 1 });
  return { transfer_id: tid, from: from.name, to: to.name, amount, to_amount: toAmount };
};

export const updateRecord = (id: string, f: Partial<RecordInput>) => {
  const cur = need(getRecord(id), 'record') as Row;
  if (cur.kind === 'transfer') bad('edit a transfer by deleting and re-adding it');
  const fields: Row = {};
  if (f.amount !== undefined) { if (!(Number(f.amount) > 0)) bad('amount must be > 0'); fields.amount = Number(f.amount); }
  if (f.day !== undefined) { if (!isDate(f.day)) bad('day must be YYYY-MM-DD'); fields.day = f.day; }
  if (f.kind !== undefined) { if (!['expense', 'income'].includes(f.kind)) bad('kind must be expense or income'); fields.kind = f.kind; fields.direction = f.kind === 'income' ? 1 : -1; }
  const kind = String(fields.kind ?? cur.kind) as 'expense' | 'income';
  if (f.category !== undefined) fields.category_id = f.category ? findCategory(f.category, kind)?.id ?? null : null;
  else if (kind !== cur.kind && cur.category_id) {
    // Expense ↔ income: an old category of the other kind would turn this into a refund. Drop it.
    const ck = one<{ kind: string }>(`SELECT kind FROM categories WHERE id = ?`, cur.category_id)?.kind;
    if (ck && ck !== kind) fields.category_id = null;
  }
  if (f.note !== undefined) fields.note = safeText(f.note, 1000);
  if (f.payee !== undefined) fields.payee = f.payee ? safeText(f.payee, 120) : null;
  if (f.labels !== undefined) fields.labels = f.labels;
  if (f.rate_to_usd !== undefined) {
    if (!(Number(f.rate_to_usd) > 0)) bad('rate_to_usd must be > 0');
    fields.rate_to_usd = Number(f.rate_to_usd); fields.rate_estimated = false;
  } else if (f.day !== undefined && cur.rate_estimated) {
    // Only a guessed rate follows the new day; a rate that was set by hand or known for the day stays.
    const rate = rateFor(String(cur.currency), String(fields.day));
    fields.rate_to_usd = rate.rate; fields.rate_estimated = rate.estimated;
  }
  if (f.amount !== undefined || fields.rate_to_usd !== undefined) {
    fields.usd = round(Number(fields.amount ?? cur.amount) * Number(fields.rate_to_usd ?? cur.rate_to_usd), 2);
  }
  patch('records', id, fields);
  return getRecord(id);
};
export const deleteRecord = (id: string) => {
  const cur = need(getRecord(id), 'record') as Row;
  if (cur.transfer_id) run(`UPDATE records SET deleted_at = ?, updated_at = ? WHERE transfer_id = ?`, now(), now(), cur.transfer_id);
  else softDelete('records', id);
  return { id, deleted: true };
};
export const listRecords = (o: { from?: string; to?: string; account?: string; category?: string; q?: string; kind?: string; limit?: number } = {}) => {
  const w = ['r.deleted_at IS NULL'];
  const p: unknown[] = [];
  if (o.from) { w.push('r.day >= ?'); p.push(o.from); }
  if (o.to) { w.push('r.day <= ?'); p.push(o.to); }
  if (o.account) { w.push('r.account_id = ?'); p.push(need(getAccount(o.account), 'account').id); }
  if (o.category) { const c = findCategory(o.category, 'expense', false); w.push('(r.category_id = ? OR c.parent_id = ?)'); p.push(c?.id ?? '-', c?.id ?? '-'); }
  if (o.q) { w.push('(r.note LIKE ? OR r.payee LIKE ?)'); p.push(`%${o.q}%`, `%${o.q}%`); }
  if (o.kind) { if (!['expense', 'income', 'transfer'].includes(o.kind)) bad('kind must be expense, income or transfer'); w.push('r.kind = ?'); p.push(o.kind); }
  const limit = Math.min(Math.max(o.limit ?? 200, 1), 5000);
  return all(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY r.day DESC, r.at DESC LIMIT ${limit}`, ...p).map(hydrate);
};

/**
 * Quick log from one line: "4.50 coffee", "60 eur groceries #family yesterday", "+3200 salary", "1.2k rent".
 * Leading + means income. The amount comes from parseAmount (shared with the web preview).
 * Category guessed from words matching a category name; else note only.
 */
export const quickLog = (text: string, extra: Partial<RecordInput> = {}) => {
  const a = parseAmount(String(text ?? ''));
  if (!a) bad('Add an amount, e.g. "4.50 coffee"');
  const { amount, currency: cur, sign, note: rest } = a!;
  const p = parseQuickAdd(rest || 'expense', lifeToday());
  const kind = extra.kind ?? (sign === '+' ? 'income' : 'expense');
  const cat = guessCategory(p.title, kind);
  const account = extra.account ?? accountFor(cur);
  return addRecord({ amount, kind, note: p.title, category: cat?.id, labels: p.tags, day: p.due_date, ...extra, account });
};

/** Category whose name matches a word of the note (whole word first, then a 4+ letter prefix). */
const guessCategory = (note: string, kind: 'expense' | 'income') => {
  const words = note.toLowerCase().split(/\s+/);
  const cats = all<{ id: string; name: string }>(`SELECT id, name FROM categories WHERE deleted_at IS NULL AND kind = ?`, kind);
  return cats.find((c) => words.includes(c.name.toLowerCase())) ?? cats.find((c) => words.some((w) => w.length > 3 && c.name.toLowerCase().startsWith(w)));
};
/** First personal account in a currency; undefined when no currency is given. */
const accountFor = (cur?: string | null) => {
  if (!cur) return undefined;
  const id = one<{ id: string }>(`SELECT id FROM accounts WHERE currency = ? AND deleted_at IS NULL AND archived = 0 AND track = 'personal' ORDER BY sort LIMIT 1`, cur.toUpperCase())?.id;
  if (!id) bad(`No ${cur.toUpperCase()} account yet. Add one first.`);
  return id;
};

/**
 * Structured log from the form: amount, currency and kind as fields, nothing parsed from text.
 * Picks the first personal account in that currency and guesses the category from the note.
 */
export const logRecord = (r: RecordInput) => {
  const kind = r.kind ?? 'expense';
  const category = r.category ?? (r.note ? guessCategory(r.note, kind)?.id : undefined);
  return addRecord({ ...r, kind, category, account: r.account ?? accountFor(r.currency) });
};

// ---------- summaries ----------
export type Period = { from: string; to: string };
export const periodOf = (kind: 'week' | 'month' | 'year', day = lifeToday()): Period => {
  if (kind === 'week') { const s = weekStartOf(day); return { from: s, to: addDays(s, 6) }; }
  if (kind === 'month') { const s = `${day.slice(0, 7)}-01`; const [y, m] = s.split('-').map(Number); return { from: s, to: `${day.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }; }
  return { from: `${day.slice(0, 4)}-01-01`, to: `${day.slice(0, 4)}-12-31` };
};
/** Spend/income in USD for a period. Transfers excluded; refunds (income in an expense category) reduce that category. */
export const summary = (p: Period, track: 'personal' | 'business' = 'personal') => {
  const rows = all<{ kind: string; usd: number; cat: string | null; parent: string | null; ckind: string | null; rate_estimated: number }>(
    `SELECT r.kind, r.usd, c.name AS cat, pc.name AS parent, c.kind AS ckind, r.rate_estimated FROM records r JOIN accounts a ON a.id = r.account_id
     LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
     WHERE r.deleted_at IS NULL AND r.kind != 'transfer' AND a.track = ? AND r.day >= ? AND r.day <= ?`, track, p.from, p.to);
  let spend = 0, income = 0, estimated = 0;
  const byCat = new Map<string, number>();
  for (const r of rows) {
    if (r.rate_estimated) estimated++;
    const top = r.parent ?? r.cat ?? 'Uncategorised';
    if (r.kind === 'expense') { spend += r.usd; byCat.set(top, (byCat.get(top) ?? 0) + r.usd); }
    else if (r.ckind === 'expense') { spend -= r.usd; byCat.set(top, (byCat.get(top) ?? 0) - r.usd); }
    else income += r.usd;
  }
  return {
    ...p, track, spend_usd: round(spend, 2), income_usd: round(income, 2), net_usd: round(income - spend, 2), records: rows.length,
    estimated_rates: estimated, by_category: [...byCat.entries()].map(([name, usd]) => ({ name, usd: round(usd, 2) })).sort((a, b) => b.usd - a.usd),
  };
};

/** Accounts that hold a savings goal (the car fund). Their money is not living cash. */
export const goalAccountIds = () => new Set(all<{ account_id: string }>(
  `SELECT account_id FROM savings_goals WHERE deleted_at IS NULL AND account_id IS NOT NULL`).map((g) => g.account_id));

/**
 * Living cash in USD: personal accounts, minus accounts that hold a savings goal, minus what is still owed on borrowed money.
 * Money lent out is not counted until it comes back.
 */
export const livingCash = (today = lifeToday()) => {
  const goals = goalAccountIds();
  let accounts = 0, goal = 0;
  for (const a of listAccounts().filter((x) => x.track === 'personal')) {
    const usd = Number(a.balance) * rateFor(String(a.currency), today).rate;
    if (goals.has(String(a.id))) goal += usd; else accounts += usd;
  }
  let owed = 0;
  for (const d of listDebts()) if (d.direction === 'borrowed' && d.left > 0) owed += d.left * rateFor(String(d.currency), today).rate;
  return { cash_usd: round(accounts - owed, 2), accounts_usd: round(accounts, 2), goal_usd: round(goal, 2), owed_usd: round(owed, 2) };
};

/**
 * Runway: living cash (savings goals and debts taken out) ÷ average weekly personal spend over the last 8 life-weeks.
 * `lasts_to` is the day the cash runs out at that pace ("Cash lasts to about <date>").
 */
export const runway = (today = lifeToday()) => {
  const c = livingCash(today);
  const from = addDays(weekStartOf(today), -56);
  const to = addDays(weekStartOf(today), -1);
  const s = summary({ from, to });
  // Measure from the first personal record, so business history does not dilute the weekly average.
  const firstDay = one<{ d: string | null }>(`SELECT MIN(r.day) AS d FROM records r JOIN accounts a ON a.id = r.account_id
    WHERE r.deleted_at IS NULL AND a.track = 'personal' AND r.kind != 'transfer'`)!.d;
  const weeks = firstDay && firstDay > from ? Math.max(1, Math.ceil((Date.parse(to) - Date.parse(firstDay) + 86400000) / (7 * 86400000))) : 8;
  const burn = s.spend_usd > 0 ? s.spend_usd / weeks : 0;
  const weeksLeft = burn > 0 ? Math.max(0, c.cash_usd) / burn : null;
  return {
    cash_usd: c.cash_usd, goal_usd: c.goal_usd, owed_usd: c.owed_usd,
    weekly_burn_usd: round(burn, 2), weeks_measured: weeks,
    runway_weeks: weeksLeft === null ? null : round(weeksLeft, 1),
    lasts_to: weeksLeft === null ? null : addDays(today, Math.floor(weeksLeft * 7)),
    under_8_weeks: weeksLeft !== null && weeksLeft < 8,
  };
};

// ---------- budgets (neutral progress, never "over") ----------
export const addBudget = (b: { id?: string; name: string; period: 'week' | 'month' | 'year' | 'once'; amount_usd: number; categories?: string[]; start?: string; end?: string }) => {
  if (!['week', 'month', 'year', 'once'].includes(b.period)) bad('period must be week, month, year or once');
  if (!(b.amount_usd > 0)) bad('amount_usd must be > 0');
  if (b.period === 'once' && (!b.start || !b.end)) bad('a one-time budget needs start and end');
  const ids = (b.categories ?? []).map((c) => need(findCategory(c, 'expense', false), `category ${c}`).id);
  const row = { id: idOr(b.id), name: safeText(b.name, 80) || bad('name is required'), period: b.period, amount_usd: b.amount_usd, category_ids: ids, start: b.start ?? null, end: b.end ?? null };
  insert('budgets', row);
  return row;
};
/** Change a budget's amount, name or categories. Weekly budgets drive "Free this week". */
export const updateBudget = (id: string, f: { name?: string; amount_usd?: number; period?: string; categories?: string[] }) => {
  need(one(`SELECT id FROM budgets WHERE id = ? AND deleted_at IS NULL`, id), 'budget');
  const fields: Row = {};
  if (f.name !== undefined) fields.name = safeText(f.name, 80) || bad('name is required');
  if (f.amount_usd !== undefined) { if (!(Number(f.amount_usd) > 0)) bad('amount_usd must be > 0'); fields.amount_usd = Number(f.amount_usd); }
  if (f.period !== undefined) { if (!['week', 'month', 'year'].includes(f.period)) bad('period must be week, month or year'); fields.period = f.period; }
  if (f.categories !== undefined) fields.category_ids = f.categories.map((c) => need(findCategory(c, 'expense', false), `category ${c}`).id);
  patch('budgets', id, fields);
  return listBudgets().find((b) => b.id === id);
};
export const deleteBudget = (id: string) => {
  need(one(`SELECT id FROM budgets WHERE id = ? AND deleted_at IS NULL`, id), 'budget');
  softDelete('budgets', id);
  return { id, deleted: true };
};
/** Set the one weekly budget (all categories) that "Free this week" reads. Creates it if missing. */
export const setWeeklyBudget = (amount_usd: number) => {
  if (!(Number(amount_usd) > 0)) bad('amount_usd must be > 0');
  const w = one<{ id: string }>(`SELECT id FROM budgets WHERE deleted_at IS NULL AND period = 'week' ORDER BY category_ids = '[]' DESC, created_at LIMIT 1`);
  if (w) return updateBudget(w.id, { amount_usd: Number(amount_usd) });
  addBudget({ name: 'This week', period: 'week', amount_usd: Number(amount_usd) });
  return listBudgets().find((b) => b.period === 'week');
};
export const listBudgets = (today = lifeToday()) => all<Row>(`SELECT * FROM budgets WHERE deleted_at IS NULL`).map((b) => {
  const p = b.period === 'once' ? { from: String(b.start), to: String(b.end) } : periodOf(b.period as 'week', today);
  const ids = j<string[]>(b.category_ids, []);
  const kids = ids.length ? all<{ id: string }>(`SELECT id FROM categories WHERE parent_id IN (${ids.map(() => '?').join(',')})`, ...ids).map((x) => x.id) : [];
  const set = [...ids, ...kids];
  const spent = one<{ s: number }>(`SELECT COALESCE(SUM(CASE WHEN r.kind = 'expense' THEN r.usd ELSE -r.usd END), 0) AS s FROM records r JOIN accounts a ON a.id = r.account_id
    WHERE r.deleted_at IS NULL AND r.kind != 'transfer' AND a.track = 'personal' AND r.day >= ? AND r.day <= ?
    AND (r.kind = 'expense' OR (SELECT kind FROM categories WHERE id = r.category_id) = 'expense')
    ${set.length ? `AND r.category_id IN (${set.map(() => '?').join(',')})` : ''}`, p.from, p.to, ...set)!.s;
  return { ...b, category_ids: ids, from: p.from, to: p.to, spent_usd: round(spent, 2), left_usd: round(Number(b.amount_usd) - spent, 2), share: round(spent / Number(b.amount_usd), 2) };
});

// ---------- templates & planned payments ----------
export const addTemplate = (name: string, record: Partial<RecordInput>, id?: string) => {
  const row = { id: idOr(id), name: safeText(name, 80) || bad('name is required'), record };
  insert('templates', row);
  return row;
};
export const listTemplates = () => all<Row>(`SELECT * FROM templates WHERE deleted_at IS NULL ORDER BY name`).map((t) => ({ ...t, record: j(t.record, {}) }));
export const useTemplate = (ref: string, over: Partial<RecordInput> = {}) => {
  const t = need(one<Row>(`SELECT * FROM templates WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref), `template ${ref}`);
  return addRecord({ ...j<RecordInput>(t.record, { amount: 0 }), ...over } as RecordInput);
};

export const addPlanned = (p: { id?: string; name: string; template: Partial<RecordInput>; recur: Recur; next_due: string; auto_post?: boolean }) => {
  if (!validRecur(p.recur)) bad('recur is not a valid repeat rule');
  if (!isDate(p.next_due)) bad('next_due must be YYYY-MM-DD');
  if (!(Number(p.template.amount) > 0)) bad('template.amount must be > 0');
  const row = { id: idOr(p.id), name: safeText(p.name, 80) || bad('name is required'), template: p.template, recur: p.recur, next_due: p.next_due, auto_post: !!p.auto_post };
  insert('planned', row);
  return row;
};
export const listPlanned = (until?: string) => all<Row>(`SELECT * FROM planned WHERE deleted_at IS NULL ${until ? 'AND next_due <= ?' : ''} ORDER BY next_due`, ...(until ? [until] : []))
  .map((p) => ({ ...p, template: j(p.template, {}), recur: j(p.recur, null), auto_post: !!p.auto_post }));
/** Post the due occurrence of a planned payment (confirm-to-post), then advance next_due. Idempotent per (planned, due day). */
export const postPlanned = (id: string, over: Partial<RecordInput> = {}) => {
  const p = need(listPlanned().find((x) => x.id === id), 'planned payment');
  const due = String(p.next_due);
  const rec = addRecord({ ...(p.template as RecordInput), day: due, ...over, planned_id: id, import_ref: `planned:${id}:${due}` });
  const next = nextOccurrence(p.recur as Recur, due, due, due);
  if (next) patch('planned', id, { next_due: next }); else softDelete('planned', id);
  return { record: rec, next_due: next };
};
export const skipPlanned = (id: string) => {
  const p = need(listPlanned().find((x) => x.id === id), 'planned payment');
  const next = nextOccurrence(p.recur as Recur, String(p.next_due), String(p.next_due), String(p.next_due));
  if (next) patch('planned', id, { next_due: next }); else softDelete('planned', id);
  return { next_due: next };
};
/** Cron: auto-post due planned payments that allow it. Returns posted count. */
export const runPlanned = (today = lifeToday()) => {
  let n = 0;
  for (let guard = 0; guard < 500; guard++) {
    const due = listPlanned(today).filter((p) => p.auto_post);
    if (!due.length) break;
    for (const p of due) { postPlanned(String(p.id)); n++; }
  }
  return n;
};

// ---------- debts ----------
export const addDebt = (d: { id?: string; person: string; direction: 'lent' | 'borrowed'; amount: number; currency?: string; note?: string; account?: string; record?: boolean }) => {
  if (!['lent', 'borrowed'].includes(d.direction)) bad('direction must be lent or borrowed');
  if (!(d.amount > 0)) bad('amount must be > 0');
  const id = idOr(d.id);
  const acct = d.account ? need(getAccount(d.account), 'account') : undefined;
  const currency = (d.currency ?? acct?.currency ?? 'USD').toUpperCase();
  if (!CUR_RE.test(currency)) bad('currency must be a 3-letter code');
  insert('debts', { id, person: safeText(d.person, 80) || bad('person is required'), direction: d.direction, amount: d.amount, currency, note: safeText(d.note ?? '', 500), account_id: acct?.id ?? null });
  if (d.record && acct) addTransferLike(acct.id, d.direction === 'lent' ? -1 : 1, d.amount, currency, id, `${d.direction === 'lent' ? 'Lent to' : 'Borrowed from'} ${d.person}`);
  return debtState(id);
};
// Debt money movements are not spend or income: they're stored as transfer-kind rows with debt_id.
// `amount` is in the debt's currency; the row is booked in the account's currency at the day's rate.
const addTransferLike = (accountId: string, direction: 1 | -1, amount: number, debtCurrency: string, debtId: string, note: string) => {
  const a = need(getAccount(accountId), 'account');
  const day = lifeToday();
  const r = rateFor(a.currency, day);
  const booked = a.currency === debtCurrency ? amount : round((amount * rateFor(debtCurrency, day).rate) / r.rate, 2);
  insert('records', { id: uuid(), account_id: a.id, kind: 'transfer', amount: booked, currency: a.currency, rate_to_usd: r.rate, rate_estimated: r.estimated,
    usd: round(booked * r.rate, 2), note, day, at: now(), direction, debt_id: debtId, debt_amount: amount });
};
/** Direction of a repayment row: money comes back for a loan you gave, goes out for one you took. */
const repayDirection = (d: Row): 1 | -1 => (d.direction === 'lent' ? 1 : -1);
/**
 * Record a repayment of `amount` in the debt's currency. It always lands on an account:
 * the one given, else the debt's own account, else the first personal account in the debt's currency.
 */
export const repayDebt = (id: string, amount: number, account?: string) => {
  const d = need(one<Row>(`SELECT * FROM debts WHERE id = ? AND deleted_at IS NULL`, id), 'debt');
  if (!(amount > 0)) bad('amount must be > 0');
  const acct = account ? need(getAccount(account), 'account')
    : (d.account_id ? getAccount(String(d.account_id)) : undefined)
      ?? one<{ id: string }>(`SELECT id FROM accounts WHERE currency = ? AND deleted_at IS NULL AND archived = 0 AND track = 'personal' ORDER BY sort LIMIT 1`, d.currency);
  if (!acct) bad(`Pick the account the ${d.currency} repayment went to.`);
  addTransferLike(acct!.id, repayDirection(d), amount, String(d.currency), id, `Repayment ${d.person}`);
  const st = debtState(id);
  if (st.left <= 0) patch('debts', id, { closed: true });
  return debtState(id);
};
export const debtState = (id: string) => {
  const d = need(one<Row>(`SELECT * FROM debts WHERE id = ?`, id), 'debt');
  // Repayments are the debt's rows that move money the other way. Old rows without an account (direction 0) count too.
  const paid = one<{ s: number }>(`SELECT COALESCE(SUM(COALESCE(debt_amount, amount)), 0) AS s FROM records
    WHERE debt_id = ? AND deleted_at IS NULL AND (direction = ? OR account_id = '')`, id, repayDirection(d))!.s;
  return { ...d, closed: !!d.closed, repaid: round(paid, 2), left: round(Number(d.amount) - paid, 2) };
};
export const listDebts = (includeClosed = false) => all<{ id: string }>(`SELECT id FROM debts WHERE deleted_at IS NULL ${includeClosed ? '' : 'AND closed = 0'} ORDER BY created_at`).map((d) => debtState(d.id));

// ---------- savings goals ----------
export const addSavingsGoal = (g: { id?: string; name: string; target_usd: number; target_date?: string; account?: string }) => {
  if (!(g.target_usd > 0)) bad('target_usd must be > 0');
  if (g.target_date && !isDate(g.target_date)) bad('target_date must be YYYY-MM-DD');
  const row = { id: idOr(g.id), name: safeText(g.name, 80) || bad('name is required'), target_usd: g.target_usd, target_date: g.target_date ?? null,
    account_id: g.account ? need(getAccount(g.account), 'account').id : null };
  insert('savings_goals', row);
  return row;
};
export const updateSavingsGoal = (id: string, f: { name?: string; target_usd?: number; target_date?: string | null; account?: string | null }) => {
  need(one(`SELECT id FROM savings_goals WHERE id = ? AND deleted_at IS NULL`, id), 'savings goal');
  const fields: Row = {};
  if (f.name !== undefined) fields.name = safeText(f.name, 80) || bad('name is required');
  if (f.target_usd !== undefined) { if (!(Number(f.target_usd) > 0)) bad('target_usd must be > 0'); fields.target_usd = Number(f.target_usd); }
  if (f.target_date !== undefined) { if (f.target_date && !isDate(f.target_date)) bad('target_date must be YYYY-MM-DD'); fields.target_date = f.target_date || null; }
  if (f.account !== undefined) fields.account_id = f.account ? need(getAccount(f.account), 'account').id : null;
  patch('savings_goals', id, fields);
  return listSavingsGoals().find((g) => g.id === id);
};
export const deleteSavingsGoal = (id: string) => {
  need(one(`SELECT id FROM savings_goals WHERE id = ? AND deleted_at IS NULL`, id), 'savings goal');
  softDelete('savings_goals', id);
  return { id, deleted: true };
};
export const listSavingsGoals = (today = lifeToday()) => all<Row>(`SELECT * FROM savings_goals WHERE deleted_at IS NULL`).map((g) => {
  const a = g.account_id ? getAccount(String(g.account_id)) : undefined;
  const saved = a ? round(balance(a.id) * rateFor(a.currency, today).rate, 2) : 0;
  const months = g.target_date ? Math.max(1, Math.ceil((Date.parse(String(g.target_date)) - Date.parse(today)) / (30.44 * 86400000))) : null;
  const left = Math.max(0, Number(g.target_usd) - saved);
  return { ...g, saved_usd: saved, left_usd: round(left, 2), monthly_needed_usd: months ? round(left / months, 2) : null };
});

// ---------- shopping ----------
export const addShopping = (name: string, list = 'Groceries', qty?: string, id?: string) => {
  const row = { id: idOr(id), name: safeText(name, 120) || bad('name is required'), list: safeText(list, 40) || 'Groceries', qty: qty ?? null };
  insert('shopping_items', row);
  return row;
};
export const listShopping = (list?: string, includeDone = false) => all<Row>(
  `SELECT * FROM shopping_items WHERE deleted_at IS NULL ${list ? 'AND list = ?' : ''} ${includeDone ? '' : 'AND done = 0'} ORDER BY done, created_at`, ...(list ? [list] : []))
  .map((s) => ({ ...s, done: !!s.done }));
export const toggleShopping = (id: string, done: boolean) => {
  need(one(`SELECT id FROM shopping_items WHERE id = ? AND deleted_at IS NULL`, id), 'shopping item');
  patch('shopping_items', id, { done: !!done });
  return { id, done: !!done };
};
export const clearDoneShopping = (list?: string) => Number(run(`UPDATE shopping_items SET deleted_at = ?, updated_at = ? WHERE done = 1 AND deleted_at IS NULL ${list ? 'AND list = ?' : ''}`,
  now(), now(), ...(list ? [list] : [])).changes);

// ---------- import / export ----------
/**
 * Wallet by BudgetBakers CSV export (`;` separated): account, category, currency, amount (negative = expense),
 * type (Expenses/Income), note, date, transfer, payee, labels, warranty_in_month. Accounts/categories created by name.
 * Idempotent: each row gets an import_ref hash.
 */
export const importWallet = (csv: string, dryRun = false) => {
  const rows = parseCsv(csv);
  if (!rows.length || !('amount' in rows[0]) || !('account' in rows[0])) bad('Not a Wallet export: needs account and amount columns');
  let added = 0, skipped = 0, transfers = 0;
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const ref = 'wallet:' + createHash('sha1').update(JSON.stringify(r)).digest('hex').slice(0, 20);
    if (one(`SELECT id FROM records WHERE import_ref = ?`, ref)) { skipped++; return; }
    const raw = Number(String(r.amount).replace(',', '.'));
    if (!Number.isFinite(raw) || raw === 0) { errors.push(`row ${i + 2}: bad amount`); return; }
    const ds = String(r.date).trim();
    const wall = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(ds); // no offset = wall time in TZ
    const when = wall ? zonedDate(wall[1], wall[2]) : new Date(ds.replace(' ', 'T'));
    if (Number.isNaN(when.getTime())) { errors.push(`row ${i + 2}: bad date`); return; }
    const isTransfer = String(r.transfer).toLowerCase() === 'true';
    const day = lifeDay(when);
    added++;
    if (isTransfer) transfers++;
    if (dryRun) return;
    const cur = String(r.currency || 'USD').toUpperCase();
    const acct = getAccount(String(r.account)) ?? addAccount({ name: String(r.account), currency: cur, type: 'other' });
    const amount = Math.abs(raw);
    const rate = rateFor(cur, day);
    const kind = isTransfer ? 'transfer' : raw < 0 ? 'expense' : 'income';
    const cat = !isTransfer && r.category ? findCategory(String(r.category), kind === 'income' ? 'income' : 'expense') : undefined;
    const months = Number(r.warranty_in_month) || 0;
    insert('records', {
      id: uuid(), account_id: acct.id, kind, amount, currency: cur, rate_to_usd: rate.rate, rate_estimated: rate.estimated, usd: round(amount * rate.rate, 2),
      category_id: cat?.id ?? null, labels: String(r.labels ?? '').split(/[|,]/).map((x) => x.trim().toLowerCase()).filter(Boolean),
      note: String(r.note ?? '').slice(0, 1000), payee: r.payee ? String(r.payee).slice(0, 120) : null, day, at: when.toISOString(),
      direction: raw < 0 ? -1 : 1, warranty_until: months > 0 ? addDays(day, Math.round(months * 30.44)) : null, import_ref: ref,
    });
  });
  return { added, skipped, transfers, errors: errors.slice(0, 20), dryRun };
};

export const exportRecords = () => all(`${SELECT} WHERE r.deleted_at IS NULL ORDER BY r.day, r.at`).map((r) => ({
  day: r.day, account: r.account_name, kind: r.kind, direction: r.direction, amount: r.amount, currency: r.currency, usd: r.usd,
  rate_estimated: r.rate_estimated ? 'yes' : '', category: r.parent_category ? `${r.parent_category}/${r.category_name}` : (r.category_name ?? ''),
  labels: j<string[]>(r.labels, []).join(' '), payee: r.payee ?? '', note: r.note, transfer_id: r.transfer_id ?? '',
}));
