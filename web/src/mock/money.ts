// Mock /api/v2 money, shopping, wishlist, afford, price memory and thrift.
import type { Account, Afford, Budget, Category, MoneyRecord, MoneySummary, PriceMemory, Runway, Savings, ShoppingItem, Wish } from '../v2';
import type { Recurring, ShopGroup, Skipped } from '../life';
import { dateAtNoon, dowOfYmd } from '../time';
import { recipes } from './health';
import {
  RATES_TO_USD,
  addDays,
  at,
  bad,
  created,
  daysBetween,
  idOf,
  iso,
  match,
  notFound,
  num,
  ok,
  round,
  str,
  toUsd,
  today,
  uid,
  weekStart,
  type Ctx,
  type Res,
} from './util';

// ---------- accounts + categories ----------

type AccountRow = Omit<Account, 'balance'>;
export const accounts: AccountRow[] = [
  { id: 'ac_cash', name: 'Cash', type: 'cash', currency: 'USD', track: 'personal', opening_balance: 370, archived: false },
  { id: 'ac_usd', name: 'USD savings', type: 'cash', currency: 'USD', track: 'personal', opening_balance: 650, archived: false },
  { id: 'ac_biz', name: 'Business', type: 'bank', currency: 'USD', track: 'business', opening_balance: 120, archived: false },
];

export const categories: Category[] = (() => {
  const rows: Category[] = [];
  const add = (id: string, name: string, kind: string, parent: string | null, track = 'personal') => {
    const p = parent ? rows.find((c) => c.id === parent) : undefined;
    rows.push({ id, name, kind, parent_id: parent, parent_name: p?.name ?? null, track });
  };
  add('c_food', 'Food', 'expense', null);
  add('c_groc', 'Groceries', 'expense', 'c_food');
  add('c_cafe', 'Café', 'expense', 'c_food');
  add('c_trans', 'Transport', 'expense', null);
  add('c_phone', 'Phone + internet', 'expense', null);
  add('c_health', 'Health', 'expense', null);
  add('c_gym', 'Gym', 'expense', 'c_health');
  add('c_family', 'Family', 'expense', null);
  add('c_fun', 'Fun', 'expense', null);
  add('c_tools', 'Software', 'expense', null, 'business');
  add('c_infra', 'Domains + mail', 'expense', 'c_tools', 'business');
  add('c_inc', 'Work income', 'income', null, 'business');
  add('c_gift', 'Gift', 'income', null);
  return rows;
})();

// ---------- records ----------

export const records: MoneyRecord[] = [];

function mkRecord(f: {
  id?: string; account: string; kind?: MoneyRecord['kind']; amount: number; category?: string | null;
  note: string; payee?: string | null; day: string; time?: string; labels?: string[];
}): MoneyRecord {
  const a = accounts.find((x) => x.id === f.account) ?? accounts[0]!;
  const c = f.category ? categories.find((x) => x.id === f.category) ?? null : null;
  const kind = f.kind ?? 'expense';
  const rate = RATES_TO_USD[a.currency] ?? 1;
  return {
    id: f.id ?? uid('m'),
    account_id: a.id,
    kind,
    amount: f.amount,
    currency: a.currency,
    rate_to_usd: round(rate, 6),
    rate_estimated: a.currency !== 'USD',
    usd: toUsd(f.amount, a.currency),
    category_id: c?.id ?? null,
    labels: f.labels ?? [],
    note: f.note,
    payee: f.payee ?? null,
    day: f.day,
    at: at(f.day, f.time ?? '12:00'),
    direction: kind === 'income' ? 1 : -1,
    account_name: a.name,
    track: a.track,
    category_name: c?.name ?? null,
    parent_category: c?.parent_name ?? null,
  };
}

function seedRecords() {
  const d = today();
  const r = (o: number, account: string, amount: number, category: string, note: string, time = '12:00', kind: MoneyRecord['kind'] = 'expense') =>
    records.push(mkRecord({ account, amount, category, note, day: addDays(d, -o), time, kind }));
  r(0, 'ac_cash', 1.92, 'c_cafe', 'coffee', '11:05');
  r(0, 'ac_cash', 13.85, 'c_groc', 'groceries: eggs, bread, milk', '18:40');
  r(1, 'ac_cash', 3.08, 'c_trans', 'taxi to the city centre', '15:10');
  r(1, 'ac_cash', 2.31, 'c_cafe', 'coffee + croissant', '11:20');
  r(2, 'ac_cash', 15.38, 'c_phone', 'mobile data top-up', '13:00');
  r(2, 'ac_biz', 12, 'c_infra', 'mail domain renewal', '21:00');
  r(3, 'ac_cash', 26.92, 'c_gym', 'gym month', '18:05');
  r(4, 'ac_cash', 20, 'c_groc', 'groceries: chicken, rice, veg', '18:00');
  r(5, 'ac_cash', 11.54, 'c_family', 'sweets for family visit', '17:00');
  r(6, 'ac_cash', 1.92, 'c_cafe', 'coffee', '11:00');
  r(8, 'ac_usd', 20, 'c_tools', 'Claude subscription', '10:45');
  r(9, 'ac_cash', 16.92, 'c_groc', 'groceries', '18:15');
  r(11, 'ac_cash', 4.62, 'c_fun', 'football pitch rental share', '21:00');
  r(13, 'ac_cash', 3.46, 'c_trans', 'bus + taxi', '14:00');
  r(16, 'ac_cash', 18.46, 'c_groc', 'groceries', '18:30');
  r(20, 'ac_cash', 38.46, 'c_gift', 'Gift money from uncle', '12:00', 'income');
  r(24, 'ac_cash', 14.62, 'c_groc', 'groceries', '18:00');
}
seedRecords();

