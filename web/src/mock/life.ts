// Mock /api/v2 people, habitat and small life helpers (shapes from src/life.ts).
import type {
  Capsule,
  Experiment,
  HabitatToday,
  Helped,
  LastDone,
  Lent,
  Occasion,
  PersonDue,
  Promise_,
  Removed,
  SwapOption,
  WaitingDue,
  WeekFacts,
} from '../life';
import { records, removedMoney, restoreMoney } from './money';
import { foodEntriesOn, workoutsBetween } from './health';
import { doneTasksBetween, focusLog, habitChecksOn, listTasks, tasks } from './tasks';
import { addDays, at, bad, created, fail, daysBetween, dow, idOf, iso, match, notFound, num, ok, round, str, today, uid, weekStart, type Ctx, type Res } from './util';

// ---------- promises ----------

type PromiseRow = { id: string; who: string; what: string; due: string | null; status: Promise_['status']; kept_day: string | null };
const promises: PromiseRow[] = [
  { id: 'pr_1', who: 'Mom', what: 'Drive her to the clinic appointment', due: addDays(today(), 2), status: 'open', kept_day: null },
  { id: 'pr_2', who: 'Yacine', what: 'Send him the portfolio link', due: addDays(today(), 0), status: 'open', kept_day: null },
  { id: 'pr_3', who: 'Little brother', what: 'Help with his maths homework', due: addDays(today(), 5), status: 'open', kept_day: null },
  { id: 'pr_4', who: 'Amine', what: 'Return the extension cable', due: null, status: 'open', kept_day: null },
  { id: 'pr_5', who: 'Uncle Karim', what: 'Fix the shop Facebook page', due: addDays(today(), -3), status: 'kept', kept_day: addDays(today(), -2) },
];
const promiseOut = (p: PromiseRow): Promise_ => {
  const days = p.due ? daysBetween(today(), p.due) : null;
  const when = days == null ? 'no date' : days < 0 ? `${-days} day${days === -1 ? '' : 's'} late` : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return { id: p.id, who: p.who, what: p.what, due: p.due, status: p.status, days_until: days, when };
};

// ---------- people, occasions ----------

const people: Omit<PersonDue, 'days_since'>[] = [
  { id: 'pp_1', name: 'Grandma', relation: 'family', last_contact: addDays(today(), -9), cadence_days: 7, note: 'Call in the afternoon, she naps before.', phone: '+213 555 00 11 22' },
  { id: 'pp_2', name: 'Yacine', relation: 'friend', last_contact: addDays(today(), -16), cadence_days: 14, note: '' },
  { id: 'pp_3', name: 'Uncle Karim', relation: 'family', last_contact: addDays(today(), -25), cadence_days: 21, note: 'Ask about the shop.' },
  { id: 'pp_4', name: 'Sofiane', relation: 'mentor', last_contact: addDays(today(), -40), cadence_days: 30, note: 'Share the new portfolio.' },
  { id: 'pp_5', name: 'Amine', relation: 'friend', last_contact: addDays(today(), -3), cadence_days: 14, note: '' },
];
const personOut = (p: Omit<PersonDue, 'days_since'>): PersonDue => ({ ...p, days_since: p.last_contact ? daysBetween(p.last_contact, today()) : null });
const occasions = (): Occasion[] => {
  const d = today();
  return [
    { id: 'oc_1', name: "Sister's birthday", kind: 'birthday', date: addDays(d, 9), days_until: 9, person_name: 'Sister', years: 19 },
    { id: 'oc_2', name: "Parents' anniversary", kind: 'anniversary', date: addDays(d, 23), days_until: 23, person_name: null, years: 30 },
    { id: 'oc_3', name: "Yacine's wedding", kind: 'event', date: addDays(d, 41), days_until: 41, person_name: 'Yacine', years: null },
  ];
};

// ---------- capsules ----------

