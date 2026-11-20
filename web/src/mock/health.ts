// Mock /api/v2 food, gym and body.
import type {
  BodySummary,
  Exercise,
  FoodDay,
  FoodEntry,
  FoodItem,
  GymSet,
  Macros,
  Metric,
  NextSet,
  Pr,
  Rest,
  Routine,
  Slot,
  TodayRoutine,
  Workout,
  WorkoutRow,
} from '../v2';
import type { CarryForward, Forecast } from '../life';
import { addDays, at, bad, created, idOf, iso, match, notFound, num, ok, optNum, round, str, today, uid, type Ctx, type Res } from './util';

// ---------- food ----------

const foods: FoodItem[] = [
  { id: 'f_egg', name: 'Egg (1 large)', brand: null, source: 'local', uses: 40, kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8 },
  { id: 'f_khobz', name: 'Khobz (100 g)', brand: null, source: 'local', uses: 35, kcal: 265, protein: 9, carbs: 51, fat: 3.2 },
  { id: 'f_msemen', name: 'Msemen (1 piece)', brand: null, source: 'local', uses: 8, kcal: 280, protein: 5, carbs: 35, fat: 13 },
  { id: 'f_chicken', name: 'Chicken breast, cooked (100 g)', brand: null, source: 'local', uses: 22, kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { id: 'f_rice', name: 'White rice, cooked (100 g)', brand: null, source: 'local', uses: 18, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { id: 'f_lentils', name: 'Lentil soup (bowl)', brand: null, source: 'local', uses: 9, kcal: 230, protein: 14, carbs: 34, fat: 4 },
  { id: 'f_couscous', name: 'Couscous with vegetables (plate)', brand: null, source: 'local', uses: 6, kcal: 520, protein: 18, carbs: 85, fat: 11 },
  { id: 'f_chorba', name: 'Chorba frik (bowl)', brand: null, source: 'local', uses: 4, kcal: 260, protein: 15, carbs: 28, fat: 9 },
  { id: 'f_dates', name: 'Dates, Deglet Nour (3)', brand: null, source: 'local', uses: 12, kcal: 70, protein: 0.6, carbs: 18, fat: 0.1 },
  { id: 'f_milk', name: 'Milk, whole (250 ml)', brand: null, source: 'local', uses: 15, kcal: 150, protein: 8, carbs: 12, fat: 8 },
  { id: 'f_oats', name: 'Oats (50 g)', brand: null, source: 'local', uses: 14, kcal: 190, protein: 6.5, carbs: 33, fat: 3.5 },
  { id: 'f_banana', name: 'Banana (1 medium)', brand: null, source: 'local', uses: 10, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 },
  { id: 'f_coffee', name: 'Coffee with sugar (cup)', brand: null, source: 'local', uses: 30, kcal: 45, protein: 0.3, carbs: 10, fat: 0.2 },
];
const LOCAL_EXTRA: FoodItem[] = [
  { id: 'f_kesra', name: 'Kesra (quarter)', brand: null, source: 'local', uses: 0, kcal: 210, protein: 5, carbs: 34, fat: 6 },
  { id: 'f_hrira', name: 'Hrira (bowl)', brand: null, source: 'local', uses: 0, kcal: 240, protein: 11, carbs: 32, fat: 7 },
  { id: 'f_mhajeb', name: 'Mhajeb (1)', brand: null, source: 'local', uses: 0, kcal: 330, protein: 7, carbs: 42, fat: 15 },
];

const TARGET = { kcal: 2500, protein: 150, carbs: 280, fat: 80, from_day: addDays(today(), -30), method: 'estimate from profile' };

type EntryRow = FoodEntry & { day: string };
const entries: EntryRow[] = [];
const water = new Map<string, number>();
/** day -> complete | partial (unset = no row), like the server's day_status table. */
const dayStatuses = new Map<string, string>();

function entryFrom(f: FoodItem, qty: number, slot: Slot, day: string, id = uid('fl')): EntryRow {
  const k = (n: number) => round(n * qty, 1);
  return { id, day, slot, name: f.name, grams: null, estimate: false, food_id: f.id, kcal: Math.round(f.kcal * qty), protein: k(f.protein), carbs: k(f.carbs), fat: k(f.fat) };
}
function seedFood() {
  const d = today();
  const add = (food: string, qty: number, slot: Slot, day = d) => entries.push(entryFrom(foods.find((f) => f.id === food)!, qty, slot, day));
  add('f_egg', 3, 'breakfast'); add('f_khobz', 1, 'breakfast'); add('f_coffee', 1, 'breakfast');
  add('f_chicken', 2, 'lunch'); add('f_rice', 2, 'lunch');
  add('f_banana', 1, 'snacks');
  water.set(d, 1250);
  const y = addDays(d, -1);
  add('f_oats', 1, 'breakfast', y); add('f_milk', 1, 'breakfast', y);
  add('f_couscous', 1, 'lunch', y); add('f_lentils', 1, 'dinner', y); add('f_dates', 1, 'snacks', y);
  water.set(y, 2000);
}
seedFood();

const sum = (xs: Macros[]): Macros => ({
  kcal: Math.round(xs.reduce((s, x) => s + x.kcal, 0)),
  protein: round(xs.reduce((s, x) => s + x.protein, 0), 1),
  carbs: round(xs.reduce((s, x) => s + x.carbs, 0), 1),
  fat: round(xs.reduce((s, x) => s + x.fat, 0), 1),
});
const outEntry = ({ day: _d, ...e }: EntryRow): FoodEntry => e;

export function foodDay(day = today()): FoodDay {
  const list = entries.filter((e) => e.day === day);
  const slots: FoodDay['slots'] = {};
  for (const e of list) {
    const s = slots[e.slot] ?? { entries: [], total: { kcal: 0, protein: 0, carbs: 0, fat: 0 } };
    s.entries.push(outEntry(e));
    s.total = sum(s.entries);
    slots[e.slot] = s;
  }
  const total = sum(list);
  return {
    day, total, slots,
    water_ml: water.get(day) ?? 0,
    status: dayStatuses.get(day) ?? null,
    target: { ...TARGET },
    left: { kcal: TARGET.kcal - total.kcal, protein: round(TARGET.protein - total.protein, 1) },
    estimates: list.filter((e) => e.estimate).length,
    note: 'Targets are estimates, not medical advice.',
  };
}

/** Same shape as the server's /food/tdee: adaptive estimate (complete days only) plus a suggested target. */
function foodTdee(rate = 0) {
  const to = addDays(today(), -1), from = addDays(today(), -21);
  const counted: number[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const st = dayStatuses.get(d);
    if (st === 'complete') counted.push(sum(entries.filter((e) => e.day === d)).kcal);
  }
  const weighIns = metrics.filter((m) => m.kind === 'weight' && m.day >= from && m.day <= to).length;
  const base = { from, to, counted_days: counted.length, weigh_ins: weighIns };
  const avg = counted.length ? Math.round(counted.reduce((a, k) => a + k, 0) / counted.length) : 0;
  const adaptive = counted.length >= 10 && weighIns >= 4
    ? { ...base, tdee: avg, avg_intake: avg, weekly_rate_kg: 0, note: 'Estimate from your own intake and trend weight.' }
    : { ...base, tdee: null, reason: counted.length < 10 ? `need 10 days marked complete in the last 21 (have ${counted.length})` : 'need 4 weigh-ins in the last 21 days' };
  const tdee = adaptive.tdee ?? 2450;
  const kcal = Math.max(1500, Math.round(tdee + (rate * 7700) / 7));
  return { adaptive, suggestion: { kcal, protein: 146, method: adaptive.tdee ? 'adaptive' : 'mifflin', tdee, floored: kcal === 1500 } };
}
export const foodEntriesOn = (day: string) => entries.filter((e) => e.day === day).length;
export const waterOn = (day: string) => water.get(day) ?? 0;

// ---------- gym ----------

const exercises: Exercise[] = [
  { id: 'x_bench', name: 'Bench press', kind: 'weight_reps', equipment: 'barbell', primary_muscles: ['chest', 'triceps'], increment: 2.5 },
  { id: 'x_ohp', name: 'Overhead press', kind: 'weight_reps', equipment: 'barbell', primary_muscles: ['shoulders'], increment: 2.5 },
  { id: 'x_incdb', name: 'Incline dumbbell press', kind: 'weight_reps', equipment: 'dumbbell', primary_muscles: ['chest'], increment: 2 },
  { id: 'x_dips', name: 'Dips', kind: 'reps', equipment: 'bodyweight', primary_muscles: ['triceps', 'chest'], increment: 0 },
  { id: 'x_squat', name: 'Back squat', kind: 'weight_reps', equipment: 'barbell', primary_muscles: ['quads', 'glutes'], increment: 2.5 },
  { id: 'x_rdl', name: 'Romanian deadlift', kind: 'weight_reps', equipment: 'barbell', primary_muscles: ['hamstrings'], increment: 2.5 },
  { id: 'x_legpress', name: 'Leg press', kind: 'weight_reps', equipment: 'machine', primary_muscles: ['quads'], increment: 5 },
  { id: 'x_plank', name: 'Plank', kind: 'time', equipment: 'bodyweight', primary_muscles: ['core'], increment: 0 },
  { id: 'x_row', name: 'Barbell row', kind: 'weight_reps', equipment: 'barbell', primary_muscles: ['back'], increment: 2.5 },
  { id: 'x_pullup', name: 'Pull-up', kind: 'reps', equipment: 'bodyweight', primary_muscles: ['lats', 'biceps'], increment: 0 },
  { id: 'x_latpd', name: 'Lat pulldown', kind: 'weight_reps', equipment: 'cable', primary_muscles: ['lats'], increment: 5 },
  { id: 'x_curl', name: 'Dumbbell curl', kind: 'weight_reps', equipment: 'dumbbell', primary_muscles: ['biceps'], increment: 1 },
  { id: 'x_bike', name: 'Stationary bike', kind: 'distance_time', equipment: 'machine', primary_muscles: ['cardio'], increment: 0 },
];
const ex = (id: string) => exercises.find((e) => e.id === id)!;
const item = (id: string, sets: number, rep_min: number | null, rep_max: number | null, rest_s: number | null) => {
  const e = ex(id);
  return { exercise_id: e.id, exercise_name: e.name, sets, rep_min, rep_max, rest_s, kind: e.kind };
};
const routines: Routine[] = [
  { id: 'r_push', name: 'Push', items: [item('x_bench', 4, 6, 10, 150), item('x_ohp', 3, 6, 10, 120), item('x_incdb', 3, 8, 12, 90), item('x_dips', 3, 8, 15, 90)] },
  { id: 'r_pull', name: 'Pull', items: [item('x_row', 4, 6, 10, 150), item('x_pullup', 3, 5, 10, 120), item('x_latpd', 3, 10, 12, 90), item('x_curl', 3, 10, 15, 60)] },
  { id: 'r_legs', name: 'Legs', items: [item('x_squat', 4, 5, 8, 180), item('x_rdl', 3, 8, 10, 150), item('x_legpress', 3, 10, 15, 120), item('x_plank', 3, null, null, 60)] },
];

type WorkoutState = Omit<Workout, 'sets' | 'volume_kg' | 'minutes' | 'working_sets'>;
const workouts: WorkoutState[] = [];
const sets: GymSet[] = [];
let rest: Rest = null;
const nextNotes = new Map<string, string>();

function seedGym() {
  const d = today();
  const past: [number, string][] = [[1, 'r_pull'], [3, 'r_push'], [5, 'r_legs'], [8, 'r_pull'], [10, 'r_push']];
  for (const [o, rid] of past) {
    const r = routines.find((x) => x.id === rid)!;
    const day = addDays(d, -o);
    const id = `wo_${o}`;
    workouts.push({ id, name: r.name, day, started_at: at(day, '19:35'), ended_at: at(day, '20:40'), status: 'done', routine_id: r.id, notes: '' });
    let t = Date.parse(at(day, '19:40'));
    r.items.forEach((it, k) => {
      for (let i = 0; i < it.sets; i++) {
        const e = ex(it.exercise_id);
        const base = { x_bench: 70, x_ohp: 42.5, x_incdb: 24, x_squat: 90, x_rdl: 80, x_legpress: 160, x_row: 65, x_latpd: 55, x_curl: 12 }[e.id as 'x_bench'] ?? null;
        sets.push({
          id: `st_${o}_${k}_${i}`, workout_id: id, exercise_id: e.id, exercise_name: e.name, idx: i + 1, type: 'working',
          weight: e.kind === 'weight_reps' ? (base ?? 20) - (o >= 8 ? e.increment : 0) : null,
          reps: e.kind === 'time' ? null : (it.rep_min ?? 8) + (i === 0 ? 2 : 1),
          seconds: e.kind === 'time' ? 60 : null, rpe: i === it.sets - 1 ? 8.5 : 7.5, done_at: iso((t += 150000)),
        });
      }
    });
  }
}
seedGym();

const workingSets = (wid: string) => sets.filter((s) => s.workout_id === wid && s.type !== 'warmup').length;
function workoutRow(w: WorkoutState): WorkoutRow {
  return { id: w.id, name: w.name, day: w.day, started_at: w.started_at, ended_at: w.ended_at, status: w.status, working_sets: workingSets(w.id) };
}
function workoutFull(w: WorkoutState): Workout {
  const ws = sets.filter((s) => s.workout_id === w.id).sort((a, b) => a.done_at.localeCompare(b.done_at));
  const end = w.ended_at ? Date.parse(w.ended_at) : Date.now();
  return {
    ...w,
    working_sets: workingSets(w.id),
    sets: ws,
    volume_kg: Math.round(ws.filter((s) => s.type !== 'warmup').reduce((v, s) => v + (s.weight ?? 0) * (s.reps ?? 0), 0)),
    minutes: Math.round((end - Date.parse(w.started_at)) / 60000),
    prs: workoutPrs(w.id),
  };
}
// PRs like the server: best per (exercise, kind); reported only when the exercise has an earlier session.
const prLabel = (kind: string) => {
  if (kind === 'heaviest') return 'Heaviest weight';
  if (kind === 'e1rm') return 'Best estimated 1-rep max';
  if (kind === 'volume') return 'Best set volume';
  const m = /^reps@(.+)$/.exec(kind);
  if (m) return Number(m[1]) > 0 ? `Most reps at ${Number(m[1])} kg` : 'Most reps';
  return kind;
};
const prCandidates = (s: GymSet): [string, number][] => {
  if (s.type === 'warmup' || !s.reps) return [];
  const w = s.weight ?? 0;
  const out: [string, number][] = [[`reps@${w}`, s.reps]];
  if (w > 0) {
    out.push(['heaviest', w], ['volume', round(w * s.reps, 1)]);
    if (s.reps <= 12) out.push(['e1rm', round(w * (1 + s.reps / 30), 1)]);
  }
  return out;
};
const startedOf = (wid: string) => workouts.find((w) => w.id === wid)?.started_at ?? '';
const hasEarlierSession = (exId: string, wid: string) =>
  sets.some((x) => x.exercise_id === exId && x.type !== 'warmup' && x.workout_id !== wid && startedOf(x.workout_id) < startedOf(wid));
function prsOf(s: GymSet): Pr[] {
  if (!hasEarlierSession(s.exercise_id, s.workout_id)) return [];
  const before = sets.filter((x) => x.exercise_id === s.exercise_id && x.id !== s.id && x.done_at <= s.done_at);
  const out: Pr[] = [];
  for (const [kind, value] of prCandidates(s)) {
    const prev = Math.max(-Infinity, ...before.flatMap((x) => prCandidates(x).filter(([k]) => k === kind).map(([, v]) => v)));
    if (Number.isFinite(prev) && value > prev) out.push({ kind, value, previous: prev, label: prLabel(kind) });
  }
  return out;
}
/** PRs set in this workout, one per exercise and kind (the last one wins). */
function workoutPrs(wid: string): Pr[] {
  const by = new Map<string, Pr>();
  for (const s of sets.filter((x) => x.workout_id === wid).sort((a, b) => a.done_at.localeCompare(b.done_at))) {
    for (const p of prsOf(s)) by.set(`${s.exercise_id}|${p.kind}`, { exercise_id: s.exercise_id, exercise_name: s.exercise_name, kind: p.kind, value: p.value, set_id: s.id, label: p.label });
  }
  return [...by.values()];
}

const activeWorkout = () => workouts.find((w) => w.status === 'active') ?? null;
const currentRest = (): Rest => (rest && Date.parse(rest.ends_at) > Date.now() ? rest : null);
const findExercise = (ref: string) =>
  exercises.find((e) => e.id === ref || e.name.toLowerCase() === ref.toLowerCase()) ??
  exercises.find((e) => e.name.toLowerCase().includes(ref.toLowerCase()));

function nextSet(e: Exercise, repMin: number | null, repMax: number | null, deload = false): NextSet {
  const last = sets.filter((s) => s.exercise_id === e.id && s.type === 'working').sort((a, b) => b.done_at.localeCompare(a.done_at))[0];
  const lo = repMin ?? 8;
  const hi = repMax ?? 12;
  if (!last) return { exercise: e.name, weight: null, reps: lo, why: 'No history yet. Pick a weight you can lift for the low end of the range.' };
  if (deload && last.weight != null) {
    const inc = e.increment > 0 ? e.increment : 2.5;
    return { exercise: e.name, weight: round(Math.round((last.weight * 0.9) / inc) * inc, 2), reps: lo, why: 'lighter week: about 90% of last top weight' };
  }
  if ((last.reps ?? 0) >= hi && last.weight != null && e.increment > 0) {
    return { exercise: e.name, weight: last.weight + e.increment, reps: lo, why: `Hit ${hi} reps last time: add ${e.increment} kg and restart at ${lo}.` };
  }
  return { exercise: e.name, weight: last.weight, reps: Math.min(hi, (last.reps ?? lo) + 1), why: 'Same weight, one more rep than last time.' };
}

export function gymGlance() {
  const done = workouts.filter((w) => w.status === 'done').sort((a, b) => b.day.localeCompare(a.day));
  const from = addDays(today(), -6);
  const a = activeWorkout();
  return {
    active: a ? workoutRow(a) : null,
    last: done[0] ? { id: done[0].id, name: done[0].name, day: done[0].day } : null,
    workouts_7d: done.filter((w) => w.day >= from).length,
    rest: currentRest(),
  };
}
export const setsOn = (day: string) => sets.filter((s) => workouts.find((w) => w.id === s.workout_id)?.day === day).length;
export const workoutsOn = (day: string) => workouts.filter((w) => w.day === day && w.status === 'done').length;
export const workoutsBetween = (from: string, to: string) => workouts.filter((w) => w.status === 'done' && w.day >= from && w.day <= to).length;

function todayRoutine(): TodayRoutine {
  const done = workouts.filter((w) => w.status === 'done' && w.routine_id).sort((a, b) => b.day.localeCompare(a.day));
  const last = done[0];
  const order = routines.map((r) => r.id);
  const nextId = last ? order[(order.indexOf(last.routine_id!) + 1) % order.length]! : order[0]!;
  const a = activeWorkout();
  return {
    active: a ? workoutFull(a) : null,
    routine: routines.find((r) => r.id === nextId) ?? null,
    last: last ? { routine_id: last.routine_id!, name: last.name, day: last.day } : null,
  };
}

// ---------- body ----------

const metrics: Metric[] = [];
function seedBody() {
  const d = today();
  const weights = [82.4, 82.1, 81.9, 82.0, 81.6, 81.5, 81.3, 81.4, 81.0, 80.9];
  weights.forEach((kg, i) => metrics.push({ id: `bm_w${i}`, day: addDays(d, -(weights.length - 1 - i) * 3), kind: 'weight', value: kg, unit: 'kg' }));
  metrics.push({ id: 'bm_waist', day: addDays(d, -6), kind: 'waist', value: 88, unit: 'cm' });
  metrics.push({ id: 'bm_sleep', day: addDays(d, -1), kind: 'sleep_h', value: 7.5, unit: 'h' });
  metrics.push({ id: 'bm_steps', day: addDays(d, -1), kind: 'steps', value: 6400, unit: 'steps' });
}
seedBody();
const UNITS: Record<string, string> = {
  weight: 'kg', waist: 'cm', chest: 'cm', hips: 'cm', arm: 'cm', thigh: 'cm', neck: 'cm', body_fat: '%', sleep_h: 'h', steps: 'steps', resting_hr: 'bpm',
};

export function bodySummary(): BodySummary {
  const w = metrics.filter((m) => m.kind === 'weight').sort((a, b) => a.day.localeCompare(b.day));
  const last = w[w.length - 1];
  const d = today();
  const near = (days: number) => {
    const cut = addDays(d, -days);
    return [...w].reverse().find((m) => m.day <= cut);
  };
  const recent = w.slice(-5);
  const trend = recent.length ? round(recent.reduce((s, m) => s + m.value, 0) / recent.length, 1) : null;
  const latest: Record<string, Metric> = {};
  for (const m of [...metrics].sort((a, b) => a.day.localeCompare(b.day))) latest[m.kind] = m;
  const mean = (from: string, to: string) => {
    const xs = w.filter((m) => m.day >= from && m.day <= to);
    return xs.length ? round(xs.reduce((a, m) => a + m.value, 0) / xs.length, 1) : null;
  };
  const n7 = near(7);
  const n28 = near(28);
  return {
    last_weight: last ? { day: last.day, kg: last.value } : null,
    trend_kg: trend,
    change_7d: last && n7 ? round(last.value - n7.value, 1) : null,
    change_28d: last && n28 ? round(last.value - n28.value, 1) : null,
    weigh_ins_21d: w.filter((m) => m.day >= addDays(d, -20)).length,
    avg_7d: mean(addDays(d, -6), d),
    avg_prev_7d: mean(addDays(d, -13), addDays(d, -7)),
    latest,
    note: 'Trend = average of the last 5 weigh-ins. Numbers only, not medical advice.',
  };
}

// ---------- router ----------

export function handleHealth(c: Ctx): Res | null {
  const { route, qp, b } = c;
  let m: string[] | null;

  // food
  if (route === 'GET /food/day') return ok(foodDay(qp.get('day') ?? today()));
  if (route === 'GET /food/search') {
    const s = (qp.get('q') ?? '').toLowerCase().trim();
    const limit = num(qp.get('limit'), 12);
    return ok(foods.filter((f) => !s || f.name.toLowerCase().includes(s)).sort((a, b) => b.uses - a.uses).slice(0, limit));
  }
  if (route === 'POST /food/log') {
    const id = idOf(b, 'fl');
    const dup = entries.find((e) => e.id === id);
    if (dup) return ok(outEntry(dup));
    const day = str(b.day) || today();
    const slot = (b.slot as Slot) || 'snacks';
    const ref = str(b.food);
    const f = ref ? foods.find((x) => x.id === ref || x.name.toLowerCase() === ref.toLowerCase()) : undefined;
    let e: EntryRow;
    if (f) {
      const grams = optNum(b.grams);
      const qty = grams != null ? grams / 100 : num(b.qty, 1);
      e = entryFrom(f, qty, slot, day, id);
      e.grams = grams;
      f.uses++;
    } else {
      const name = str(b.name).trim() || ref.trim();
      if (!name) return bad('Name a food or pick one from search.');
      e = {
        id, day, slot, name, grams: optNum(b.grams), estimate: b.estimate !== false, food_id: null,
        kcal: Math.round(num(b.kcal)), protein: num(b.protein), carbs: num(b.carbs), fat: num(b.fat),
      };
    }
    entries.push(e);
    return created(outEntry(e));
  }
  if ((m = match(route, /^DELETE \/food\/log\/([^/]+)$/))) {
    const i = entries.findIndex((e) => e.id === m![0]);
    if (i < 0) return notFound('Entry');
    entries.splice(i, 1);
    return ok({ ok: true });
  }
  if (route === 'POST /food/water') {
    const day = str(b.day) || today();
    const ml = Math.max(0, (water.get(day) ?? 0) + num(b.ml, 250));
    water.set(day, ml);
    return ok({ day, water_ml: ml });
  }
  if (route === 'POST /food/day-status') {
    const day = str(b.day) || today();
    const st = b.status == null ? null : str(b.status);
    if (st !== null && !['complete', 'partial'].includes(st)) return bad('status must be one of complete, partial');
    if (st === null) dayStatuses.delete(day);
    else dayStatuses.set(day, st);
    return ok({ day, status: st });
  }
  if (route === 'GET /food/tdee') return ok(foodTdee(num(qp.get('rate'), 0)));
  if (route === 'POST /food/seed-local') {
    let added = 0;
    for (const f of LOCAL_EXTRA) if (!foods.some((x) => x.id === f.id)) { foods.push({ ...f }); added++; }
    return ok({ added, total: foods.length, note: 'Local foods. Values are estimates.' });
  }

  // gym
  if (route === 'GET /gym/routines') return ok(routines);
  if (route === 'GET /gym/today-routine') return ok(todayRoutine());
  if (route === 'GET /gym/active') {
    const a = activeWorkout();
    return ok({ workout: a ? workoutFull(a) : null, rest: currentRest() });
  }
  if (route === 'GET /gym/workouts') {
    const limit = num(qp.get('limit'), 10);
    return ok([...workouts].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, limit).map(workoutRow));
  }
  if (route === 'POST /gym/workouts') {
    const a = activeWorkout();
    if (a) return ok(workoutFull(a));
    const id = idOf(b, 'wo');
    const ref = str(b.routine);
    const r = ref ? routines.find((x) => x.id === ref || x.name.toLowerCase() === ref.toLowerCase()) : undefined;
    const w: WorkoutState = { id, name: r?.name ?? 'Workout', day: today(), started_at: iso(), ended_at: null, status: 'active', routine_id: r?.id ?? null, notes: '' };
    workouts.push(w);
    return created(workoutFull(w));
  }
  if ((m = match(route, /^GET \/gym\/workouts\/([^/]+)\/forecast$/))) {
    const w = workouts.find((x) => x.id === m![0]);
    if (!w) return notFound('Workout');
    const r = routines.find((x) => x.id === w.routine_id);
    const planned = r ? r.items.reduce((s, i) => s + i.sets, 0) : 12;
    const left = Math.max(0, planned - workingSets(w.id));
    const minutes = left * 3;
    const f: Forecast = { ends_at: iso(Date.now() + minutes * 60000), minutes_left: minutes, line: `${left} sets left, about ${minutes} min.` };
    return ok(f);
  }
  if ((m = match(route, /^GET \/gym\/workouts\/([^/]+)$/))) {
    const w = workouts.find((x) => x.id === m![0]);
    return w ? ok(workoutFull(w)) : notFound('Workout');
  }
  if ((m = match(route, /^POST \/gym\/workouts\/([^/]+)\/finish$/))) {
    const w = workouts.find((x) => x.id === m![0]);
    if (!w) return notFound('Workout');
    w.status = 'done';
    w.ended_at = iso();
    if (typeof b.notes === 'string') w.notes = b.notes;
    rest = null;
    return ok(workoutFull(w));
  }
  if (route === 'POST /gym/sets') {
    const id = idOf(b, 'st');
    const dup = sets.find((s) => s.id === id);
    if (dup) return ok({ set: dup, prs: [] });
    const w = workouts.find((x) => x.id === b.workout_id) ?? activeWorkout();
    if (!w) return bad('Start a workout first.');
    const e = findExercise(str(b.exercise));
    if (!e) return notFound('Exercise');
    const s: GymSet = {
      id, workout_id: w.id, exercise_id: e.id, exercise_name: e.name,
      idx: sets.filter((x) => x.workout_id === w.id && x.exercise_id === e.id).length + 1,
      type: (b.type as GymSet['type']) ?? 'working',
      weight: optNum(b.weight), reps: optNum(b.reps), seconds: optNum(b.seconds), rpe: optNum(b.rpe), done_at: iso(),
    };
    sets.push(s);
    const restS = num(b.rest_s, routines.flatMap((r) => r.items).find((i) => i.exercise_id === e.id)?.rest_s ?? 90);
    if (restS > 0) rest = { ends_at: iso(Date.now() + restS * 1000), label: `Rest after ${e.name}` };
    return created({ set: s, prs: prsOf(s) });
  }
  if ((m = match(route, /^DELETE \/gym\/sets\/([^/]+)$/))) {
    const i = sets.findIndex((s) => s.id === m![0]);
    if (i < 0) return notFound('Set');
    sets.splice(i, 1);
    return ok({ ok: true });
  }
  if (route === 'DELETE /gym/rest') { rest = null; return ok({ ok: true }); }
  if (route === 'GET /gym/exercises') {
    const s = (qp.get('q') ?? '').toLowerCase();
    return ok(exercises.filter((e) => !s || e.name.toLowerCase().includes(s)).slice(0, num(qp.get('limit'), 20)));
  }
  if ((m = match(route, /^GET \/gym\/exercises\/([^/]+)\/history$/))) {
    const e = findExercise(m[0]!);
    if (!e) return notFound('Exercise');
    const history = sets.filter((s) => s.exercise_id === e.id).sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 30);
    const best = new Map<string, { exercise_id: string; exercise_name: string; kind: string; value: number; set_id: string; at: string }>();
    for (const s of [...history].reverse()) for (const [kind, value] of prCandidates(s)) {
      if (kind.startsWith('reps@')) continue;
      const cur = best.get(kind);
      if (!cur || value > cur.value) best.set(kind, { exercise_id: e.id, exercise_name: e.name, kind, value, set_id: s.id, at: s.done_at });
    }
    return ok({
      history,
      prs: [...best.values()],
      next: nextSet(e, optNum(qp.get('rep_min')), optNum(qp.get('rep_max')), qp.get('deload') === '1'),
    });
  }
  if (route === 'GET /gym/volume') {
    const d = qp.get('week') ?? today();
    const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
    const from = addDays(d, -dow), to = addDays(from, 6);
    const out: Record<string, number> = {};
    for (const s of sets) {
      const day = workouts.find((w) => w.id === s.workout_id)?.day ?? '';
      if (s.type === 'warmup' || day < from || day > to) continue;
      for (const mu of exercises.find((x) => x.id === s.exercise_id)?.primary_muscles ?? []) out[mu] = (out[mu] ?? 0) + 1;
    }
    return ok(Object.entries(out).sort((a, b) => b[1] - a[1]).map(([muscle, n]) => ({ muscle, sets: n })));
  }
  if (route === 'GET /gym/carry-forward') {
    const e = findExercise(qp.get('exercise') ?? '');
    if (!e) return ok(null);
    const note = nextNotes.get(e.id) ?? null;
    const cf: CarryForward = { exercise: e.name, note, line: note ? `Note from last time: ${note}` : undefined };
    return ok(cf);
  }
  if (route === 'PUT /gym/next-note') {
    const e = findExercise(str(b.exercise));
    if (!e) return notFound('Exercise');
    const note = str(b.note).trim();
    if (note) nextNotes.set(e.id, note);
    else nextNotes.delete(e.id);
    return ok({ exercise: e.name, note: note || null });
  }

  // body
  if (route === 'GET /body') return ok(bodySummary());
  if (route === 'GET /body/metrics') {
    const kind = qp.get('kind') ?? 'weight';
    return ok(metrics.filter((x) => x.kind === kind).sort((a, b) => b.day.localeCompare(a.day)));
  }
  if (route === 'POST /body/metrics') {
    const kind = str(b.kind, 'weight');
    const value = num(b.value, NaN);
    if (!Number.isFinite(value)) return bad('Value is required.');
    const id = idOf(b, 'bm');
    const day = str(b.day) || today();
    const existing = metrics.find((x) => x.id === id) ?? metrics.find((x) => x.kind === kind && x.day === day);
    if (existing) {
      existing.value = value;
      return ok(existing);
    }
    const metric: Metric = { id, day, kind, value, unit: str(b.unit) || UNITS[kind] || '' };
    metrics.push(metric);
    return created(metric);
  }
  if ((m = match(route, /^DELETE \/body\/metrics\/([^/]+)$/))) {
    const i = metrics.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Metric');
    metrics.splice(i, 1);
    return ok({ ok: true });
  }

  return handleHealthMore(c);
}