const balanceOf = (a: AccountRow) =>
  round(a.opening_balance + records.filter((r) => r.account_id === a.id).reduce((s, r) => s + r.direction * r.amount, 0), 2);
export const listAccounts = (): Account[] => accounts.filter((a) => !a.archived).map((a) => ({ ...a, balance: balanceOf(a) }));

const CAT_WORDS: [RegExp, string][] = [
  [/coffee|caf[eé]|tea|croissant/i, 'c_cafe'],
  [/grocer|bread|milk|eggs|chicken|veg|rice|market/i, 'c_groc'],
  [/taxi|bus|fuel|petrol|transport/i, 'c_trans'],
  [/data|phone|internet|top-up/i, 'c_phone'],
  [/gym|protein/i, 'c_gym'],
  [/domain|mail|inbox/i, 'c_infra'],
  [/claude|figma|software|hosting/i, 'c_tools'],
  [/family|gift|sweets/i, 'c_family'],
];

/** "3 coffee", "coffee 4.5 usd", "$15 domain", "+50 gift" → a record. */
function parseQuickLog(text: string, accountRef?: string): Omit<Parameters<typeof mkRecord>[0], 'day'> | null {
  const m = /([+-]?)\s*(\$|usd\s*)?(\d+(?:[.,]\d+)?)\s*(\$|usd)?/i.exec(text);
  if (!m) return null;
  const amount = Number(m[3]!.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const isUsd = !!m[2] || /^(\$|usd)$/i.test(m[4] ?? '') || /\b(domain|mail|figma|hosting)\b/i.test(text);
  const note = text.replace(m[0], ' ').replace(/\s+/g, ' ').trim() || 'expense';
  const income = m[1] === '+' || /\b(income|paid me|salary)\b/i.test(text);
  let account = accounts.find((a) => a.id === accountRef || a.name.toLowerCase() === (accountRef ?? '').toLowerCase())?.id;
  if (!account) account = isUsd ? (/domain|mail|figma|hosting/i.test(note) ? 'ac_biz' : 'ac_usd') : 'ac_cash';
  const category = income ? (account === 'ac_biz' ? 'c_inc' : 'c_gift') : CAT_WORDS.find(([re]) => re.test(note))?.[1] ?? null;
  return { account, amount, kind: income ? 'income' : 'expense', category, note };
}

function rangeOf(period: string, day = today()): { from: string; to: string } {
  if (period === 'month') return { from: `${day.slice(0, 7)}-01`, to: day };
  if (period === 'year') return { from: `${day.slice(0, 4)}-01-01`, to: day };
  if (period === 'day') return { from: day, to: day };
  return { from: weekStart(day), to: day };
}

export function summary(period = 'week', track = 'personal'): MoneySummary {
  const { from, to } = rangeOf(period);
  const rows = records.filter((r) => r.day >= from && r.day <= to && (track === 'all' || r.track === track) && r.kind !== 'transfer');
  const spend = rows.filter((r) => r.kind === 'expense').reduce((s, r) => s + (r.usd ?? 0), 0);
  const income = rows.filter((r) => r.kind === 'income').reduce((s, r) => s + (r.usd ?? 0), 0);
  const byCat = new Map<string, number>();
  for (const r of rows.filter((x) => x.kind === 'expense')) {
    const name = r.parent_category ?? r.category_name ?? 'Uncategorised';
    byCat.set(name, (byCat.get(name) ?? 0) + (r.usd ?? 0));
  }
  return {
    from, to, track,
    spend_usd: round(spend, 2),
    income_usd: round(income, 2),
    net_usd: round(income - spend, 2),
    records: rows.length,
    estimated_rates: rows.filter((r) => r.rate_estimated).length,
    by_category: [...byCat].map(([name, usd]) => ({ name, usd: round(usd, 2) })).sort((a, b) => b.usd - a.usd),
  };
}

/** Living cash = personal balances minus accounts held by a savings goal (the car fund) and money owed. */
export function runway(): Runway {
  const held = new Set(goalDefs.map((g) => g.account_id).filter(Boolean));
  const personal = listAccounts().filter((a) => a.track === 'personal');
  const goal = personal.filter((a) => held.has(a.id)).reduce((s, a) => s + toUsd(a.balance, a.currency), 0);
  const owed = debts.filter((d) => d.direction === 'borrowed' && !d.closed).reduce((s, d) => s + toUsd(debtLeft(d), d.currency), 0);
  const cash = personal.filter((a) => !held.has(a.id)).reduce((s, a) => s + toUsd(a.balance, a.currency), 0) - owed;
  const from = addDays(today(), -27);
  const spent = records.filter((r) => r.track === 'personal' && r.kind === 'expense' && r.day >= from).reduce((s, r) => s + (r.usd ?? 0), 0);
  const weekly = round(spent / 4, 2);
  const weeks = weekly > 0 ? round(Math.max(0, cash) / weekly, 1) : null;
  return {
    cash_usd: round(cash, 2), weekly_burn_usd: weekly, weeks_measured: 4, runway_weeks: weeks, under_8_weeks: weeks != null && weeks < 8,
    goal_usd: round(goal, 2), owed_usd: round(owed, 2), lasts_to: weeks == null ? null : addDays(today(), Math.floor(weeks * 7)),
  };
}

// ---------- budgets + savings ----------

type BudgetDef = { id: string; name: string; period: 'week' | 'month' | 'year'; cats: string[]; amount_usd: number };
const budgetDefs: BudgetDef[] = [
  { id: 'b_week', name: 'Weekly spending', period: 'week', cats: [], amount_usd: 70 },
  { id: 'b_food', name: 'Food', period: 'month', cats: ['c_food', 'c_groc', 'c_cafe'], amount_usd: 110 },
  { id: 'b_trans', name: 'Transport', period: 'month', cats: ['c_trans'], amount_usd: 20 },
  { id: 'b_fun', name: 'Fun', period: 'month', cats: ['c_fun'], amount_usd: 15 },
];
const budgetOut = (b: BudgetDef): Budget => {
  const { from, to } = rangeOf(b.period);
  const spent = round(
    records
      .filter((r) => r.kind === 'expense' && r.track === 'personal' && r.day >= from && r.day <= to && (!b.cats.length || (r.category_id && b.cats.includes(r.category_id))))
      .reduce((s, r) => s + (r.usd ?? 0), 0),
    2,
  );
  return { id: b.id, name: b.name, period: b.period, amount_usd: b.amount_usd, spent_usd: spent, left_usd: round(b.amount_usd - spent, 2), share: round(spent / b.amount_usd, 2), from, to, category_ids: b.cats };
};
const budgets = (): Budget[] => budgetDefs.map(budgetOut);
const catIds = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => categories.find((c) => c.id === x || c.name.toLowerCase() === String(x).toLowerCase())?.id).filter((x): x is string => !!x) : [];