const capsules: Required<Omit<Capsule, 'opened_at'>>[] & { opened_at: string | null }[] = [];
type CapsuleRow = { id: string; title: string; body: string; open_on: string; opened_at: string | null; written_day: string };
const capsuleRows: CapsuleRow[] = [
  { id: 'cp_1', title: 'A note from last month', body: 'If you are reading this, keep sending proposals. Steady work comes from steady asks.', open_on: today(), opened_at: null, written_day: addDays(today(), -30) },
  { id: 'cp_2', title: 'Savings check', body: 'Did the savings fund stay untouched? Good. Keep going.', open_on: addDays(today(), 45), opened_at: null, written_day: addDays(today(), -5) },
  { id: 'cp_3', title: 'Spring plan', body: 'Lighter blocks, more reading, no guilt.', open_on: addDays(today(), 80), opened_at: null, written_day: addDays(today(), -2) },
];
void capsules;
const capsuleOut = (c: CapsuleRow, withBody = false): Capsule =>
  withBody || c.opened_at ? { ...c } : { id: c.id, title: c.title, open_on: c.open_on, opened_at: c.opened_at, written_day: c.written_day };

// ---------- habitat helpers ----------

const lastDone: { id: string; name: string; last_day: string | null }[] = [
  { id: 'ld_1', name: 'Change bedsheets', last_day: addDays(today(), -12) },
  { id: 'ld_2', name: 'Haircut', last_day: addDays(today(), -24) },
  { id: 'ld_3', name: 'Clean laptop fan', last_day: addDays(today(), -70) },
  { id: 'ld_4', name: 'Backup phone photos', last_day: addDays(today(), -33) },
  { id: 'ld_5', name: 'Wash the bath mats', last_day: null },
];
const lastOut = (x: (typeof lastDone)[number]): LastDone => {
  const d = x.last_day ? daysBetween(x.last_day, today()) : null;
  return { ...x, days_since: d, line: d == null ? 'Never logged.' : d === 0 ? 'Today.' : `${d} day${d === 1 ? '' : 's'} ago.` };
};
const helped: { id: string; situation: string; thing: string; day: string }[] = [
  { id: 'hp_1', situation: 'Low energy after lunch', thing: '10-minute walk', day: addDays(today(), -3) },
  { id: 'hp_2', situation: 'Low energy after lunch', thing: '10-minute walk', day: addDays(today(), -8) },
  { id: 'hp_3', situation: "Can't start writing", thing: 'Timer 10 minutes, first line only', day: addDays(today(), -2) },
  { id: 'hp_4', situation: "Can't start writing", thing: 'Timer 10 minutes, first line only', day: addDays(today(), -6) },
  { id: 'hp_5', situation: "Can't start writing", thing: 'Timer 10 minutes, first line only', day: addDays(today(), -10) },
  { id: 'hp_6', situation: 'Phone scrolling at night', thing: 'Phone charging in the other room', day: addDays(today(), -4) },
];
const lent: Lent[] = [
  { id: 'ln_1', thing: 'Power bank', person: 'Amine', direction: 'lent', since: addDays(today(), -18), back_by: addDays(today(), 3) },
  { id: 'ln_2', thing: 'Book: Atomic Habits', person: 'Yacine', direction: 'lent', since: addDays(today(), -40), back_by: null },
  { id: 'ln_3', thing: 'Extension cable', person: 'Amine', direction: 'borrowed', since: addDays(today(), -6), back_by: null },
];
let experiment: (Omit<Experiment, 'day_n' | 'past_end' | 'line'> & { note?: string }) | null = {
  id: 'ex_1', name: 'Phone out of the bedroom', hypothesis: 'Sleep starts closer to 23:30 and Kickoff happens on time.',
  start_day: addDays(today(), -4), end_day: addDays(today(), 9), status: 'active', length_days: 14,
};
const experimentOut = (): Experiment | null => {
  if (!experiment || experiment.status !== 'active') return null;
  const day_n = daysBetween(experiment.start_day, today()) + 1;
  const past_end = today() > experiment.end_day;
  return { ...experiment, day_n, past_end, line: past_end ? 'Past the end day. Write one line on what changed.' : `Day ${day_n} of ${experiment.length_days}.` };
};
function habitat(): HabitatToday {
  const d = today();
  const freeUsd = 20;
  return {
    day: d, rest_day: dow(d) === 6,
    usual_buys: [
      { name: 'Bread', line: 'Daily', days_until: 0 },
      { name: 'Eggs (30)', line: 'About every 6 days', days_until: 1 },
      { name: 'Milk', line: 'About every 3 days', days_until: 2 },
      { name: 'Coffee', line: 'About every 12 days', days_until: 5 },
    ],
    last_done_count: lastDone.filter((x) => x.last_day && daysBetween(x.last_day, d) > 20).length,
    experiment: experimentOut(),
    lent_open: { count: lent.length, lent: lent.filter((l) => l.direction === 'lent').length, borrowed: lent.filter((l) => l.direction === 'borrowed').length },
    free_to_spend: { free: freeUsd, estimate: true, currency: 'USD', line: `About $${freeUsd} free today after the savings fund and cash floor.` },
  };
}

