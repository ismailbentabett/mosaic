/**
 * Quick add parsing. Pure: no DOM, no network, no storage (overrides are passed in).
 * The server still parses tasks and money itself; this decides the type, fills the
 * extra fields and writes the one-line preview, so the user sees what will be saved.
 */
import { parseAmount } from '../money/amount';

export type QuickType = 'task' | 'expense' | 'income' | 'food' | 'water' | 'set' | 'weight' | 'note' | 'idea' | 'habit';
export type QuickKind = 'auto' | QuickType;

export const QUICK_TYPES: QuickType[] = ['task', 'expense', 'income', 'food', 'water', 'set', 'weight', 'note', 'idea', 'habit'];

export type Currency = 'USD' | 'EUR' | 'GBP';

export type DetectCtx = {
  /** A workout is running: "3x8 bench" is a set, not a task. */
  activeWorkout?: boolean;
  /** Lower-case names of foods the user logs (recent + search hits). */
  foods?: string[];
  /** Habit names. */
  habits?: string[];
  /** patternKey → type the user picked by hand last time. */
  overrides?: Record<string, QuickType>;
};

export type Detected = { type: QuickType; why: string; text: string };

// ---------- helpers ----------

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const toNum = (s: string) => Number(s.replace(',', '.'));
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Explicit prefixes: "note: …", "idea …", "t: …". Returns the type and the text without it. */
const PREFIX: [RegExp, QuickType][] = [
  [/^(?:task|todo|t)\s*[:>]\s*/i, 'task'],
  [/^(?:note|n|log)\s*[:>]\s*/i, 'note'],
  [/^(?:idea|someday|i)\s*[:>]\s*/i, 'idea'],
  [/^(?:expense|spent|paid)\s*[:>]?\s*(?=[\d$€])/i, 'expense'],
  [/^(?:expense)\s*[:>]\s*/i, 'expense'],
  [/^(?:income|earned|got paid|received)\s*[:>]?\s*(?=[\d$€+])/i, 'income'],
  [/^(?:income)\s*[:>]\s*/i, 'income'],
  [/^(?:food|eat)\s*[:>]\s*/i, 'food'],
  [/^ate\s+(?=\S)/i, 'food'],
  [/^(?:weight|weigh(?:ed)?|w)\s*[:>]?\s*(?=\d)/i, 'weight'],
  [/^(?:drank|water)\s*[:>]?\s*(?=\d)/i, 'water'],
  [/^(?:set|lift)\s*[:>]\s*/i, 'set'],
  [/^(?:habit|did|done)\s*[:>]\s*/i, 'habit'],
];

export function stripPrefix(text: string): { type: QuickType | null; rest: string } {
  const t = text.trimStart();
  for (const [re, type] of PREFIX) {
    const m = re.exec(t);
    if (m) return { type, rest: t.slice(m[0].length) };
  }
  return { type: null, rest: text };
}

/**
 * The "shape" of a text, so a manual choice can be remembered for similar texts:
 * numbers become 9, words after the first two are dropped, case is ignored.
 * "500 coffee" and "650 coffee" share a key; "Call mom" does not match "Call the bank".
 */
export function patternKey(text: string): string {
  const words = squash(text.toLowerCase()).replace(/\d+(?:[.,]\d+)?/g, '9').split(' ').filter(Boolean);
  // A leading number is the strongest signal: keep it and the word after it.
  return words.slice(0, 2).join(' ');
}

// ---------- money ----------

export type MoneyParse = { amount: number; currency: Currency | null; income: boolean; note: string; explicit: boolean };

/**
 * "5 coffee", "+1200 usd salary", "$12 domain", "taxi 18€", "1,500.50 eur flight", "2k rent".
 * Same parser as the server (features/money/amount.ts), so the preview shows what gets saved.
 */
export function parseMoney(text: string): MoneyParse | null {
  const a = parseAmount(text);
  if (!a) return null;
  return { amount: a.amount, currency: a.currency, income: a.sign === '+', note: a.note, explicit: a.explicit };
}

/** Words that make a line about money even without a currency: spend verbs and common buys. */
export const SPEND_WORD =
  /(^|\s)(?:spent|spend|paid|pay|bought|buy|cost|costs|price|bill|rent|groceries|grocery|coffee|cafe|café|lunch|dinner|breakfast|taxi|uber|bus|fuel|gas|petrol|essence|bread|baguette|croissants?|market|shop|shopping|pharmacy|medicine|doctor|haircut|barber|internet|phone|top-?up|recharge|credit|subscription|domain|hosting|gift|clothes|shoes|snack|pizza|kebab|sandwich|restaurant|electricity|water bill|fee|fees|ticket)(?=\s|$)/i;