export const CAR_TARGET_DATE = addDays(today(), 210);
type GoalDef = { id: string; name: string; target_usd: number; target_date: string | null; saved_usd: number; account_id: string | null };
const goalDefs: GoalDef[] = [
  { id: 's_car', name: 'Savings fund: used car', target_usd: 9000, target_date: CAR_TARGET_DATE, saved_usd: 2350, account_id: 'ac_usd' },
  { id: 's_buffer', name: 'Cash floor (3 months)', target_usd: 900, target_date: null, saved_usd: 650, account_id: null },
];
export function savings(): Savings[] {
  return goalDefs.map((g) => {
    const acct = g.account_id ? listAccounts().find((a) => a.id === g.account_id) : undefined;
    const saved = acct ? toUsd(acct.balance, acct.currency) : g.saved_usd;
    const left = round(Math.max(0, g.target_usd - saved), 2);
    const months = g.target_date ? Math.max(1, daysBetween(today(), g.target_date) / 30.4) : null;
    return { id: g.id, name: g.name, target_usd: g.target_usd, target_date: g.target_date, saved_usd: round(saved, 2), left_usd: left, monthly_needed_usd: months ? round(left / months, 0) : null, account_id: g.account_id };
  });
}

// ---------- debts + rates ----------

type DebtRow = { id: string; person: string; direction: 'lent' | 'borrowed'; amount: number; currency: string; note: string; account_id: string | null; repaid: number };
const debts: (DebtRow & { closed: boolean })[] = [
  { id: 'd_1', person: 'Karim', direction: 'lent', amount: 40, currency: 'USD', note: 'phone repair', account_id: null, repaid: 15, closed: false },
];
const debtLeft = (d: DebtRow) => round(Math.max(0, d.amount - d.repaid), 2);
const debtOut = (d: DebtRow & { closed: boolean }) => ({ ...d, left: debtLeft(d) });
const rateRows: { currency: string; day: string; to_usd: number }[] = [{ currency: 'EUR', day: today(), to_usd: RATES_TO_USD.EUR! }];
const recordFor = new Map<string, string>();

// ---------- shopping ----------

type ShopRow = ShoppingItem & { store: string };
const shopping: ShopRow[] = [
  { id: 'sh_1', list: 'groceries', name: 'Eggs', qty: '30', done: false, store: 'Grocer' },
  { id: 'sh_2', list: 'groceries', name: 'Chicken breast', qty: '1 kg', done: false, store: 'Butcher' },
  { id: 'sh_3', list: 'groceries', name: 'Oats', qty: '1 kg', done: false, store: 'Grocer' },
  { id: 'sh_4', list: 'groceries', name: 'Bananas', qty: '1 kg', done: true, store: 'Market' },
  { id: 'sh_5', list: 'groceries', name: 'Lentils', qty: '500 g', done: false, store: 'Grocer' },
  { id: 'sh_6', list: 'home', name: 'Laptop stand', qty: null, done: false, store: 'Online' },
];
const storeFor = (name: string) =>
  /chicken|beef|lamb|meat/i.test(name) ? 'Butcher' : /banana|tomato|onion|potato|apple|orange|fruit|veg/i.test(name) ? 'Market' : 'Grocer';
const shopOut = ({ store: _s, ...i }: ShopRow): ShoppingItem => i;

