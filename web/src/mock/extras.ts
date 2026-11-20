// Mock /api/v2 extras: anchors, timer guard, done list, rescue, bad day, close day, days away,
// documents, cards, brain dump, weather, screen time and brain search.
import type {
  Anchor,
  BrainHit,
  Card,
  CardDraft,
  CloseDay,
  DaysAway,
  Doc,
  DoneCounts,
  DoneList,
  DumpItem,
  DumpResult,
  Rescue,
  ScreenDevice,
  ScreenGlance,
  ScreenSummary,
  TimerGuard,
  Weather,
} from '../v2';
import { handleMoney, records } from './money';
import { foodEntriesOn, foodSearchHits, setsOn, waterOn, workoutsOn } from './health';
import { doneTasksBetween, focusLog, habitChecksOn, handleTasks, listTasks } from './tasks';
import { addDays, at, bad, created, daysBetween, idOf, iso, match, notFound, num, ok, str, today, uid, type Ctx, type Res } from './util';

// ---------- anchors ----------

/** Fixed daily anchors (meals and sleep) the timer guard and Today header look ahead to. */
const ANCHORS: { key: string; name: string; hhmm: string }[] = [
  { key: 'breakfast', name: 'Breakfast', hhmm: '07:30' },
  { key: 'lunch', name: 'Lunch', hhmm: '13:00' },
  { key: 'dinner', name: 'Dinner', hhmm: '19:30' },
  { key: 'sleep', name: 'Sleep', hhmm: '23:30' },
];
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const nowLocalMin = () => {
  const d = new Date(Date.now() + 3600000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
export function nextAnchor(): Anchor | null {
  const d = today();
  const now = nowLocalMin();
  for (const a of ANCHORS) {
    const m = toMin(a.hhmm);
    if (m > now) return { name: a.name, key: a.key, at: at(d, a.hhmm), hhmm: a.hhmm, in_minutes: m - now };
  }
  const first = ANCHORS[0];
  const tomorrow = addDays(d, 1);
  return { name: first.name, key: first.key, at: at(tomorrow, first.hhmm), hhmm: first.hhmm, in_minutes: 24 * 60 - now + toMin(first.hhmm) };
}

// ---------- done counts ----------

const cardReviews: { id: string; day: string }[] = [
  { id: 'seed', day: today() }, { id: 'seed', day: today() }, { id: 'seed', day: today() },
];

export function doneCounts(from: string, to: string): DoneCounts {
  const c: DoneCounts = { tasks: 0, focus_minutes: 0, focus_sessions: 0, sets: 0, workouts: 0, food_entries: 0, water_ml: 0, money_records: 0, habit_checks: 0, cards_reviewed: 0 };
  c.tasks = doneTasksBetween(from, to).length;
  for (const f of focusLog) if (f.day >= from && f.day <= to) { c.focus_minutes += f.minutes; c.focus_sessions++; }
  for (let d = from; d <= to; d = addDays(d, 1)) {
    c.sets += setsOn(d);
    c.workouts += workoutsOn(d);
    c.food_entries += foodEntriesOn(d);
    c.water_ml += waterOn(d);
    c.habit_checks += habitChecksOn(d);
  }
  c.money_records = records.filter((r) => r.day >= from && r.day <= to).length;
  c.cards_reviewed = cardReviews.filter((r) => r.day >= from && r.day <= to).length;
  return c;
}
const doneLines = (c: DoneCounts) => {
  const out: string[] = [];
  if (c.tasks) out.push(`${c.tasks} task${c.tasks === 1 ? '' : 's'} done`);
  if (c.focus_minutes) out.push(`${c.focus_minutes} min focused`);
  if (c.workouts) out.push('Gym session');
  if (c.food_entries) out.push(`${c.food_entries} food entries`);
  if (c.water_ml) out.push(`${(c.water_ml / 1000).toFixed(1)} L water`);
  if (c.habit_checks) out.push(`${c.habit_checks} habit checks`);
  if (c.cards_reviewed) out.push(`${c.cards_reviewed} cards`);
  return out;
};

// ---------- rescue, bad day, close day, days away ----------

export let rescueOn = false;
let rescueUntil: string | null = null;
let badDay = ['Pray on time', 'Eat one real meal', 'Drink 1.5 L of water', 'Walk 10 minutes', 'One 10-minute task, then stop'];
const closes: CloseDay[] = [];
(() => {
  const y = addDays(today(), -1);
  const counts = doneCounts(y, y);
  closes.push({
    day: y, closed_at: at(y, '22:40'), first_thing: 'Finish the recipe app home page', note: 'Good gym session.',
    counts, done: doneLines(counts), message: 'Day closed. Tomorrow starts with: Finish the recipe app home page.',
  });
})();
export const closedToday = () => closes.find((c) => c.day === today()) ?? null;
export const firstThing = () => closes.find((c) => c.day === addDays(today(), -1))?.first_thing ?? null;
export function daysAway(): DaysAway {
  return { days: 0, last_at: iso(Date.now() - 2 * 3600000), returning: false, message: null };
}

// ---------- documents ----------

const docs: Omit<Doc, 'days_left'>[] = [
  { id: 'doc_passport', name: 'Passport', expires_on: addDays(today(), 410), where_kept: 'Desk drawer, blue folder', note: 'Renewal takes about 4 weeks at the daira.' },
  { id: 'doc_id', name: 'National ID card', expires_on: addDays(today(), 1500), where_kept: 'Wallet', note: null },
  { id: 'doc_licence', name: 'Driving licence', expires_on: addDays(today(), 75), where_kept: 'Wallet', note: 'Renew before buying the car.' },
  { id: 'doc_llc', name: 'Business registration renewal', expires_on: addDays(today(), 38), where_kept: 'Drive > Business > Legal', note: 'Filed online. Fee in the money log when paid.' },
  { id: 'doc_ein', name: 'Tax ID certificate', expires_on: null, where_kept: 'Drive > Business > Legal', note: 'See password manager for portal access.' },
];
/** Same words and states as the API's documents register (60/30/7/0 days and once after; ended papers stay listed). */
const docLine = (name: string, n: number | null) =>
  n === null ? `${name}: no end date` : n > 1 ? `${name}: ends in ${n} days` : n === 1 ? `${name}: ends tomorrow`
    : n === 0 ? `${name}: ends today` : `${name}: ended ${-n} day${n === -1 ? '' : 's'} ago. Renew when you can.`;
const docOut = (d: Omit<Doc, 'days_left'>): Doc => {
  const n = d.expires_on ? daysBetween(today(), d.expires_on) : null;
  const renewed = /Renewed$/.test(d.note ?? '');
  return {
    ...d, tags: d.tags ?? [], car_id: d.car_id ?? null, days_left: n, renewed,
    state: renewed ? 'renewed' : n === null ? 'no_date' : n < 0 ? 'ended' : n <= 30 ? 'soon' : 'ok',
    line: renewed ? `${d.name}: renewed (old copy)` : docLine(d.name, n),
  };
};

// ---------- cards ----------

const cards: Card[] = [];
(() => {
  const d = today();
  const mk = (front: string, back: string, gender: Card['gender'], example: string | null, due: number, reps: number, state: string): Card => ({
    id: uid('cd'), front, back, deck: 'General', gender, example, due: addDays(d, due), stability: Math.max(0, reps * 2), difficulty: 5, reps, lapses: 0, state,
    interval_days: reps ? Math.max(1, reps * 2) : 0,
  });
  cards.push(
    mk('idempotent', 'same result when run twice', null, 'A PUT should be idempotent.', 0, 3, 'review'),
    mk('debounce', 'wait for a pause before acting', null, 'Debounce the search box by 300 ms.', -1, 2, 'review'),
    mk('backoff', 'wait longer after each retry', null, null, 0, 1, 'learning'),
    mk('latency', 'time before the first byte arrives', null, 'Latency doubled after the deploy.', 2, 4, 'review'),
    mk('cache hit', 'answer served from the cache', null, null, 5, 5, 'review'),
    mk('throttle', 'run at most once per interval', null, 'Throttle scroll events to 60 per second.', 0, 0, 'new'),
    mk('payload', 'the data a request carries', null, null, 0, 0, 'new'),
    mk('race condition', 'result depends on timing', null, 'Two saves at once caused a race condition.', 3, 3, 'review'),
  );
})();
const genderOf = (front: string): Card['gender'] => (/^(le|un)\s/i.test(front) ? 'm' : /^(la|une)\s/i.test(front) ? 'f' : null);
function draft(text: string): CardDraft {
  const [front = '', back = ''] = text.split(/\s*(?:=|—|–| - |:)\s*/, 2);
  const f = front.trim();
  return { front: f, back: back.trim(), gender: genderOf(f), deck: 'General', needs_back: !back.trim(), note: back.trim() ? undefined : 'Add the meaning, then save.' };
}

// ---------- brain dump ----------

function splitDump(text: string): DumpItem[] {
  return text
    .split(/\n|;/)
    .map((s) => s.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map((s): DumpItem => {
      if (/^(\+|\$)?\d+([.,]\d+)?\s*(usd|eur|\$)?\s+\S/i.test(s)) return { kind: 'expense', text: s };
      if (/^(note|idea|thought)[:\s]/i.test(s)) return { kind: 'note', text: s.replace(/^(note|idea|thought)[:\s]\s*/i, '') };
      return { kind: 'task', text: s };
    });
}
export const dumpNotes: { day: string; text: string }[] = [];

// ---------- screen time ----------

const devices: ScreenDevice[] = [
  { device: 'phone', kind: 'android', last_sync: iso(Date.now() - 40 * 60000) },
  { device: 'pc', kind: 'windows', last_sync: iso(Date.now() - 15 * 60000) },
];
const APPS: { app: string; kind: string; perDay: number; devices: string[] }[] = [
  { app: 'Chrome', kind: 'browser', perDay: 140, devices: ['pc', 'phone'] },
  { app: 'VS Code', kind: 'work', perDay: 95, devices: ['pc'] },
  { app: 'WhatsApp', kind: 'social', perDay: 45, devices: ['phone'] },
  { app: 'YouTube', kind: 'video', perDay: 40, devices: ['phone', 'pc'] },
  { app: 'Instagram', kind: 'social', perDay: 22, devices: ['phone'] },
  { app: 'Duolingo', kind: 'learning', perDay: 12, devices: ['phone'] },
  { app: 'Mosaic', kind: 'tools', perDay: 9, devices: ['phone', 'pc'] },
];
const dayFactor = (day: string) => 0.75 + ((daysBetween('2026-01-01', day) * 37) % 50) / 100;
function screenSummary(days: number, end: string, top: number): ScreenSummary {
  const from = addDays(end, -(days - 1));
  const live = new Set(devices.map((d) => d.device));
  const by_day: { day: string; minutes: number }[] = [];
  const appMin = new Map<string, number>();
  const devMin = new Map<string, number>();
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const part = d === today() ? 0.55 : 1;
    let total = 0;
    for (const a of APPS) {
      const ds = a.devices.filter((x) => live.has(x));
      if (!ds.length) continue;
      const min = Math.round(a.perDay * dayFactor(d) * part);
      total += min;
      appMin.set(a.app, (appMin.get(a.app) ?? 0) + min);
      ds.forEach((x) => devMin.set(x, (devMin.get(x) ?? 0) + Math.round(min / ds.length)));
    }
    by_day.push({ day: d, minutes: total });
  }
  const total_minutes = by_day.reduce((s, x) => s + x.minutes, 0);
  return {
    from, to: end, days, total_minutes, avg_minutes_per_day: Math.round(total_minutes / days),
    per_device: [...devMin].map(([device, minutes]) => ({ device, kind: devices.find((x) => x.device === device)?.kind ?? null, minutes })),
    top_apps: APPS.filter((a) => appMin.has(a.app))
      .map((a) => ({ app: a.app, kind: a.kind, minutes: appMin.get(a.app)!, devices: a.devices.filter((x) => live.has(x)) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, top),
    by_day,
    devices: [...devices],
    note: 'Counts foreground time from each device. Numbers only.',
  };
}
export function screenGlance(): ScreenGlance {
  const s = screenSummary(1, today(), 3);
  return { total_minutes: s.total_minutes, top_apps: s.top_apps.map((a) => ({ app: a.app, minutes: a.minutes })), devices: devices.length };
}

// ---------- brain search ----------

function brainSearch(s: string, limit: number) {
  const ql = s.toLowerCase();
  const results: Record<string, BrainHit[]> = {};
  const add = (k: string, h: BrainHit[]) => { if (h.length) results[k] = h.slice(0, limit); };
  add('tasks', listTasks('all').filter((t) => t.title.toLowerCase().includes(ql)).map((t) => ({ kind: 'task', id: t.id, title: t.title, day: t.due_date ?? undefined, status: t.status })));
  add('money', records.filter((r) => r.note.toLowerCase().includes(ql) || (r.category_name ?? '').toLowerCase().includes(ql))
    .map((r) => ({ kind: 'money', id: r.id, title: r.note || r.category_name || 'Record', day: r.day, amount: r.amount, currency: r.currency, income: r.kind === 'income' })));
  add('food', foodSearchHits(s).map((f) => ({ kind: 'food', id: f.id, title: f.name, kcal: f.kcal })));
  add('documents', docs.filter((d) => d.name.toLowerCase().includes(ql)).map((d) => ({ kind: 'document', id: d.id, title: d.name, snippet: d.where_kept ?? undefined })));
  add('cards', cards.filter((c) => c.front.toLowerCase().includes(ql) || c.back.toLowerCase().includes(ql)).map((c) => ({ kind: 'card', id: c.id, title: c.front, snippet: c.back })));
  const total = Object.values(results).reduce((n, x) => n + x.length, 0);
  return { q: s, results, total };
}

// ---------- router ----------

export function handleExtras(c: Ctx): Res | null {
  const { route, qp, b } = c;
  let m: string[] | null;

  if (route === 'GET /timer/guard') {
    const minutes = num(qp.get('minutes'), 50);
    const next = nextAnchor();
    let g: TimerGuard = { ok: true, minutes, next };
    if (next && next.in_minutes < minutes) {
      const suggest = Math.max(5, next.in_minutes - 5);
      g = { ok: false, minutes, suggest_minutes: suggest, next, message: `${next.name} in ${next.in_minutes} min. Run ${suggest} min instead.` };
    }
    return ok(g);
  }
  if (route === 'GET /done') {
    const from = qp.get('from') ?? today();
    const to = qp.get('to') ?? from;
    const list: DoneList = {
      from, to,
      tasks: doneTasksBetween(from, to).map((t) => ({ id: t.id, title: t.title, done_at: t.done_at!, tags: t.tags, project_name: t.project_name })),
      counts: doneCounts(from, to),
      note: 'What got done. Nothing here is a score.',
    };
    return ok(list);
  }
  if (route === 'POST /rescue') {
    rescueOn = true;
    rescueUntil = `${addDays(today(), 1)}T04:00:00Z`;
    const r: Rescue = {
      mode: 'Zero', push_silence_until: rescueUntil, ends_at: rescueUntil, after: 'Normal', titles_cleared: 0,
      menu: ['Drink a glass of water', 'Lie down 20 minutes', 'One 10-minute task', 'Step outside for 5 minutes'],
      next: null, message: "Zero mode until 04:00. One 10-minute thing from the menu is the whole day. Tonight's run plans tomorrow in Normal mode.",
    };
    return ok(r);
  }
  if (route === 'POST /rescue/end') { rescueOn = false; rescueUntil = null; return ok({ mode: 'Normal' }); }
  if (route === 'POST /rescue/keep') { rescueUntil = null; return ok({ mode: 'Zero', kept: true }); }
  if (route === 'GET /badday') return ok({ items: badDay });
  if (route === 'PUT /badday') {
    if (Array.isArray(b.items)) badDay = b.items.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 7);
    return ok({ items: badDay });
  }
  if (route === 'GET /close-day') return ok({ closed: closedToday(), tomorrow_first: closedToday()?.first_thing ?? null });
  if (route === 'POST /close-day') {
    const d = today();
    const counts = doneCounts(d, d);
    const first = str(b.first_thing).trim() || null;
    const cd: CloseDay = {
      day: d, closed_at: iso(), first_thing: first, note: str(b.note).trim() || null, counts, done: doneLines(counts),
      message: first ? `Day closed. Tomorrow starts with: ${first}.` : 'Day closed.',
    };
    const i = closes.findIndex((x) => x.day === d);
    if (i >= 0) closes[i] = cd;
    else closes.push(cd);
    return ok(cd);
  }
  if (route === 'GET /days-away') return ok(daysAway());

  // documents
  if (route === 'GET /documents') {
    const car = qp.get('car');
    const tag = qp.get('tag')?.toLowerCase();
    return ok(docs.map(docOut).filter((d) => (!car || d.car_id === car) && (!tag || (d.tags ?? []).includes(tag))).sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9)));
  }
  if (route === 'POST /documents') {
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    const id = idOf(b, 'doc');
    const dup = docs.find((d) => d.id === id);
    if (dup) return ok(docOut(dup));
    const d = { id, name, expires_on: (b.expires_on as string | null) ?? null, where_kept: (b.where_kept as string | null) ?? null, note: (b.note as string | null) ?? null };
    docs.push(d);
    return created(docOut(d));
  }
  if ((m = match(route, /^PATCH \/documents\/([^/]+)$/))) {
    const d = docs.find((x) => x.id === m![0]);
    if (!d) return notFound('Document');
    if (typeof b.name === 'string' && b.name.trim()) d.name = b.name.trim();
    if ('expires_on' in b) d.expires_on = (b.expires_on as string | null) || null;
    if ('where_kept' in b) d.where_kept = (b.where_kept as string | null) || null;
    if ('note' in b) d.note = (b.note as string | null) || null;
    return ok(docOut(d));
  }
  if ((m = match(route, /^DELETE \/documents\/([^/]+)$/))) {
    const i = docs.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Document');
    docs.splice(i, 1);
    return ok({ ok: true });
  }

  // cards
  if (route === 'GET /cards') {
    const deck = qp.get('deck');
    return ok(cards.filter((x) => !deck || x.deck === deck));
  }
  if (route === 'GET /cards/queue') {
    const due = cards.filter((x) => x.due <= today() && x.state !== 'new');
    const fresh = cards.filter((x) => x.state === 'new').slice(0, 5);
    return ok({ cards: [...due, ...fresh], due: due.length, new: fresh.length, total: cards.length });
  }
  if (route === 'POST /cards/draft') return ok(draft(str(b.text)));
  if (route === 'POST /cards') {
    const front = str(b.front).trim();
    const back = str(b.back).trim();
    if (!front || !back) return bad('Front and back are required.');
    const dup = cards.find((x) => x.front.toLowerCase() === front.toLowerCase());
    if (dup) return ok({ ...dup, duplicate: true });
    const card: Card = {
      id: idOf(b, 'cd'), front, back, deck: str(b.deck) || 'General',
      gender: b.gender === 'm' || b.gender === 'f' ? b.gender : genderOf(front),
      example: str(b.example) || null, due: today(), stability: 0, difficulty: 5, reps: 0, lapses: 0, state: 'new', interval_days: 0,
    };
    cards.push(card);
    return created(card);
  }
  if ((m = match(route, /^POST \/cards\/([^/]+)\/review$/))) {
    const card = cards.find((x) => x.id === m![0]);
    if (!card) return notFound('Card');
    const g = num(b.grade, 3);
    const prev = card.interval_days ?? 0;
    let interval: number;
    if (g <= 1) { interval = 0; card.lapses++; card.state = 'relearning'; }
    else { interval = Math.max(1, Math.round((prev || 1) * (g === 2 ? 1.2 : g === 3 ? 2.5 : 3.5))); card.state = 'review'; }
    card.reps++;
    card.interval_days = interval;
    card.stability = interval;
    card.difficulty = Math.min(10, Math.max(1, card.difficulty + (3 - g)));
    card.due = addDays(today(), interval);
    cardReviews.push({ id: card.id, day: today() });
    return ok(card);
  }
  if ((m = match(route, /^DELETE \/cards\/([^/]+)$/))) {
    const i = cards.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Card');
    cards.splice(i, 1);
    return ok({ ok: true });
  }

  // brain dump
  if (route === 'POST /brain-dump') return ok({ items: splitDump(str(b.text)) });
  if (route === 'POST /brain-dump/commit') {
    const items = Array.isArray(b.items) ? (b.items as DumpItem[]) : [];
    const r: DumpResult = { tasks: 0, expenses: 0, notes: 0, failed: [] };
    for (const it of items) {
      const text = str(it?.text).trim();
      if (!text) continue;
      if (it.kind === 'task') {
        const res = handleTasks({ method: 'POST', p: '/tasks', qp: new URLSearchParams(), b: { text }, route: 'POST /tasks' });
        if (res && res.status < 300) r.tasks++;
        else r.failed.push({ text, error: 'Could not add the task.' });
      } else if (it.kind === 'expense') {
        const res = handleMoney({ method: 'POST', p: '/money/records', qp: new URLSearchParams(), b: { text }, route: 'POST /money/records' });
        if (res && res.status < 300) r.expenses++;
        else r.failed.push({ text, error: 'Could not read an amount.' });
      } else {
        dumpNotes.push({ day: today(), text });
        r.notes++;
      }
    }
    return ok(r);
  }

  if (route === 'GET /weather') {
    const w: Weather = { place: 'London', temp_c: 12, text: 'Partly cloudy', max_c: 14, min_c: 7, rain_pct: 10, cached: true, stale: false };
    return ok(w);
  }
  if (route === 'GET /screentime') {
    const days = Math.max(1, num(qp.get('days'), 1));
    return ok(screenSummary(days, qp.get('day') ?? today(), num(qp.get('top'), 15)));
  }
  if ((m = match(route, /^DELETE \/screentime\/devices\/([^/]+)$/))) {
    const i = devices.findIndex((d) => d.device === m![0]);
    if (i < 0) return notFound('Device');
    devices.splice(i, 1);
    return ok({ device: m[0], removed_rows: 120 });
  }
  if (route === 'GET /brain/search') return ok(brainSearch(qp.get('q') ?? '', num(qp.get('limit'), 8)));

  return null;
}