// ---------- counts: "10 emails", "5 pages", "123400 km" are not money ----------

/** Words that count things. A number before one of these is a count, never an expense. */
const COUNT_WORD =
  /^(?:dms?|messages?|msgs?|emails?|mails?|texts?|applications?|apps?|pages?|sets?|reps?|km|kms|kilometers?|kilometres?|miles?|glasses?|cups?|calls?|sites?|websites?|posts?|leads?|proposals?|looms?|videos?|follow-?ups?|replies|pushups?|push-ups?|squats?|laps?|steps?|minutes?|mins?|hours?|hrs?|words?|cards?|lessons?|chapters?|times?)$/i;

export type CountRoute = { to: 'car_km'; km: number } | { to: 'done'; text: string };

/**
 * A number followed by a count word: "10 emails to the team in Leeds", "5 pages", "123400 km".
 * km ≥ 1000 alone → car odometer. Anything else → a done-log note.
 */
export function countRoute(text: string): CountRoute | null {
  const t = squash(text);
  const m = /^(\d+)\s*([a-z][a-z-]*)(?=\s|$)\s*(.*)$/i.exec(t);
  if (!m || !COUNT_WORD.test(m[2])) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const rest = m[3].trim().toLowerCase();
  if (/^kms?$/.test(unit) && n >= 1000 && !rest) return { to: 'car_km', km: n };
  return { to: 'done', text: t };
}

// ---------- body ----------

/** "72.4kg", "weight 72,4", "w 72.4 kg". */
export function parseWeight(text: string): { kg: number } | null {
  const { type, rest } = stripPrefix(text);
  const t = squash(rest);
  const withKg = new RegExp(String.raw`^(${NUM})\s*kgs?$`, 'i').exec(t);
  if (withKg) return { kg: toNum(withKg[1]) };
  if (type === 'weight') {
    const bare = new RegExp(String.raw`^(${NUM})$`).exec(t);
    if (bare) return { kg: toNum(bare[1]) };
  }
  return null;
}

// ---------- water ----------

/** "500ml", "1.5l water", "water", "2 glasses", "bottle of water". */
export function parseWater(text: string): { ml: number } | null {
  const { type, rest } = stripPrefix(text);
  const t = squash((type === 'water' ? 'water ' + rest : rest).toLowerCase());
  const unit = new RegExp(String.raw`^(${NUM})\s*(ml|l|cl|liters?|litres?)(?:\s+(?:of\s+)?water)?$`).exec(t);
  if (unit) {
    const n = toNum(unit[1]);
    const u = unit[2];
    const ml = u === 'ml' ? n : u === 'cl' ? n * 10 : n * 1000;
    return ml > 0 && ml <= 5000 ? { ml: Math.round(ml) } : null;
  }
  const cups = /^(?:(\d+)\s+)?(glass(?:es)?|cups?|bottles?)(?:\s+(?:of\s+)?water)?$/.exec(t);
  if (cups) {
    const n = cups[1] ? Number(cups[1]) : 1;
    const each = cups[2].startsWith('bottle') ? 500 : 250;
    return n > 0 && n <= 12 ? { ml: n * each } : null;
  }
  if (/^(?:a\s+)?water$/.test(t)) return { ml: 250 };
  const tail = new RegExp(String.raw`^water\s+(${NUM})\s*(ml|l)?$`).exec(t);
  if (tail) {
    const n = toNum(tail[1]);
    const ml = tail[2] === 'l' || (!tail[2] && n < 10) ? n * 1000 : n;
    return ml > 0 && ml <= 5000 ? { ml: Math.round(ml) } : null;
  }
  return null;
}

// ---------- gym ----------

export type SetParse = { exercise: string; sets: number; reps: number; weight: number | null };

/**
 * "bench 3x8 @60", "squat 80x5", "bench 60kg x 8", "3x10 pullups", "deadlift 100 kg 5 reps".
 * NxM without @: a first number above 20 is a weight (80x5 = 80 kg for 5), else sets x reps.
 */