// ---------- wishlist ----------

type WishRow = Omit<Wish, 'ready' | 'hours_left' | 'usd'> & { created: number };
const wishes: WishRow[] = [
  { id: 'w_1', name: 'Mechanical keyboard', price: 75, currency: 'USD', ready_on: addDays(today(), 3), note: 'Only after the side project ships.', status: 'waiting', pushed: false, created: Date.now() - 4 * 86400000 },
  { id: 'w_2', name: 'Running shoes', price: 90, currency: 'USD', ready_on: addDays(today(), -1), note: null, status: 'waiting', pushed: true, created: Date.now() - 8 * 86400000 },
  { id: 'w_3', name: 'Cookbook', price: 20, currency: 'USD', ready_on: addDays(today(), -12), note: null, status: 'bought', pushed: true, created: Date.now() - 20 * 86400000 },
];
function wishOut(w: WishRow): Wish {
  const { created: _c, ...rest } = w;
  const readyMs = Date.parse(`${w.ready_on}T04:00:00Z`);
  const hours = Math.max(0, Math.ceil((readyMs - Date.now()) / 3600000));
  return { ...rest, usd: toUsd(w.price, w.currency), ready: hours === 0, hours_left: hours };
}

// ---------- thrift ----------

const skipped: Skipped['items'] = [
  { id: 'sk_1', name: 'Takeaway pizza', amount: 11, currency: 'USD', usd: 11, day: addDays(today(), -2) },
  { id: 'sk_2', name: 'New headphones', amount: 50, currency: 'USD', usd: 50, day: addDays(today(), -9) },
];
const skippedOut = (): Skipped => ({
  items: [...skipped].sort((a, b) => b.day.localeCompare(a.day)),
  summary: { total_usd: round(skipped.reduce((s, i) => s + (i.usd ?? 0), 0), 2), count: skipped.length },
});

// ---------- router ----------