export const foodSearchHits = (s: string) => foods.filter((f) => f.name.toLowerCase().includes(s.toLowerCase()));
export const routineNames = () => routines.map((r) => r.name);

// ---------- routine editing + recipes ----------

export type MockRecipe = { id: string; name: string; raw_g: number | null; cooked_g: number | null; portions: number | null; ingredients: { name: string; qty: number; unit: string }[] };
export const recipes: MockRecipe[] = [
  { id: 'rc_lentil', name: 'Lentil soup', raw_g: 900, cooked_g: 1800, portions: 4, ingredients: [{ name: 'Lentils', qty: 300, unit: 'g' }, { name: 'Onion', qty: 1, unit: 'pc' }, { name: 'Carrots', qty: 2, unit: 'pc' }] },
  { id: 'rc_chicken', name: 'Chicken and rice', raw_g: 1100, cooked_g: 1500, portions: 3, ingredients: [{ name: 'Chicken breast', qty: 500, unit: 'g' }, { name: 'Rice', qty: 300, unit: 'g' }, { name: 'Tomato', qty: 2, unit: 'pc' }] },
  { id: 'rc_oats', name: 'Overnight oats', raw_g: 250, cooked_g: 400, portions: 2, ingredients: [{ name: 'Oats', qty: 120, unit: 'g' }, { name: 'Milk', qty: 300, unit: 'ml' }, { name: 'Bananas', qty: 1, unit: 'pc' }] },
];