export function parseSet(text: string): SetParse | null {
  const t = squash(stripPrefix(text).rest);
  let sets = 1;
  let reps: number | null = null;
  let weight: number | null = null;
  let rest = t;

  const cut = (m: RegExpExecArray) => {
    rest = squash(rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length));
  };

  // "@60" or "@ 60kg"
  const at = new RegExp(String.raw`@\s*(${NUM})\s*(?:kgs?)?`, 'i').exec(rest);
  if (at) {
    weight = toNum(at[1]);
    cut(at);
  }
  // "60kg x 8" / "60 kg x8"
  const kgx = new RegExp(String.raw`(${NUM})\s*kgs?\s*[x×*]\s*(\d+)`, 'i').exec(rest);
  if (kgx) {
    weight = toNum(kgx[1]);
    reps = Number(kgx[2]);
    cut(kgx);
  }
  // "3x8x60" / "3x8" / "80x5"
  if (reps === null) {
    const nx = new RegExp(String.raw`(${NUM})\s*[x×*]\s*(\d+)(?:\s*[x×*]\s*(${NUM}))?`, 'i').exec(rest);
    if (nx) {
      const a = toNum(nx[1]);
      const b = Number(nx[2]);
      if (nx[3] !== undefined) {
        sets = a;
        reps = b;
        weight = toNum(nx[3]);
      } else if (weight === null && a > 20) {
        weight = a;
        reps = b;
      } else {
        sets = a;
        reps = b;
      }
      cut(nx);
    }
  }
  // "5 reps", "100 kg"
  if (reps === null) {
    const r = /(\d+)\s*reps?\b/i.exec(rest);
    if (r) {
      reps = Number(r[1]);
      cut(r);
    }
  }
  if (weight === null) {
    const w = new RegExp(String.raw`(${NUM})\s*kgs?\b`, 'i').exec(rest);
    if (w) {
      weight = toNum(w[1]);
      cut(w);
    }
  }
  if (reps === null || !Number.isInteger(sets) || sets < 1 || sets > 10 || reps < 1 || reps > 100) return null;
  const exercise = squash(rest.replace(/\b(?:sets?|of)\b/gi, ''));
  return { exercise, sets, reps, weight };
}

// ---------- food ----------

export type FoodParse = { name: string; grams: number | null; qty: number | null; kcal: number | null };

/** "200g chicken", "chicken 200 g", "2 eggs", "pizza 800kcal", "half a baguette". */
export function parseFood(text: string): FoodParse {
  let t = squash(stripPrefix(text).rest);
  let grams: number | null = null;
  let qty: number | null = null;
  let kcal: number | null = null;
  const k = new RegExp(String.raw`(${NUM})\s*(?:kcal|cal|calories)\b`, 'i').exec(t);
  if (k) {
    kcal = toNum(k[1]);
    t = squash(t.slice(0, k.index) + ' ' + t.slice(k.index + k[0].length));
  }
  const g = new RegExp(String.raw`(${NUM})\s*(?:g|gr|grams?)\b`, 'i').exec(t);
  if (g) {
    grams = toNum(g[1]);
    t = squash(t.slice(0, g.index) + ' ' + t.slice(g.index + g[0].length));
  } else {
    const q = /^(\d+(?:[.,]\d+)?|half(?:\s+an?)?|an?)\s+(?=\D)/i.exec(t);
    if (q) {
      const w = q[1].toLowerCase();
      qty = w.startsWith('half') ? 0.5 : w === 'a' || w === 'an' ? 1 : toNum(w);
      t = t.slice(q[0].length);
    }
  }
  const name = squash(t.replace(/^(?:of\s+)/i, ''));
  return { name, grams, qty, kcal };
}

/** True when the text names a food the user has logged before. */
export function knownFood(text: string, foods: string[] = []): string | null {
  const name = parseFood(text).name.toLowerCase();
  if (!name) return null;
  const sing = name.replace(/(?:es|s)$/, '');
  for (const f of foods) {
    const fl = f.toLowerCase();
    if (fl === name || fl === sing || fl.replace(/(?:es|s)$/, '') === sing) return f;
  }
  return null;
}

// ---------- habit ----------

export function matchHabit(text: string, habits: string[] = []): string | null {
  const t = squash(stripPrefix(text).rest.toLowerCase()).replace(/[.!]+$/, '');
  if (!t) return null;
  for (const h of habits) if (h.toLowerCase() === t) return h;
  // "did reading" / "reading done"
  const bare = t.replace(/^(?:did|done)\s+/, '').replace(/\s+(?:done|✓)$/, '');
  for (const h of habits) if (h.toLowerCase() === bare) return h;
  return null;
}

// ---------- tasks ----------

export type TaskParse = { title: string; project: string | null; when: string | null; someday: boolean; minutes: number | null };

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Adds n days to a YYYY-MM-DD date (calendar math, no time zone involved). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
const dow = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * Preview parse of a task line. The server parses the same words when it saves; this
 * only shows the user where it will land. Knows: today, tonight, tomorrow, weekday names,
 * "next week", "weekend", "someday", "^Project", "#Project", "25m"/"1h".
 */