export function handleMoney(c: Ctx): Res | null {
  const { route, qp, b } = c;
  let m: string[] | null;

  if (route === 'GET /money/accounts') return ok(listAccounts());
  if (route === 'GET /money/categories') return ok(categories);
  if (route === 'GET /free-to-spend') {
    const d = dateAtNoon(today());
    const mon = new Date(d.getTime() - ((dowOfYmd(today()) + 6) % 7) * 864e5);
    const sun = new Date(mon.getTime() + 6 * 864e5);
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    const wk = budgetDefs.find((x) => x.period === 'week' && !x.cats.length);
    const budget = wk ? wk.amount_usd : 70, used = wk ? budgetOut(wk).spent_usd : 61.1, planned = 0, free = budget - used - planned;
    return ok({
      estimate: true, week_from: iso(mon), week_to: iso(sun), source: 'budget', budget_usd: budget, used_usd: used, planned_usd: planned, free_usd: free,
      planned: [],
      line: `About $${free.toFixed(2)} free this week after the savings fund and cash floor.`,
    });
  }
  if (route === 'GET /money/records') {
    const from = qp.get('from');
    const to = qp.get('to');
    const s = (qp.get('q') ?? '').toLowerCase();
    const limit = num(qp.get('limit'), 50);
    const kind = qp.get('kind');
    const acc = qp.get('account');
    const list = records
      .filter((r) => (!from || r.day >= from) && (!to || r.day <= to) && (!s || r.note.toLowerCase().includes(s) || (r.category_name ?? '').toLowerCase().includes(s)))
      .filter((r) => (!kind || r.kind === kind) && (!acc || r.account_id === acc))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
    return ok(list);
  }
  if (route === 'POST /money/records') {
    const id = idOf(b, 'm');
    const dup = records.find((r) => r.id === id);
    if (dup) return ok(dup);
    let rec: MoneyRecord;
    if (typeof b.text === 'string') {
      const parsed = parseQuickLog(b.text, typeof b.account === 'string' ? b.account : undefined);
      if (!parsed) return bad('Could not read an amount. Try "250 coffee" or "$12 domain".');
      rec = mkRecord({ ...parsed, id, day: str(b.day) || today(), time: new Date().toTimeString().slice(0, 5) });
    } else {
      const amount = num(b.amount);
      if (amount <= 0) return bad('Amount must be above 0.');
      const cur = str(b.currency).toUpperCase();
      const byCur = cur ? accounts.find((a) => a.track === 'personal' && !a.archived && a.currency === cur)?.id : undefined;
      if (cur && !byCur && !b.account) return bad(`No ${cur} account yet. Add one first.`);
      const acc = accounts.find((a) => a.id === b.account || a.name === b.account)?.id ?? byCur ?? 'ac_cash';
      const kind = (b.kind as MoneyRecord['kind']) ?? 'expense';
      const guess = b.structured && kind === 'expense' ? CAT_WORDS.find(([re]) => re.test(str(b.note)))?.[1] ?? null : null;
      rec = mkRecord({ id, account: acc, amount, kind, category: (b.category as string) ?? guess, note: str(b.note), day: str(b.day) || today() });
    }
    records.push(rec);
    return created(rec);
  }
  if ((m = match(route, /^DELETE \/money\/records\/([^/]+)$/))) {
    const i = records.findIndex((r) => r.id === m![0]);
    if (i < 0) return notFound('Record');
    const [gone] = records.splice(i, 1);
    removedMoney.push({ row: gone!, at: iso() });
    return ok({ ok: true, id: gone!.id });
  }
  if (route === 'GET /money/summary') return ok(summary(qp.get('period') ?? 'week', qp.get('track') ?? 'personal'));
  if (route === 'GET /money/runway') return ok(runway());
  if (route === 'GET /money/budgets') return ok(budgets());
  if (route === 'GET /money/savings') return ok(savings());

  // budgets: weekly, add, edit, delete
  if (route === 'POST /money/budgets/weekly') {
    const amount = num(b.amount_usd);
    if (amount <= 0) return bad('amount_usd must be > 0');
    let w = budgetDefs.find((x) => x.period === 'week' && !x.cats.length);
    if (w) w.amount_usd = amount;
    else budgetDefs.unshift((w = { id: uid('b'), name: 'Weekly spending', period: 'week', cats: [], amount_usd: amount }));
    return ok(budgetOut(w));
  }
  if (route === 'POST /money/budgets') {
    const amount = num(b.amount_usd);
    const name = str(b.name).trim();
    if (!name || amount <= 0) return bad('name and amount_usd > 0 are required');
    const period = (['week', 'month', 'year'].includes(str(b.period)) ? b.period : 'month') as BudgetDef['period'];
    const d: BudgetDef = { id: idOf(b, 'b'), name, period, cats: catIds(b.categories), amount_usd: amount };
    budgetDefs.push(d);
    return created(budgetOut(d));
  }
  if ((m = match(route, /^(PATCH|DELETE) \/money\/budgets\/([^/]+)$/))) {
    const i = budgetDefs.findIndex((x) => x.id === m![1]);
    if (i < 0) return notFound('Budget');
    if (m[0] === 'DELETE') return ok({ ok: true, id: budgetDefs.splice(i, 1)[0]!.id });
    const d = budgetDefs[i]!;
    if (b.amount_usd !== undefined) {
      if (num(b.amount_usd) <= 0) return bad('amount_usd must be > 0');
      d.amount_usd = num(b.amount_usd);
    }
    if (typeof b.name === 'string' && b.name.trim()) d.name = b.name.trim();
    if (['week', 'month', 'year'].includes(str(b.period))) d.period = b.period as BudgetDef['period'];
    if (Array.isArray(b.categories)) d.cats = catIds(b.categories);
    return ok(budgetOut(d));
  }

  // savings goals
  if (route === 'POST /money/savings') {
    const name = str(b.name).trim();
    const target = num(b.target_usd);
    if (!name || target <= 0) return bad('name and target_usd > 0 are required');
    const acc = b.account ? accounts.find((a) => a.id === b.account || a.name === b.account)?.id ?? null : null;
    if (b.account && !acc) return notFound('Account');
    const g: GoalDef = { id: idOf(b, 's'), name, target_usd: target, target_date: str(b.target_date) || null, saved_usd: 0, account_id: acc };
    goalDefs.push(g);
    return created(savings().find((s) => s.id === g.id));
  }
  if ((m = match(route, /^(PATCH|DELETE) \/money\/savings\/([^/]+)$/))) {
    const i = goalDefs.findIndex((x) => x.id === m![1]);
    if (i < 0) return notFound('Savings goal');
    if (m[0] === 'DELETE') return ok({ ok: true, id: goalDefs.splice(i, 1)[0]!.id });
    const g = goalDefs[i]!;
    if (b.target_usd !== undefined) {
      if (num(b.target_usd) <= 0) return bad('target_usd must be > 0');
      g.target_usd = num(b.target_usd);
    }
    if (typeof b.name === 'string' && b.name.trim()) g.name = b.name.trim();
    if (b.target_date !== undefined) g.target_date = str(b.target_date) || null;
    if (b.account !== undefined) g.account_id = b.account ? accounts.find((a) => a.id === b.account || a.name === b.account)?.id ?? null : null;
    return ok(savings().find((s) => s.id === g.id));
  }

  // accounts + transfers
  if (route === 'POST /money/accounts') {
    const name = str(b.name).trim();
    const currency = str(b.currency).toUpperCase();
    if (!name || !RATES_TO_USD[currency]) return bad('name and a known currency are required');
    const id = idOf(b, 'ac');
    let a = accounts.find((x) => x.id === id);
    if (!a) {
      a = { id, name, type: str(b.type, 'cash'), currency, track: str(b.track, 'personal'), opening_balance: num(b.opening_balance), archived: false };
      accounts.push(a);
    }
    return created({ ...a, balance: balanceOf(a) });
  }
  if ((m = match(route, /^PATCH \/money\/accounts\/([^/]+)$/))) {
    const a = accounts.find((x) => x.id === m![0]);
    if (!a) return notFound('Account');
    if (typeof b.name === 'string' && b.name.trim()) a.name = b.name.trim();
    if (typeof b.archived === 'boolean') a.archived = b.archived;
    if (b.opening_balance !== undefined) a.opening_balance = num(b.opening_balance);
    return ok({ ...a, balance: balanceOf(a) });
  }
  if (route === 'POST /money/transfer') {
    const find = (v: unknown) => accounts.find((a) => a.id === v || a.name === v);
    const from = find(b.from);
    const to = find(b.to);
    const amount = num(b.amount);
    if (!from || !to) return notFound('Account');
    if (from.id === to.id) return bad('from and to must differ');
    if (amount <= 0) return bad('amount must be > 0');
    const toAmount = b.to_amount !== undefined ? num(b.to_amount) : from.currency === to.currency ? amount : round(toUsd(amount, from.currency) / (RATES_TO_USD[to.currency] ?? 1), 2);
    const day = str(b.day) || today();
    const out = mkRecord({ account: from.id, kind: 'transfer', amount, note: str(b.note) || `To ${to.name}`, day });
    const inn = mkRecord({ account: to.id, kind: 'transfer', amount: toAmount, note: str(b.note) || `From ${from.name}`, day });
    out.direction = -1;
    inn.direction = 1;
    records.push(out, inn);
    return created({ from: out, to: inn });
  }

  // rates: stored as USD per unit; the UI asks for units per USD and sends the inverse
  if (route === 'GET /money/rates') return ok(rateRows);
  if (route === 'POST /money/rates') {
    const currency = str(b.currency).toUpperCase();
    const to = num(b.to_usd);
    if (!currency || to <= 0) return bad('currency and to_usd > 0 are required');
    const row = { currency, day: str(b.day) || today(), to_usd: to };
    const i = rateRows.findIndex((r) => r.currency === currency);
    if (i >= 0) rateRows[i] = row;
    else rateRows.push(row);
    RATES_TO_USD[currency] = to;
    return created(row);
  }

  // debts: repayments are in the debt's currency
  if (route === 'GET /money/debts') return ok(debts.map(debtOut));
  if (route === 'POST /money/debts') {
    const person = str(b.person).trim();
    const amount = num(b.amount);
    if (!person || amount <= 0) return bad('person and amount > 0 are required');
    const acc = b.account ? accounts.find((a) => a.id === b.account || a.name === b.account) : undefined;
    const d = {
      id: idOf(b, 'd'), person, direction: (b.direction === 'borrowed' ? 'borrowed' : 'lent') as DebtRow['direction'], amount,
      currency: str(b.currency, acc?.currency ?? 'USD').toUpperCase(), note: str(b.note), account_id: acc?.id ?? null, repaid: 0, closed: false,
    };
    debts.push(d);
    return created(debtOut(d));
  }
  if ((m = match(route, /^POST \/money\/debts\/([^/]+)\/repay$/))) {
    const d = debts.find((x) => x.id === m![0]);
    if (!d) return notFound('Debt');
    const amount = num(b.amount);
    if (amount <= 0) return bad('amount must be > 0');
    d.repaid = round(Math.min(d.amount, d.repaid + amount), 2);
    d.closed = d.repaid >= d.amount;
    return ok(debtOut(d));
  }

  // who an expense was for
  if ((m = match(route, /^(GET|PUT) \/records\/([^/]+)\/for$/))) {
    const id = m[1]!;
    if (m[0] === 'GET') return ok({ record_id: id, who: recordFor.get(id) ?? null });
    const who = str(b.who).trim().toLowerCase();
    if (who) recordFor.set(id, who);
    else recordFor.delete(id);
    return ok({ record_id: id, who: who || null });
  }
  if (route === 'GET /money/price-memory') {
    const s = (qp.get('q') ?? '').toLowerCase().trim();
    const hits = s ? records.filter((r) => r.kind === 'expense' && r.note.toLowerCase().includes(s)).sort((a, b) => b.day.localeCompare(a.day)) : [];
    const entries = hits.map((r) => ({ amount: r.amount, currency: r.currency, day: r.day, note: r.note }));
    const byCur = new Map<string, number[]>();
    for (const e of entries) byCur.set(e.currency, [...(byCur.get(e.currency) ?? []), e.amount]);
    const pm: PriceMemory = {
      q: qp.get('q') ?? '',
      count: entries.length,
      last: entries[0] ?? null,
      stats: [...byCur].map(([currency, xs]) => ({
        currency, n: xs.length, last: xs[0]!, min: Math.min(...xs), max: Math.max(...xs), avg: round(xs.reduce((a, x) => a + x, 0) / xs.length, 0),
      })),
      entries: entries.slice(0, 10),
    };
    return ok(pm);
  }

  // shopping
  if (route === 'GET /shopping') {
    const list = qp.get('list');
    return ok(shopping.filter((i) => !list || i.list === list).map(shopOut));
  }
  if (route === 'POST /shopping') {
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    const id = idOf(b, 'sh');
    let item = shopping.find((i) => i.id === id);
    if (!item) {
      item = { id, list: str(b.list, 'groceries'), name, qty: (b.qty as string | undefined) || null, done: false, store: storeFor(name) };
      shopping.push(item);
    }
    return created(shopOut(item));
  }
  if ((m = match(route, /^POST \/shopping\/([^/]+)\/toggle$/))) {
    const item = shopping.find((i) => i.id === m![0]);
    if (!item) return notFound('Item');
    item.done = typeof b.done === 'boolean' ? b.done : !item.done;
    return ok(shopOut(item));
  }
  if (route === 'POST /shopping/clear-done') {
    let n = 0;
    for (let i = shopping.length - 1; i >= 0; i--) if (shopping[i]!.done) { shopping.splice(i, 1); n++; }
    return ok({ cleared: n });
  }

  // wishlist
  if (route === 'GET /wishlist') {
    const s = qp.get('status');
    return ok(wishes.filter((w) => !s || s === 'all' || w.status === s).sort((a, b) => b.created - a.created).map(wishOut));
  }
  if (route === 'POST /wishlist') {
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    const id = idOf(b, 'w');
    let w = wishes.find((x) => x.id === id);
    if (!w) {
      const price = num(b.price);
      const currency = str(b.currency, 'USD').toUpperCase();
      // Cooling-off: 72 h, or 7 days for anything over $50.
      const days = toUsd(price, currency) > 50 ? 7 : 3;
      w = { id, name, price, currency, ready_on: addDays(today(), days), note: (b.note as string) || null, status: 'waiting', pushed: false, created: Date.now() };
      wishes.push(w);
    }
    return created(wishOut(w));
  }
  if ((m = match(route, /^POST \/wishlist\/([^/]+)\/status$/))) {
    const w = wishes.find((x) => x.id === m![0]);
    if (!w) return notFound('Wish');
    if (b.status === 'waiting' || b.status === 'bought' || b.status === 'dropped') w.status = b.status;
    return ok(wishOut(w));
  }
  if ((m = match(route, /^DELETE \/wishlist\/([^/]+)$/))) {
    const i = wishes.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Wish');
    wishes.splice(i, 1);
    return ok({ ok: true });
  }

  // afford
  if (route === 'GET /afford') {
    const amount = num(qp.get('amount'));
    const currency = (qp.get('currency') ?? 'USD').toUpperCase();
    const usd = toUsd(amount, currency);
    const rw = runway();
    const fromCar = qp.get('from') === 'car';
    // Living cash pays by default; "car" pays from the car fund and leaves living cash alone.
    const after = fromCar ? rw.cash_usd : round(rw.cash_usd - usd, 2);
    const car = savings()[0]!;
    const months = Math.max(1, daysBetween(today(), CAR_TARGET_DATE) / 30.4);
    const af: Afford = {
      amount, currency, usd, rate_estimated: currency !== 'USD', from: fromCar ? 'savings_goal' : 'living_cash',
      cash_usd: rw.cash_usd, cash_after_usd: after, weekly_burn_usd: rw.weekly_burn_usd,
      runway_weeks: rw.runway_weeks,
      runway_after_weeks: rw.weekly_burn_usd > 0 ? round(Math.max(0, after) / rw.weekly_burn_usd, 1) : null,
      under_8_weeks_after: rw.weekly_burn_usd > 0 && after / rw.weekly_burn_usd < 8,
      weeks_of_spend: rw.weekly_burn_usd > 0 ? round(usd / rw.weekly_burn_usd, 1) : null,
      car_fund: fromCar
        ? {
            name: car.name, saved_usd: car.saved_usd, saved_after_usd: round(car.saved_usd - usd, 2),
            left_usd: car.left_usd, left_after_usd: round(car.left_usd + usd, 2), target_date: car.target_date,
            monthly_needed_usd: car.monthly_needed_usd, monthly_needed_after_usd: round((car.left_usd + usd) / months, 0),
          }
        : null,
      cooling_off: usd > 20 ? 'Above $20: add it to the wishlist, decide in 72 h.' : null,
    };
    return ok(af);
  }

  // thrift
  if (route === 'GET /thrift/by-who') {
    const to = qp.get('to') || today();
    const from = qp.get('from') || addDays(to, -29);
    const rows = records.filter((r) => r.kind === 'expense' && r.day >= from && r.day <= to);
    const groups = new Map<string, { who: string; usd: number; count: number }>();
    let untagged_usd = 0, untagged_count = 0, total_usd = 0;
    for (const r of rows) {
      const usd = Math.abs(r.usd ?? 0);
      total_usd += usd;
      const who = recordFor.get(r.id);
      if (!who) { untagged_usd += usd; untagged_count++; continue; }
      const g = groups.get(who) ?? { who, usd: 0, count: 0 };
      g.usd += usd; g.count++; groups.set(who, g);
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return ok({ from, to, by_who: [...groups.values()].map((g) => ({ ...g, usd: r2(g.usd) })).sort((a, b2) => b2.usd - a.usd), untagged_usd: r2(untagged_usd), untagged_count, total_usd: r2(total_usd) });
  }
  if (route === 'GET /thrift/recurring') {
    const r: Recurring = {
      rule: 'No recurring cost except Claude.',
      items: [{ name: 'Claude subscription', monthly_usd: 20, line: '$20 / month', allowed: true }],
      count: 1,
      monthly_usd: 20,
      message: 'One recurring cost, and it is the allowed one.',
    };
    return ok(r);
  }
  if (route === 'GET /thrift/skipped') return ok(skippedOut());
  if (route === 'POST /thrift/skipped') {
    const amount = b.amount == null ? null : num(b.amount);
    const currency = str(b.currency, 'USD').toUpperCase();
    const item = { id: uid('sk'), name: str(b.name) || null, amount, currency, usd: amount == null ? null : toUsd(amount, currency), day: today() };
    skipped.push(item);
    return created({ ...item, summary: skippedOut().summary });
  }
  if (route === 'GET /thrift/shop-groups') {
    const list = qp.get('list');
    const groups = new Map<string, ShopGroup>();
    for (const i of shopping.filter((x) => !x.done && (!list || x.list === list))) {
      const g = groups.get(i.store) ?? { store: i.store, count: 0, items: [] };
      g.items.push({ id: i.id, name: i.name, qty: i.qty, done: !!i.done });
      g.count++;
      groups.set(i.store, g);
    }
    return ok([...groups.values()].sort((a, b) => b.count - a.count));
  }

  return handleMoneyMore(c);
}

/** Deleted money records, for /removed. */
export const removedMoney: { row: MoneyRecord; at: string }[] = [];
export const restoreMoney = (id: string) => {
  const i = removedMoney.findIndex((x) => x.row.id === id);
  if (i < 0) return false;
  records.push(removedMoney.splice(i, 1)[0]!.row);
  return true;
};
export const usdOf = (amount: number, currency: string) => toUsd(amount, currency);

// ---------- record edits, recipe → shopping, skipped delete ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function handleMoneyMore(c: Ctx): Res | null {
  const { route, b } = c;
  let m: string[] | null;
  if ((m = match(route, /^PATCH \/money\/records\/([^/]+)$/))) {
    const r = records.find((x) => x.id === m![0]);
    if (!r) return notFound('Record');
    if (b.amount !== undefined) {
      const a = num(b.amount, NaN);
      if (!Number.isFinite(a) || a <= 0) return bad('amount must be a number above 0.');
    }
    if (b.day !== undefined && (typeof b.day !== 'string' || !DAY_RE.test(b.day))) return bad('day must be YYYY-MM-DD.');
    if (b.kind !== undefined && !['expense', 'income', 'transfer'].includes(str(b.kind))) return bad('kind must be expense or income.');
    if (b.rate_to_usd !== undefined && !(num(b.rate_to_usd, NaN) > 0)) return bad('rate_to_usd must be above 0.');
    if (b.category !== undefined && b.category !== null && b.category !== '' && !categories.some((x) => x.id === b.category)) return notFound('Category');
    if (b.labels !== undefined && !Array.isArray(b.labels)) return bad('labels must be a list.');
    if (b.amount !== undefined) r.amount = num(b.amount);
    if (b.day !== undefined) {
      r.day = b.day as string;
      r.at = at(r.day, r.at.slice(11, 16) || '12:00');
    }
    if (b.kind !== undefined) {
      r.kind = b.kind as MoneyRecord['kind'];
      r.direction = r.kind === 'income' ? 1 : -1;
    }
    if (b.rate_to_usd !== undefined) {
      r.rate_to_usd = round(num(b.rate_to_usd), 6);
      r.rate_estimated = false;
    }
    if (b.note !== undefined) r.note = str(b.note);
    if (b.payee !== undefined) r.payee = str(b.payee) || null;
    if (b.labels !== undefined) r.labels = (b.labels as unknown[]).map(String);
    if (b.category !== undefined) {
      const cat = categories.find((x) => x.id === b.category) ?? null;
      r.category_id = cat?.id ?? null;
      r.category_name = cat?.name ?? null;
      r.parent_category = cat?.parent_name ?? null;
    }
    r.usd = r.rate_to_usd != null ? round(r.amount * r.rate_to_usd, 2) : toUsd(r.amount, r.currency);
    return ok(r);
  }
  if (route === 'POST /thrift/recipe-to-shopping') {
    const ref = str(b.recipe).trim();
    if (!ref) return bad('Pick a recipe.');
    const rc = recipes.find((x) => x.id === ref || x.name.toLowerCase() === ref.toLowerCase());
    if (!rc) return notFound('Recipe');
    const portions = num(b.portions, NaN);
    const days = num(b.days, NaN);
    if (!Number.isFinite(portions) || portions <= 0) return bad('portions must be above 0.');
    if (!Number.isFinite(days) || days <= 0 || days > 60) return bad('days must be 1–60.');
    const list = str(b.list, 'groceries').trim() || 'groceries';
    const skip = new Set((Array.isArray(b.skip) ? b.skip : []).map((x) => String(x).toLowerCase()));
    const factor = round((portions * days) / (rc.portions || 1), 2);
    const added: ShoppingItem[] = [];
    const merged: { id: string; name: string; qty: string | null }[] = [];
    const skippedNames: string[] = [];
    for (const ing of rc.ingredients) {
      if (skip.has(ing.name.toLowerCase())) {
        skippedNames.push(ing.name);
        continue;
      }
      const qty = `${round(ing.qty * factor, 0)} ${ing.unit}`;
      const have = shopping.find((x) => !x.done && x.list === list && x.name.toLowerCase() === ing.name.toLowerCase());
      if (have) {
        have.qty = have.qty ? `${have.qty} + ${qty}` : qty;
        merged.push({ id: have.id, name: have.name, qty: have.qty });
        continue;
      }
      const row: ShopRow = { id: uid('sh'), list, name: ing.name, qty, done: false, store: storeFor(ing.name) };
      shopping.push(row);
      added.push(shopOut(row));
    }
    return ok({ recipe: rc.name, portions, days, factor, list, added, merged, skipped: skippedNames });
  }
  if ((m = match(route, /^DELETE \/thrift\/skipped\/([^/]+)$/))) {
    const i = skipped.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Skipped item');
    skipped.splice(i, 1);
    return ok(skippedOut());
  }
  return null;
}