type ItemIn = { exercise?: unknown; exercise_id?: unknown; sets?: unknown; rep_min?: unknown; rep_max?: unknown; rest_s?: unknown };
function routineItems(raw: unknown): { items: Routine['items'] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'items must be a list.' };
  const out: Routine['items'] = [];
  for (const r of raw as ItemIn[]) {
    const ref = str(r?.exercise_id ?? r?.exercise).trim();
    if (!ref) return { error: 'Each item needs an exercise.' };
    let e = exercises.find((x) => x.id === ref || x.name.toLowerCase() === ref.toLowerCase());
    if (!e) {
      e = { id: uid('x'), name: ref, kind: 'weight_reps', equipment: 'other', primary_muscles: [], increment: 2.5 } as (typeof exercises)[number];
      exercises.push(e);
    }
    const sets = r.sets == null ? 3 : num(r.sets, NaN);
    if (!Number.isInteger(sets) || sets < 1 || sets > 20) return { error: `Sets for ${e.name} must be 1–20.` };
    const n = (v: unknown) => (v == null || v === '' ? null : num(v, NaN));
    const rep_min = n(r.rep_min), rep_max = n(r.rep_max), rest_s = n(r.rest_s);
    for (const v of [rep_min, rep_max, rest_s]) if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: `Numbers for ${e.name} must be 0 or more.` };
    if (rep_min !== null && rep_max !== null && rep_min > rep_max) return { error: `Rep range for ${e.name} is upside down.` };
    out.push({ exercise_id: e.id, exercise_name: e.name, sets, rep_min, rep_max, rest_s, kind: e.kind });
  }
  return { items: out };
}

function handleHealthMore(c: Ctx): Res | null {
  const { route, b } = c;
  let m: string[] | null;
  if (route === 'GET /food/recipes') return ok(recipes.map(({ ingredients: _i, ...r }) => r));
  if ((m = match(route, /^PUT \/gym\/routines\/([^/]+)\/items$/))) {
    const r = routines.find((x) => x.id === m![0]);
    if (!r) return notFound('Routine');
    const res = routineItems(b.items);
    if ('error' in res) return bad(res.error);
    r.items = res.items;
    return ok(r);
  }
  if (route === 'POST /gym/routines') {
    const name = str(b.name).trim();
    if (!name) return bad('Name the routine.');
    if (routines.some((x) => x.name.toLowerCase() === name.toLowerCase())) return bad(`A routine called "${name}" already exists.`);
    const res = routineItems(b.items ?? []);
    if ('error' in res) return bad(res.error);
    const r: Routine = { id: idOf(b, 'r'), name, items: res.items };
    routines.push(r);
    return created(r);
  }
  return null;
}