export function parseTask(text: string, today: string, projects: string[] = []): TaskParse {
  let t = ` ${squash(stripPrefix(text).rest)} `;
  let project: string | null = null;
  let when: string | null = null;
  let someday = false;
  let minutes: number | null = null;

  const pm = /\s[\^#]([\p{L}\p{N}_-]+)(?=\s)/u.exec(t);
  if (pm) {
    const want = pm[1].toLowerCase();
    project = projects.find((p) => p.toLowerCase() === want) ?? projects.find((p) => p.toLowerCase().startsWith(want)) ?? pm[1];
    t = t.slice(0, pm.index) + ' ' + t.slice(pm.index + pm[0].length);
  }
  const mm = /\s(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours?)(?=\s)/i.exec(t);
  if (mm) {
    const n = Number(mm[1]);
    minutes = /^h/i.test(mm[2]) ? n * 60 : n;
    if (minutes > 0 && minutes <= 600) t = t.slice(0, mm.index) + ' ' + t.slice(mm.index + mm[0].length);
    else minutes = null;
  }
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(t);
    if (!m) return false;
    fn(m);
    t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
    return true;
  };
  take(/\s(someday|later|one day)(?=\s)/i, () => (someday = true)) ||
    take(/\s(today|tonight)(?=\s)/i, () => (when = today)) ||
    take(/\s(tomorrow|tmrw|tmr)(?=\s)/i, () => (when = addDays(today, 1))) ||
    take(/\snext week(?=\s)/i, () => {
      // Saturday starts the week here (DatesProvider firstDayOfWeek 6).
      const d = dow(today);
      when = addDays(today, ((6 - d + 7) % 7) || 7);
    }) ||
    take(/\s(?:this |on the )?weekend(?=\s)/i, () => {
      const d = dow(today);
      when = addDays(today, d === 6 ? 0 : (6 - d + 7) % 7);
    }) ||
    take(new RegExp(String.raw`\s(?:on |next )?(${WEEKDAYS.join('|')}|${WEEKDAYS.map((w) => w.slice(0, 3)).join('|')})(?=\s)`, 'i'), (m) => {
      const name = m[1].toLowerCase();
      const target = WEEKDAYS.findIndex((w) => w.startsWith(name.slice(0, 3)));
      const d = dow(today);
      when = addDays(today, ((target - d + 7) % 7) || 7);
    });
  return { title: squash(t), project, when, someday, minutes };
}

// ---------- detection ----------

const SET_SHAPE = /\d\s*(?:kgs?\s*)?[x×*]\s*\d|@\s*\d|\d\s*reps?\b/i;
const MONEY_WORD = /(^|\s)(\$|€|£|usd|eur|gbp|euros?|dollars?|pounds?)(\s|$)|^\s*[$€£]|\d\s*(usd|eur|gbp|\$|€|£)(?=\s|$)/i;

/**
 * Picks the type for a line in Auto. Order matters; the first rule that fits wins.
 * 1. An explicit prefix ("note: …"). 2. A remembered manual choice for this shape.
 * 3. "+500" income. 4. Body weight "72.4kg". 5. Water. 6. A set (NxN, @kg, reps) while
 * a workout runs, or with a weight. 7. A known habit name. 8. A known food.
 * 9. A count ("10 emails", "5 pages"): a note, routed. 10. A currency or a spend word: expense. 11. Everything else: task.
 */
export function detect(text: string, ctx: DetectCtx = {}): Detected {
  const raw = text.trim();
  if (!raw) return { type: 'task', why: 'empty', text: '' };

  const pre = stripPrefix(raw);
  if (pre.type) return { type: pre.type, why: 'prefix', text: pre.rest.trim() };

  const key = patternKey(raw);
  const remembered = ctx.overrides?.[key];
  if (remembered) return { type: remembered, why: 'remembered', text: raw };

  if (/^\+\s*[$€]?\s*\d/.test(raw) && parseMoney(raw)) return { type: 'income', why: 'plus sign', text: raw };
  if (parseWeight(raw)) return { type: 'weight', why: 'kg', text: raw };
  if (parseWater(raw)) return { type: 'water', why: 'water', text: raw };

  const set = SET_SHAPE.test(raw) ? parseSet(raw) : null;
  if (set && (ctx.activeWorkout || (set.weight !== null && set.exercise))) return { type: 'set', why: ctx.activeWorkout ? 'workout running' : 'sets x reps', text: raw };

  // "10 emails to the team in Leeds", "5 pages", "123400 km": counts, never money.
  const count = countRoute(raw);
  if (count && !MONEY_WORD.test(raw)) return { type: 'note', why: `count:${count.to}`, text: raw };

  if (matchHabit(raw, ctx.habits)) return { type: 'habit', why: 'habit name', text: raw };
  if (knownFood(raw, ctx.foods)) return { type: 'food', why: 'known food', text: raw };
  if (/\d\s*(?:kcal|cal)\b/i.test(raw)) return { type: 'food', why: 'kcal', text: raw };

  // Money only on a clear signal: a currency, or a spend word ("spent", "paid", "coffee", "taxi"…).
  if (MONEY_WORD.test(raw) && parseMoney(raw)) return { type: 'expense', why: 'currency', text: raw };
  if (SPEND_WORD.test(raw) && parseMoney(raw)?.note) return { type: 'expense', why: 'spend word', text: raw };

  return { type: 'task', why: 'default', text: raw };
}