// ---------- removed ----------

function removed(): Removed[] {
  const out: Removed[] = [];
  for (const t of tasks) if (t.deleted_at) out.push({ table: 'tasks', id: t.id, label: t.title, deleted_at: t.deleted_at });
  for (const r of removedMoney) out.push({ table: 'money_records', id: r.row.id, label: `${r.row.amount} ${r.row.currency} ${r.row.note || r.row.category_name || ''}`.trim(), deleted_at: r.at });
  return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)).slice(0, 50);
}

// ---------- week facts ----------

export function weekFacts(week?: string | null): WeekFacts {
  const ws = weekStart(week || today());
  const we = addDays(ws, 6);
  let habit_checks = 0;
  let food_days_logged = 0;
  for (let d = ws; d <= we; d = addDays(d, 1)) {
    habit_checks += habitChecksOn(d);
    if (foodEntriesOn(d) > 0) food_days_logged++;
  }
  const inWeek = (day: string) => day >= ws && day <= we;
  const expenses = records.filter((r) => r.kind === 'expense' && inWeek(r.day));
  return {
    week_start: ws, week_end: we,
    tasks_done: doneTasksBetween(ws, we).length,
    focus_minutes: focusLog.filter((f) => inWeek(f.day)).reduce((s, f) => s + f.minutes, 0),
    habit_checks,
    gym_workouts: workoutsBetween(ws, we),
    expenses: expenses.length,
    spend_personal_usd: round(expenses.filter((r) => r.track === 'personal').reduce((s, r) => s + (r.usd ?? 0), 0), 2),
    food_days_logged,
    promises_kept: promises.filter((p) => p.status === 'kept' && p.kept_day && inWeek(p.kept_day)).length,
  };
}

// ---------- swap ----------

const LAYOUT: { name: string; start: string; end: string; must: boolean }[] = [
  { name: '🗂️ Admin', start: '11:30', end: '12:20', must: false },
  { name: '🛠️ Project work', start: '13:10', end: '14:00', must: true },
  { name: '🧠 Deep work', start: '15:30', end: '16:20', must: true },
  { name: '📞 Meetings', start: '16:30', end: '17:20', must: true },
  { name: '📚 Learning', start: '20:50', end: '21:25', must: false },
  { name: '🧹 Buffer', start: '21:30', end: '22:20', must: false },
];

export const promisesOpen = () => promises.filter((p) => p.status === 'open').length;

// ---------- router ----------