// ---------- preview ----------

export type PreviewCtx = {
  today: string;
  projects?: string[];
  project?: string | null;
  defaultCurrency?: Currency;
  habits?: string[];
  /** Auto picked the type: counts ("10 emails", "5 pages", "123400 km") are routed, not kept as a plain note. */
  auto?: boolean;
};

const fmtAmt = (n: number, c: Currency | null) => {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (c === 'USD') return `$${v}`;
  if (c === 'EUR') return `€${v}`;
  if (c === 'GBP') return `£${v}`;
  return `$${v}`;
};
const fmtDay = (ymd: string, today: string) => {
  if (ymd === today) return 'today';
  if (ymd === addDays(today, 1)) return 'tomorrow';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** One plain line: what will be saved and where. null when there is nothing to save yet. */
export function preview(type: QuickType, text: string, c: PreviewCtx): string | null {
  const t = text.trim();
  if (!t) return null;
  const body = stripPrefix(t).rest.trim();
  switch (type) {
    case 'task': {
      const p = parseTask(body, c.today, c.projects);
      if (!p.title) return null;
      const where = c.project || p.project || 'Inbox';
      const bits = [`Task “${p.title}”`, `in ${where}`];
      if (p.someday) bits.push('someday');
      else if (p.when) bits.push(fmtDay(p.when, c.today));
      if (p.minutes) bits.push(`${p.minutes} min`);
      return bits.join(' · ');
    }
    case 'expense':
    case 'income': {
      const m = parseMoney(body);
      if (!m) return type === 'expense' ? 'Add an amount, like “500 coffee”.' : 'Add an amount, like “+1200 salary”.';
      const label = type === 'income' ? 'Income' : 'Expense';
      return `${label} ${fmtAmt(m.amount, m.currency ?? c.defaultCurrency ?? 'USD')}${m.note ? ` · ${m.note}` : ''}`;
    }
    case 'food': {
      const f = parseFood(body);
      if (!f.name) return 'Name the food, like “200g chicken”.';
      const amt = f.grams ? ` · ${f.grams} g` : f.qty && f.qty !== 1 ? ` · ×${f.qty}` : '';
      return `Food “${f.name}”${amt}${f.kcal ? ` · ${f.kcal} kcal (estimate)` : ''}`;
    }
    case 'water': {
      const w = parseWater(body) ?? (/^\d+$/.test(body) ? { ml: Number(body) } : null);
      return w ? `Water +${w.ml} ml` : 'Add an amount, like “500ml”.';
    }
    case 'set': {
      const s = parseSet(body);
      if (!s) return 'Write it like “bench 3x8 @60”.';
      const w = s.weight !== null ? ` @ ${s.weight} kg` : '';
      return `${s.sets > 1 ? `${s.sets} sets of ` : 'Set '}${s.reps} reps${w}${s.exercise ? ` · ${s.exercise}` : ' · current exercise'}`;
    }
    case 'weight': {
      const w = parseWeight(body) ?? (/^\d+(?:[.,]\d+)?$/.test(body) ? { kg: toNum(body) } : null);
      return w ? `Weight ${w.kg} kg` : 'Write it like “72.4kg”.';
    }
    case 'note': {
      const r = c.auto ? countRoute(body) : null;
      if (r?.to === 'car_km') return `Car odometer · ${r.km} km`;
      if (r?.to === 'done') return `Done log · ${body.length > 60 ? body.slice(0, 57) + '…' : body}`;
      return `Note in today's log · ${body.length > 60 ? body.slice(0, 57) + '…' : body}`;
    }
    case 'idea':
      return `Idea “${body.length > 60 ? body.slice(0, 57) + '…' : body}” · someday`;
    case 'habit': {
      const h = matchHabit(body, c.habits);
      return h ? `Check “${h}” for today` : 'Pick a habit below.';
    }
  }
}