export function handleLife(c: Ctx): Res | null {
  const { route, qp, b } = c;
  let m: string[] | null;

  if (route === 'GET /habitat/today') return ok(habitat());

  // promises
  if (route === 'GET /promises/soon') {
    return ok(promises.filter((p) => p.status === 'open').sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')).map(promiseOut));
  }
  if (route === 'POST /promises') {
    const who = str(b.who).trim();
    const what = str(b.what).trim();
    if (!who || !what) return bad('Who and what are required.');
    const p: PromiseRow = { id: idOf(b, 'pr'), who, what, due: str(b.due) || null, status: 'open', kept_day: null };
    promises.push(p);
    return created(promiseOut(p));
  }
  if ((m = match(route, /^POST \/promises\/([^/]+)\/(keep|release)$/))) {
    const p = promises.find((x) => x.id === m![0]);
    if (!p) return notFound('Promise');
    p.status = m[1] === 'keep' ? 'kept' : 'released';
    p.kept_day = m[1] === 'keep' ? today() : null;
    return ok(promiseOut(p));
  }

  // people
  if (route === 'GET /people/due') {
    return ok(people.map(personOut).filter((p) => p.days_since == null || p.days_since >= p.cadence_days).sort((a, b) => (b.days_since ?? 999) - b.cadence_days - ((a.days_since ?? 999) - a.cadence_days)));
  }
  if ((m = match(route, /^POST \/people\/([^/]+)\/touch$/))) {
    const ref = m[0]!.toLowerCase();
    const p = people.find((x) => x.id === m![0] || x.name.toLowerCase() === ref);
    if (!p) return notFound('Person');
    p.last_contact = today();
    if (str(b.note).trim()) p.note = str(b.note).trim();
    return ok(personOut(p));
  }
  if (route === 'GET /occasions/soon') return ok(occasions());
  if (route === 'GET /waiting/due') {
    const list: WaitingDue[] = listTasks('waiting').map((t) => ({ id: t.id, title: t.title, waiting_for: t.waiting_for, check_on: t.due_date ?? today() }));
    return ok(list.filter((w) => (w.check_on ?? today()) <= today()));
  }

  // capsules
  if (route === 'GET /capsules/due') return ok(capsuleRows.filter((x) => !x.opened_at && x.open_on <= today()).map((x) => capsuleOut(x)));
  if (route === 'GET /capsules') return ok([...capsuleRows].sort((a, b) => a.open_on.localeCompare(b.open_on)).map((x) => capsuleOut(x)));
  if (route === 'POST /capsules') {
    const body = str(b.body).trim();
    if (!body) return bad('Write something first.');
    const days = Math.max(1, num(b.in_days, 30));
    const row: CapsuleRow = { id: idOf(b, 'cp'), title: str(b.title).trim() || `Letter from ${today()}`, body, open_on: addDays(today(), days), opened_at: null, written_day: today() };
    capsuleRows.push(row);
    return created(capsuleOut(row));
  }
  if ((m = match(route, /^POST \/capsules\/([^/]+)\/open$/))) {
    const row = capsuleRows.find((x) => x.id === m![0]);
    if (!row) return notFound('Capsule');
    if (row.open_on > today()) return { status: 409, body: { error: 'not_yet', message: `Opens on ${row.open_on}.` } };
    row.opened_at ??= iso();
    return ok(capsuleOut(row, true));
  }
  if (route === 'GET /week-facts') return ok(weekFacts(qp.get('week')));

  if (route === 'GET /experiments') {
    const all = experiment ? [{ ...experiment, day_n: daysBetween(experiment.start_day, today()) + 1, past_end: today() > experiment.end_day, line: experimentOut()?.line ?? null, outcome_note: experiment.note ?? null }] : [];
    return ok({ running: all.find((e) => e.status === 'active') ?? null, all });
  }
  // removed, last done, helped, lent
  if (route === 'GET /removed') return ok(removed());
  if ((m = match(route, /^POST \/removed\/([^/]+)\/([^/]+)\/restore$/))) {
    const [table, id] = m as [string, string];
    if (table === 'tasks') {
      const t = tasks.find((x) => x.id === id);
      if (!t || !t.deleted_at) return notFound('Removed item');
      t.deleted_at = null;
      return ok({ ok: true, table, id });
    }
    if (table === 'money_records' && restoreMoney(id)) return ok({ ok: true, table, id });
    return notFound('Removed item');
  }
  if (route === 'GET /last-done') {
    return ok(lastDone.map(lastOut).sort((a, b) => (b.days_since ?? 1e9) - (a.days_since ?? 1e9)));
  }
  if (route === 'POST /last-done/stamp') {
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    let x = lastDone.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (!x) {
      x = { id: uid('ld'), name, last_day: null };
      lastDone.push(x);
    }
    x.last_day = today();
    return ok(lastOut(x));
  }
  if (route === 'GET /helped/top') {
    const counts = new Map<string, number>();
    for (const h of helped) counts.set(h.thing, (counts.get(h.thing) ?? 0) + 1);
    const top: Helped[] = [...counts].map(([thing, times]) => ({ thing, times })).sort((a, b) => b.times - a.times).slice(0, 5);
    return ok(top);
  }
  if (route === 'POST /helped') {
    const thing = str(b.thing).trim();
    if (!thing) return bad('What helped?');
    const h = { id: idOf(b, 'hp'), situation: str(b.situation).trim(), thing, day: today() };
    helped.push(h);
    return created(h);
  }
  if ((m = match(route, /^DELETE \/helped\/([^/]+)$/))) {
    const ref = m[0]!;
    const before = helped.length;
    for (let i = helped.length - 1; i >= 0; i--) if (helped[i]!.id === ref || helped[i]!.thing === ref) helped.splice(i, 1);
    if (helped.length === before) return notFound('Entry');
    return ok({ ok: true, removed: before - helped.length });
  }
  if (route === 'GET /lent') return ok(lent);
  if ((m = match(route, /^POST \/lent\/([^/]+)\/return$/))) {
    const i = lent.findIndex((l) => l.id === m![0]);
    if (i < 0) return notFound('Item');
    const [l] = lent.splice(i, 1);
    return ok(l);
  }

  // blocks + experiments
  if (route === 'GET /blocks/swap') {
    const block = (qp.get('block') ?? '').toLowerCase();
    const opts: SwapOption[] = LAYOUT.filter((x) => !block || !x.name.toLowerCase().includes(block)).map((x) => ({
      name: x.name, title: x.name, start: at(today(), x.start), end: at(today(), x.end), must: x.must,
    }));
    return ok(opts);
  }
  if ((m = match(route, /^POST \/experiments\/([^/]+)\/end$/))) {
    if (!experiment || experiment.id !== m[0]) return notFound('Experiment');
    experiment = { ...experiment, status: 'ended', end_day: today(), note: str(b.note) };
    return ok({ ok: true, id: experiment.id, status: 'ended' });
  }

  return handleLifeMore(c);
}

/** Inputs for the mock week grades. */
export const promisesKeptBetween = (from: string, to: string) => promises.filter((p) => p.status === 'kept' && p.kept_day && p.kept_day >= from && p.kept_day <= to).length;
export const peopleTouchedBetween = (from: string, to: string) => people.filter((p) => p.last_contact && p.last_contact >= from && p.last_contact <= to).length;
export const lastDoneBetween = (from: string, to: string) => lastDone.filter((x) => x.last_day && x.last_day >= from && x.last_day <= to).length;

// ---------- management screens (people, promises, occasions, waiting) ----------

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const RELATIONS = ['family', 'friend', 'other'] as const;
const relationOf = (v: unknown) => ((RELATIONS as readonly string[]).includes(str(v)) ? (str(v) as (typeof RELATIONS)[number]) : 'other');

const contacts = new Map<string, { id: string; day: string; note: string }[]>([
  ['pp_1', [{ id: 'ct_1', day: addDays(today(), -9), note: 'Called in the afternoon.' }]],
  ['pp_2', [{ id: 'ct_2', day: addDays(today(), -16), note: '' }]],
]);
const birthdays = new Map<string, string | null>([['pp_1', '1948-03-14']]);
const personRow = (p: (typeof people)[number]) => ({
  id: p.id, name: p.name, relation: relationOf(p.relation), birthday: birthdays.get(p.id) ?? null,
  last_contact: p.last_contact, cadence_days: p.cadence_days, note: p.note ?? '', phone: p.phone,
});
const promiseRow = (p: PromiseRow) => ({
  id: p.id, who: p.who, what: p.what, due: p.due, status: p.status, closed_day: p.kept_day, created_at: iso(Date.now() - 7 * 86400000),
});

type OccasionRow = { id: string; name: string; kind: string; md: string; year: number | null; person_id: string | null; lead_days: number; note: string | null };
const occasionRows: OccasionRow[] = [];
let occasionsSeeded = false;
function seedOccasions() {
  if (occasionsSeeded) return;
  occasionsSeeded = true;
  for (const o of occasions()) {
    const y = o.years != null ? Number(o.date.slice(0, 4)) - o.years : null;
    occasionRows.push({ id: o.id, name: o.name, kind: o.kind, md: o.date.slice(5), year: y, person_id: null, lead_days: 7, note: o.note ?? null });
  }
}

const lentNotes = new Map<string, string | null>();
const lentRow = (l: Lent) => ({ ...l, returned_at: null, note: lentNotes.get(l.id) ?? null });

const lastNotes = new Map<string, string | null>();
const lastDoneX = (x: (typeof lastDone)[number]) => ({ ...lastOut(x), note: lastNotes.get(x.id) ?? null, last_at: x.last_day ? at(x.last_day, '12:00') : null });

function handleLifeMore(c: Ctx): Res | null {
  const { route, qp, b } = c;
  let m: string[] | null;

  // people
  if (route === 'GET /people') {
    const rel = qp.get('relation');
    return ok(people.map(personRow).filter((p) => !rel || p.relation === rel).sort((x, y) => x.name.localeCompare(y.name)));
  }
  if (route === 'POST /people') {
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    const cadence = b.cadence_days == null ? 14 : num(b.cadence_days, NaN);
    if (!Number.isFinite(cadence) || cadence < 1) return bad('cadence_days must be a number from 1.');
    if (b.birthday != null && b.birthday !== '' && !isDay(b.birthday)) return bad('birthday must be YYYY-MM-DD.');
    const p = { id: idOf(b, 'pp'), name, relation: relationOf(b.relation), last_contact: null as string | null, cadence_days: Math.round(cadence), note: str(b.note), phone: str(b.phone) || undefined };
    people.push(p);
    birthdays.set(p.id, (b.birthday as string) || null);
    return created(personRow(p));
  }
  if ((m = match(route, /^PATCH \/people\/([^/]+)$/))) {
    const p = people.find((x) => x.id === m![0]);
    if (!p) return notFound('Person');
    if (b.name !== undefined && !str(b.name).trim()) return bad('Name cannot be empty.');
    if (b.cadence_days !== undefined && !(num(b.cadence_days, NaN) >= 1)) return bad('cadence_days must be a number from 1.');
    if (b.birthday != null && b.birthday !== '' && !isDay(b.birthday)) return bad('birthday must be YYYY-MM-DD.');
    if (b.name !== undefined) p.name = str(b.name).trim();
    if (b.relation !== undefined) p.relation = relationOf(b.relation);
    if (b.cadence_days !== undefined) p.cadence_days = Math.round(num(b.cadence_days));
    if (b.note !== undefined) p.note = str(b.note);
    if (b.phone !== undefined) p.phone = str(b.phone) || undefined;
    if (b.birthday !== undefined) birthdays.set(p.id, (b.birthday as string) || null);
    return ok(personRow(p));
  }
  if ((m = match(route, /^DELETE \/people\/([^/]+)$/))) {
    const i = people.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Person');
    people.splice(i, 1);
    return ok({ id: m[0], deleted: true });
  }
  if ((m = match(route, /^GET \/people\/([^/]+)\/contacts$/))) {
    const p = people.find((x) => x.id === m![0]);
    if (!p) return notFound('Person');
    const list = contacts.get(p.id) ?? (p.last_contact ? [{ id: `ct_${p.id}`, day: p.last_contact, note: '' }] : []);
    return ok([...list].sort((x, y) => y.day.localeCompare(x.day)));
  }

  // promises
  if (route === 'GET /promises') {
    const status = qp.get('status');
    return ok(promises.filter((p) => !status || p.status === status).map(promiseRow));
  }
  if ((m = match(route, /^PATCH \/promises\/([^/]+)$/))) {
    const p = promises.find((x) => x.id === m![0]);
    if (!p) return notFound('Promise');
    if (b.who !== undefined && !str(b.who).trim()) return bad('Who cannot be empty.');
    if (b.what !== undefined && !str(b.what).trim()) return bad('What cannot be empty.');
    if (b.due != null && b.due !== '' && !isDay(b.due)) return bad('due must be YYYY-MM-DD or empty.');
    if (b.who !== undefined) p.who = str(b.who).trim();
    if (b.what !== undefined) p.what = str(b.what).trim();
    if (b.due !== undefined) p.due = (b.due as string) || null;
    return ok(promiseRow(p));
  }
  if ((m = match(route, /^POST \/promises\/([^/]+)\/reopen$/))) {
    const p = promises.find((x) => x.id === m![0]);
    if (!p) return notFound('Promise');
    p.status = 'open';
    p.kept_day = null;
    return ok(promiseRow(p));
  }
  if ((m = match(route, /^DELETE \/promises\/([^/]+)$/))) {
    const i = promises.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Promise');
    promises.splice(i, 1);
    return ok({ id: m[0], deleted: true });
  }

  // occasions
  if (route === 'GET /occasions') {
    seedOccasions();
    return ok([...occasionRows].sort((x, y) => x.md.localeCompare(y.md)));
  }
  if (route === 'POST /occasions') {
    seedOccasions();
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    const md = str(b.md) || (isDay(b.date) ? b.date.slice(5) : '');
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(md)) return bad('md must be MM-DD.');
    const year = b.year == null || b.year === '' ? null : num(b.year, NaN);
    if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) return bad('year must be a 4-digit year.');
    const lead = b.lead_days == null ? 7 : num(b.lead_days, NaN);
    if (!Number.isFinite(lead) || lead < 0) return bad('lead_days must be 0 or more.');
    const row: OccasionRow = { id: idOf(b, 'oc'), name, kind: str(b.kind, 'event'), md, year, person_id: str(b.person_id) || null, lead_days: Math.round(lead), note: str(b.note) || null };
    occasionRows.push(row);
    return created(row);
  }
  if ((m = match(route, /^DELETE \/occasions\/([^/]+)$/))) {
    seedOccasions();
    const i = occasionRows.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Occasion');
    occasionRows.splice(i, 1);
    return ok({ id: m[0], deleted: true });
  }

  // waiting
  if (route === 'GET /waiting') {
    return ok(listTasks('waiting').map((t) => ({ task_id: t.id, title: t.title, waiting_for: t.waiting_for, check_on: t.due_date ?? null, auto: !t.due_date, note: null })));
  }
  if ((m = match(route, /^PUT \/waiting\/([^/]+)\/check-on$/))) {
    const t = tasks.find((x) => x.id === m![0] && !!x.waiting_for);
    if (!t) return notFound('Waiting item');
    let day: string;
    if (b.day != null && b.day !== '') {
      if (!isDay(b.day)) return bad('day must be YYYY-MM-DD.');
      day = b.day;
    } else if (b.in_days != null) {
      const n = num(b.in_days, NaN);
      if (!Number.isFinite(n) || n < 0) return bad('in_days must be 0 or more.');
      day = addDays(today(), Math.round(n));
    } else return bad('Send day or in_days.');
    t.due_date = day;
    return ok({ task_id: t.id, title: t.title, waiting_for: t.waiting_for, check_on: day, auto: false, note: null });
  }

  // capsules, lent, helped
  if ((m = match(route, /^DELETE \/capsules\/([^/]+)$/))) {
    const i = capsuleRows.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Capsule');
    capsuleRows.splice(i, 1);
    return ok({ id: m[0], deleted: true });
  }
  if (route === 'POST /lent') {
    const thing = str(b.thing).trim();
    const person = str(b.person).trim();
    if (!thing) return bad('What is it?');
    if (!person) return bad('Who has it?');
    if (b.back_by != null && b.back_by !== '' && !isDay(b.back_by)) return bad('back_by must be YYYY-MM-DD.');
    const row: Lent = { id: idOf(b, 'ln'), thing, person, direction: b.direction === 'borrowed' ? 'borrowed' : 'lent', since: isDay(b.since) ? b.since : today(), back_by: (b.back_by as string) || null };
    lent.push(row);
    lentNotes.set(row.id, str(b.note) || null);
    return created(lentRow(row));
  }
  if ((m = match(route, /^DELETE \/lent\/([^/]+)$/))) {
    const i = lent.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Item');
    lent.splice(i, 1);
    return ok({ id: m[0], deleted: true });
  }
  if (route === 'GET /helped') {
    const q = (qp.get('q') ?? '').toLowerCase();
    return ok(
      helped
        .filter((h) => !q || h.situation.toLowerCase().includes(q) || h.thing.toLowerCase().includes(q))
        .sort((x, y) => y.day.localeCompare(x.day))
        .map((h) => ({ id: h.id, situation: h.situation, thing: h.thing, note: null, created_at: at(h.day, '12:00') })),
    );
  }

  // last done + experiments
  if (route === 'POST /last-done') {
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    if (lastDone.some((x) => x.name.toLowerCase() === name.toLowerCase())) return bad(`"${name}" is already on the list.`);
    const row = { id: idOf(b, 'ld'), name, last_day: null as string | null };
    lastDone.push(row);
    lastNotes.set(row.id, str(b.note) || null);
    return created(lastDoneX(row));
  }
  if ((m = match(route, /^(PATCH|DELETE) \/last-done\/([^/]+)$/))) {
    const i = lastDone.findIndex((x) => x.id === m![1]);
    if (i < 0) return notFound('Item');
    if (m[0] === 'DELETE') {
      lastDone.splice(i, 1);
      return ok({ id: m[1], deleted: true });
    }
    const row = lastDone[i]!;
    if (b.name !== undefined && !str(b.name).trim()) return bad('Name cannot be empty.');
    if (b.name !== undefined) row.name = str(b.name).trim();
    if (b.note !== undefined) lastNotes.set(row.id, str(b.note) || null);
    return ok(lastDoneX(row));
  }
  if (route === 'POST /experiments') {
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    const days = b.days == null ? 14 : num(b.days, NaN);
    if (!Number.isInteger(days) || days < 3 || days > 90) return bad('days must be a whole number from 3 to 90.');
    if (experiment && experiment.status === 'active') return fail(409, 'conflict', 'One experiment at a time. End the current one first.');
    experiment = { id: idOf(b, 'ex'), name, hypothesis: str(b.hypothesis), start_day: today(), end_day: addDays(today(), days - 1), status: 'active', length_days: days };
    const out = experimentOut();
    return created({ ...out, line: out?.line ?? null, outcome_note: null, ended_at: null });
  }

  return null;
}
