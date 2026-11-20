// Mock /api/v2 grades, day ratings, quiet areas and goals2 (shapes from src/grades.ts, logic ported from api grades/store.ts).
import type { Area, AreaGrade, DoneLog, DoneRange, DoneTotals, GoalLink, GoalTemplate, GoalTree, GoalV2, GradeFact, GradeWeek, Milestone, NextSteps, Patterns, Quarter, QuietArea, WeekChange, WeekGrades, WhatIf } from '../grades';
import { runway, savings } from './money';
import { workoutsBetween, foodEntriesOn } from './health';
import { doneTasksBetween, focusLog, habitChecksOn, habits, projects, tasks } from './tasks';
import { doneCounts } from './extras';
import { lastDoneBetween, peopleTouchedBetween, promisesKeptBetween } from './life';
import { addDays, bad, created, daysBetween, idOf, iso, match, notFound, num, ok, optNum, round, str, today, uid, weekStart, type Ctx, type Res } from './util';

// ---------- areas ----------

const areas: Area[] = [
  { id: 'ar_body', key: 'body', name: 'Body', emoji: '🏋️', vision: 'Strong, lean, asleep by 23:30.', sort: 2 },
  { id: 'ar_money', key: 'money', name: 'Money', emoji: '💵', vision: 'Savings on track, runway never under 8 weeks.', sort: 3 },
  { id: 'ar_work', key: 'work', name: 'Work', emoji: '🚀', vision: 'Steady progress on the work that matters.', sort: 4 },
  { id: 'ar_learning', key: 'learning', name: 'Learning', emoji: '📚', vision: 'Always learning something new.', sort: 6 },
  { id: 'ar_people', key: 'people', name: 'People', emoji: '👪', vision: 'Family first, promises kept.', sort: 7 },
  { id: 'ar_home', key: 'home', name: 'Home', emoji: '🏠', vision: 'A clean room and a working desk.', sort: 8 },
];
const areaByKey = (k: string | null | undefined) => areas.find((a) => a.key === k || a.id === k) ?? null;

// ---------- week grades ----------

type Input = { key: string; label: string; unit: string; target: number; actual: (from: string, to: string) => number };
const sumDays = (from: string, to: string, f: (d: string) => number) => {
  let s = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) s += f(d);
  return s;
};
const INPUTS: Record<string, Input[]> = {
  body: [
    { key: 'gym', label: 'Gym sessions', unit: 'sessions', target: 4, actual: workoutsBetween },
    { key: 'food_days', label: 'Days with food logged', unit: 'days', target: 5, actual: (a, b) => sumDays(a, b, (d) => (foodEntriesOn(d) > 0 ? 1 : 0)) },
  ],
  money: [{ key: 'car_fund', label: 'Car fund untouched', unit: 'weeks', target: 1, actual: () => 1 }],
  work: [
    { key: 'tasks_done', label: 'Tasks done', unit: 'tasks', target: 15, actual: (a, b) => doneTasksBetween(a, b).length },
    { key: 'focus', label: 'Focus minutes', unit: 'min', target: 600, actual: (a, b) => focusLog.filter((f) => f.day >= a && f.day <= b).reduce((s, f) => s + f.minutes, 0) },
  ],
  learning: [{ key: 'cards', label: 'Cards reviewed', unit: 'cards', target: 20, actual: (a, b) => doneCounts(a, b).cards_reviewed }],
  people: [
    { key: 'promises', label: 'Promises kept', unit: 'kept', target: 2, actual: promisesKeptBetween },
    { key: 'touches', label: 'People contacted', unit: 'people', target: 3, actual: peopleTouchedBetween },
  ],
  home: [{ key: 'chores', label: 'Recurring chores stamped', unit: 'chores', target: 2, actual: lastDoneBetween }],
};
const LETTERS = [{ letter: 'A', min: 0.85 }, { letter: 'B', min: 0.65 }, { letter: 'C', min: 0.4 }, { letter: 'D', min: 0 }] as const;
const letterOf = (score: number | null): string | null => (score === null ? null : LETTERS.find((l) => score >= l.min)!.letter);

function areaGrade(a: Area, ws: string, end: string, light: boolean): AreaGrade {
  const inputs = INPUTS[a.key ?? ''] ?? [];
  const facts: GradeFact[] = inputs.map((i) => {
    const actual = round(i.actual(ws, end), 0);
    return { key: i.key, label: i.label, actual, target: i.target, share: round(Math.min(1, i.target ? actual / i.target : 0), 2), unit: i.unit };
  });
  const base = { key: a.key ?? a.id ?? a.name, name: a.name, emoji: a.emoji, facts };
  if (!facts.length) return { ...base, letter: null, score: null, status: 'not_graded', lift: null };
  if (light) return { ...base, letter: null, score: null, status: 'light_week', lift: null };
  const score = round(facts.reduce((s, f) => s + f.share, 0) / facts.length, 2);
  const low = [...facts].sort((x, y) => x.share - y.share)[0]!;
  const lift = score >= 0.85 ? null : `${low.label}: ${Math.max(0, low.target - low.actual)} ${low.unit} more lifts it.`;
  return { ...base, letter: letterOf(score), score, status: 'graded', lift };
}

export function weekGrades(week?: string | null): WeekGrades {
  const ws = weekStart(week || today());
  const we = addDays(ws, 6);
  const so_far = today() <= we;
  const end = so_far ? today() : we;
  const active_days = Math.min(7, daysBetween(ws, end) + 1);
  const light_week = [...ratings.values()].filter((r) => r.day >= ws && r.day <= we && r.tags.includes('family_event')).length >= 3;
  const graded = areas.map((a) => areaGrade(a, ws, end, light_week));
  const scored = graded.filter((g) => g.score !== null);
  const overall = scored.length ? round(scored.reduce((s, g) => s + g.score!, 0) / scored.length, 2) : null;
  const best = [...scored].sort((a, b) => b.score! - a.score!)[0] ?? null;
  const low = [...scored].sort((a, b) => a.score! - b.score!)[0] ?? null;
  const dr = [...ratings.values()].filter((r) => r.day >= ws && r.day <= we).sort((a, b) => a.day.localeCompare(b.day));
  const avg = dr.length ? round(dr.reduce((s, r) => s + r.rating, 0) / dr.length, 1) : null;
  const facts = weekFacts(graded);
  const line = facts.length ? `${so_far ? 'So far' : 'This week'}: ${facts.join(', ')}.`
    : light_week && so_far ? 'Early in the week. Counts show up as you log.' : 'Nothing logged this week yet.';
  return {
    week_start: ws, week_end: we, so_far, active_days, light_week,
    overall: { letter: light_week ? null : letterOf(overall), score: light_week ? null : overall },
    areas: graded, best: best?.name ?? null, lift: low?.lift ?? null,
    day_rating_avg: avg, day_ratings: dr.map((r) => ({ day: r.day, rating: r.rating })), day_rating_count: dr.length, line,
    facts, change: weekChange(ws, graded),
  };
}
const fmtN = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 1 }));
/** Up to 3 plain count facts: per area the input closest to its target, only things that happened (api weekFacts). */
function weekFacts(list: AreaGrade[]): string[] {
  const out: { line: string; share: number }[] = [];
  for (const a of list) {
    const best = a.facts.filter((f) => f.actual > 0).sort((x, y) => y.share - x.share)[0];
    if (best) out.push({ line: `${fmtN(best.actual)} ${best.label}`, share: best.share });
  }
  return out.sort((x, y) => y.share - x.share).slice(0, 3).map((x) => x.line);
}
const changes = new Map<string, { text: string; edited: boolean }>();
/** One suggested change: a fixed slot for the input furthest from its target. Stored text wins (api weekChange). */
function weekChange(ws: string, list: AreaGrade[]): WeekChange | null {
  const stored = changes.get(ws);
  if (stored) return { text: stored.text, area: null, input: null, accepted: true, edited: stored.edited };
  let low: { a: AreaGrade; f: GradeFact } | null = null;
  for (const a of list) for (const f of a.facts) if (!low || f.share < low.f.share) low = { a, f };
  if (!low || low.f.share >= 1) return null;
  const left = Math.max(1, Math.ceil(low.f.target - low.f.actual));
  return { text: `Next week: put ${low.f.label} in one fixed slot (${fmtN(left)} ${low.f.unit} short of the usual).`, area: low.a.key, input: low.f.key, accepted: false, edited: false };
}
function setTarget(area: string, input: string, target: number): boolean {
  const i = INPUTS[area]?.find((x) => x.key === input);
  if (!i) return false;
  i.target = Math.max(0, target);
  return true;
}

// ---------- day ratings ----------

export const RATING_TAGS = ['launch_used', 'gym', 'late_start', 'family_event', 'power_cut', 'outside'];
type RatingRow = { day: string; rating: number; note: string; tags: string[] };
const ratings = new Map<string, RatingRow>();
(() => {
  const seed: [number, number, string, string[]][] = [
    [-1, 4, 'Kickoff on time, 2 proposals sent.', ['launch_used', 'gym']],
    [-2, 3, '', ['late_start']],
    [-3, 4, 'Good build block.', ['launch_used']],
    [-4, 2, 'Power cut most of the afternoon.', ['power_cut', 'late_start']],
    [-5, 5, 'Shipped the recipe app search.', ['launch_used', 'gym']],
    [-6, 3, '', ['family_event']],
    [-7, 4, '', ['launch_used', 'gym']],
    [-8, 2, 'Slept late.', ['late_start']],
    [-9, 4, '', ['gym', 'outside']],
    [-10, 3, '', ['outside']],
    [-11, 4, '', ['launch_used']],
    [-12, 3, '', ['late_start', 'gym']],
  ];
  for (const [n, rating, note, tags] of seed) ratings.set(addDays(today(), n), { day: addDays(today(), n), rating, note, tags });
})();
const ratingOut = (r: RatingRow | undefined) => (r ? { day: r.day, rating: r.rating, note: r.note, tags: r.tags } : null);
function patterns(): Patterns {
  const rows = [...ratings.values()];
  const needed = 10;
  if (rows.length < needed) return { days: rows.length, needed, patterns: [], line: `Rate ${needed - rows.length} more days to see patterns.` };
  const out: Patterns['patterns'] = [];
  for (const key of RATING_TAGS) {
    const withTag = rows.filter((r) => r.tags.includes(key));
    if (withTag.length < 2) continue;
    const good = withTag.filter((r) => r.rating >= 4).length / withTag.length;
    const hard = withTag.filter((r) => r.rating <= 2).length / withTag.length;
    const baseGood = rows.filter((r) => r.rating >= 4).length / rows.length;
    const diff = round(good - baseGood, 2);
    out.push({
      key, good_share: round(good, 2), hard_share: round(hard, 2), diff,
      line: diff >= 0.1 ? `Days with ${key.replace('_', ' ')} rate higher.` : diff <= -0.1 ? `Days with ${key.replace('_', ' ')} rate lower.` : `${key.replace('_', ' ')} makes little difference.`,
    });
  }
  out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { days: rows.length, needed, patterns: out, line: out[0]?.line ?? 'No clear pattern yet.' };
}

// ---------- quiet areas ----------

const quietDismissed = new Map<string, string>();
const QUIET_OPTIONS: Record<string, string[]> = {
  body: ['20-minute walk after lunch', 'Log breakfast', 'Gym: Push day'],
  money: ['Log yesterday’s spending', 'Check the savings fund'],
  work: ['Finish one portfolio section', 'Clear one small task'],
  learning: ['Review 10 flashcards', 'Read 10 pages'],
  people: ['Call Grandma', 'Message Yacine'],
  home: ['Change bedsheets', 'Clear the desk'],
};
function quiet(): { mode: string; areas: QuietArea[] } {
  const g = weekGrades();
  const list: QuietArea[] = g.areas
    .filter((a) => a.status === 'graded' && (a.score ?? 0) < 0.4 && !(quietDismissed.get(a.key) && quietDismissed.get(a.key)! >= today()))
    .map((a) => ({ key: a.key, name: a.name, emoji: a.emoji, line: `${a.name} has been quiet this week.`, options: QUIET_OPTIONS[a.key] ?? [] }));
  return { mode: 'Normal', areas: list.slice(0, 2) };
}

// ---------- goals2 ----------

type GoalRow = {
  id: string; name: string; why: string; area_id: string | null; target_value: number | null; unit: string | null; target_date: string | null;
  start_value: number | null; start_day: string | null; auto: string | null; horizon: GoalV2['horizon']; status: GoalV2['status'];
  next_step: string; outcome: number; floor_value: number | null; stretch_value: number | null; created_at: string;
  seed_key?: string | null; paused_at?: string | null;
};
const goals: GoalRow[] = [];
const goalValues = new Map<string, { day: string; value: number }[]>();
const milestones: Milestone[] = [];
const goalLinks = new Map<string, { kind: GoalLink['kind']; ref: string }[]>();

function mkGoal(f: Partial<GoalRow> & { name: string }): GoalRow {
  const g: GoalRow = {
    id: f.id ?? uid('g2'), why: '', area_id: null, target_value: null, unit: null, target_date: null,
    start_value: null, start_day: today(), auto: null, horizon: 'year', status: 'active', next_step: '', outcome: 0,
    floor_value: null, stretch_value: null, created_at: iso(), ...f,
  };
  goals.push(g);
  return g;
}
const addMs = (goal_id: string, name: string, due: string | null, done_at: string | null = null) => {
  const m: Milestone = { id: uid('ms'), goal_id, name, due, done_at };
  milestones.push(m);
  return m;
};
(() => {
  const car = mkGoal({
    id: 'g2_car', name: 'Savings fund: used car', why: 'Pay for a car in cash.', area_id: 'ar_money',
    target_value: 9000, unit: 'USD', target_date: addDays(today(), 210), start_value: 0, start_day: addDays(today(), -120), auto: 'savings:car', horizon: 'year',
    next_step: 'Log this week’s savings transfer',
  });
  addMs(car.id, '$2,000 saved', addDays(today(), -30), iso(Date.now() - 35 * 86400000));
  addMs(car.id, '$4,500 saved (half way)', addDays(today(), 70));
  addMs(car.id, 'Shortlist 3 cars', addDays(today(), 180));

  const jobs = mkGoal({
    id: 'g2_books', name: 'Read 12 books', why: 'One book a month.', area_id: 'ar_learning',
    target_value: 12, unit: 'books', target_date: addDays(today(), 300), start_value: 0, start_day: addDays(today(), -60), horizon: 'year',
    next_step: 'Read 10 pages', seed_key: 'tpl:read_books',
  });
  goalValues.set(jobs.id, [{ day: addDays(today(), -30), value: 1 }, { day: addDays(today(), -1), value: 2 }]);

  const gym = mkGoal({
    id: 'g2_gym', name: '150 gym sessions', why: 'Strength and energy for long build days.', area_id: 'ar_body',
    target_value: 150, unit: 'sessions', target_date: addDays(today(), 340), start_value: 0, start_day: addDays(today(), -90), horizon: 'year',
    next_step: 'Pack the gym bag after dinner',
  });
  goalValues.set(gym.id, [{ day: addDays(today(), -45), value: 21 }, { day: addDays(today(), -1), value: 44 }]);
  const gymHabit = habits.find((h) => /gym/i.test(h.name));
  if (gymHabit) goalLinks.set(gym.id, [{ kind: 'habit', ref: gymHabit.id }]);

  const weight = mkGoal({
    id: 'g2_weight', name: 'Body weight 78 kg', why: 'Shown as info; the gym and food logs are what you control.', area_id: 'ar_body',
    target_value: 78, unit: 'kg', target_date: addDays(today(), 200), start_value: 84, start_day: addDays(today(), -60), auto: null, horizon: 'year',
    next_step: 'Weigh in this morning', outcome: 1,
  });
  goalValues.set(weight.id, [{ day: addDays(today(), -30), value: 82.6 }, { day: addDays(today(), -2), value: 81.4 }]);

  mkGoal({
    id: 'g2_side', name: 'Ship a side project', why: 'One finished thing beats ten started ones.', area_id: 'ar_work', auto: 'milestones', horizon: 'year', seed_key: 'tpl:side_project',
    target_date: addDays(today(), 300), next_step: 'Write the one-page plan',
  });
  addMs('g2_side', 'Write the one-page plan', addDays(today(), -6), iso(Date.now() - 6 * 86400000));
  addMs('g2_side', 'Build the first version', addDays(today(), 30));
  addMs('g2_side', 'Show it to 3 people', addDays(today(), 60));
  addMs('g2_side', 'Ship it', addDays(today(), 150));
})();

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 1 }));
const halfway = (a: number, b: number) => round(a + (b - a) / 2, 2);

function currentOf(g: GoalRow): number | null {
  if (g.auto === 'savings:car') return savings().find((s) => s.id === 's_car')?.saved_usd ?? null;
  if (g.auto === 'milestones') return milestones.filter((m) => m.goal_id === g.id && m.done_at).length;
  const v = goalValues.get(g.id);
  return v?.length ? v[v.length - 1]!.value : null;
}
function linksOf(g: GoalRow): GoalLink[] {
  const ws = weekStart(today());
  return (goalLinks.get(g.id) ?? []).map((l) => {
    if (l.kind === 'habit') {
      const h = habits.find((x) => x.id === l.ref);
      return { kind: 'habit', ref: l.ref, name: h?.name ?? null, this_week: sumDays(ws, today(), habitChecksOn), target_per_week: 4 };
    }
    const p = projects.find((x) => x.id === l.ref || x.name === l.ref);
    return { kind: 'project', ref: l.ref, name: p?.name ?? l.ref, open_tasks: tasks.filter((t) => t.project_id === p?.id && t.status === 'open' && !t.deleted_at).length };
  });
}
function goalView(g: GoalRow): GoalV2 {
  const d = today();
  const ms = milestones.filter((m) => m.goal_id === g.id).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const current = g.status === 'paused' && g.auto === null && !goalValues.get(g.id)?.length ? null : currentOf(g);
  const target = g.auto === 'milestones' ? ms.length || null : g.target_value;
  const start = g.start_value ?? 0;
  const startDay = g.start_day ?? g.created_at.slice(0, 10);
  let progress: number | null = null, expected: number | null = null, pace: number | null = null, letter: string | null = null;
  let weeksLeft: number | null = null, perWeek: number | null = null, frac: number | null = null;
  if (current !== null && target !== null && target !== start) progress = round(Math.max(0, Math.min(1, (current - start) / (target - start))), 3);
  if (g.target_date) {
    const total = Math.max(1, daysBetween(startDay, g.target_date));
    const left = daysBetween(d, g.target_date);
    weeksLeft = round(Math.max(0, left) / 7, 1);
    if (target !== null && current !== null && target !== start) {
      frac = Math.max(0, Math.min(1, daysBetween(startDay, d) / total));
      expected = round(start + (target - start) * frac, 2);
      pace = frac <= 0 ? null : round((current - start) / (target - start) / frac, 3);
      const remaining = target - current;
      perWeek = left > 0 && (target > start ? remaining > 0 : remaining < 0) ? round(Math.abs(remaining) / Math.max(1, left / 7), 1) : null;
    }
  }
  const unit = g.unit ? ` ${g.unit}` : '';
  const reached = current !== null && target !== null && (target >= start ? current >= target : current <= target);
  let line: string;
  if (g.status === 'done' || reached) line = 'Reached.';
  else if (g.status === 'paused') line = 'Paused. Pace and dates wait until you resume.';
  else if (current === null) line = g.auto ? 'No data yet from its source.' : 'No value logged yet.';
  else if (pace === null) line = target !== null ? `${fmt(current)} of ${fmt(target)}${unit}.` : `${fmt(current)}${unit}.`;
  else if (pace >= 1.05) line = 'Ahead of pace.';
  else if (pace >= 0.95) line = 'On pace.';
  else line = perWeek !== null ? `New pace: ${fmt(perWeek)}${unit}/week to arrive by ${g.target_date}.` : `Target day has come; ${fmt(Math.abs((target ?? 0) - current))}${unit} to go.`;
  const floor = target !== null ? (g.floor_value ?? halfway(start, target)) : null;
  if (!g.outcome && g.status === 'active' && pace !== null && !reached && current !== null && target !== null) {
    const floorPace = floor !== null && floor !== start && frac ? (current - start) / (floor - start) / frac : null;
    const moved = target > start ? current > start : current < start;
    letter = pace >= 0.95 ? 'A' : floorPace !== null && floorPace >= 0.95 ? 'B' : moved ? 'C' : 'D';
  }
  if (reached || g.status === 'done') letter = g.outcome ? null : 'A';
  const stretch = g.stretch_value;
  const stretchReached = stretch !== null && current !== null && (stretch >= start ? current >= stretch : current <= stretch);
  const nextMs = ms.find((m) => !m.done_at);
  const task = tasks.find((t) => t.goal_id === g.id && t.status === 'open' && !t.deleted_at);
  const next = g.next_step || task?.title || (nextMs ? `Milestone: ${nextMs.name}` : null);
  return {
    id: g.id, name: g.name, why: g.why, area_id: g.area_id, target_value: target, unit: g.unit, target_date: g.target_date,
    start_value: start, start_day: startDay, auto: g.auto, horizon: g.horizon, status: g.status, next_step: g.next_step, outcome: g.outcome,
    current, progress, expected, pace, letter, pace_line: line, weeks_left: weeksLeft, per_week_needed: perWeek, next,
    milestones: ms, links: linksOf(g), moment: null, floor, stretch_value: stretch, stretch_note: stretchReached ? 'Stretch reached.' : null,
    confidence: g.status === 'active' ? (pace === null ? 0.5 : round(Math.max(0.1, Math.min(0.95, pace * 0.8)), 2)) : null,
  };
}
/** Nearest open milestone due, else target date, else far away (api nearestDue). */
const nearestDue = (g: GoalV2) => g.milestones.filter((m) => !m.done_at && m.due).map((m) => m.due!).sort()[0] ?? g.target_date ?? '9999-12-31';
/** Nearest date first, then the goal closest to done (api byNearest). */
const byNearest = (a: GoalV2, b: GoalV2) => nearestDue(a).localeCompare(nearestDue(b)) || (b.progress ?? 0) - (a.progress ?? 0);
function tree(status: string): GoalTree {
  const views = goals.filter((g) => status === 'all' || g.status === 'active' || g.status === 'paused').map(goalView);
  const out: GoalTree['areas'] = areas.map((a) => ({ ...a, goals: views.filter((g) => g.area_id === a.id) }));
  const loose = views.filter((g) => !g.area_id || !areas.some((a) => a.id === g.area_id));
  if (loose.length) out.push({ id: null, key: null, name: 'No area', emoji: '•', vision: '', sort: 99, goals: loose });
  const c = views.filter((g) => g.status === 'active' && g.next && !g.outcome).sort(byNearest)[0];
  return {
    areas: out.filter((a) => a.goals.length || a.id), count: views.length, graded: views.filter((g) => g.letter !== null).length,
    next_up: c ? { goal_id: c.id, goal: c.name, next: c.next!, pace_line: c.pace_line } : null,
  };
}
const TEMPLATES: GoalTemplate[] = [
  { key: 'car_fund', name: 'Savings fund', area: 'money', auto: 'savings:car', unit: 'USD', horizon: 'year', why: 'Save toward one thing that matters.', next_step: 'Log this week’s savings transfer', needs: 'target_value, target_date', target_value: 9000 },
  { key: 'weight', name: 'Body weight', area: 'body', auto: 'body:weight', unit: 'kg', horizon: 'year', why: 'Shown as info; the gym and food logs are what you control.', next_step: 'Weigh in this morning', needs: 'target_value, target_date' },
  { key: 'gym', name: 'Gym sessions', area: 'body', auto: '', unit: 'sessions', horizon: 'year', why: 'Strength and energy.', next_step: 'Pack the gym bag', needs: 'target_value, target_date', target_value: 150 },
  { key: 'read_books', name: 'Read 12 books', area: 'learning', auto: null, unit: 'books', target_value: 12, horizon: 'year', why: 'One book a month.', next_step: 'Read 10 pages', needs: 'target_date (optional)' },
  { key: 'run_10k', name: 'Run a 10 km', area: 'body', auto: 'milestones', unit: 'steps', horizon: 'quarter', why: 'A clear finish line for fitness.', next_step: 'Go for a 20-minute run', needs: 'target_date (optional)',
    milestones: ['Run 3 km without stopping', 'Run 5 km', 'Run 8 km', 'Run 10 km'] },
  { key: 'side_project', name: 'Ship a side project', area: 'work', auto: 'milestones', unit: 'steps', horizon: 'year', why: 'One finished thing beats ten started ones.',
    next_step: 'Write the one-page plan', needs: 'target_date (optional)',
    milestones: ['Write the one-page plan', 'Build the first version', 'Show it to 3 people', 'Ship it'] },
];
function applyGoalInput(g: GoalRow, b: Record<string, unknown>) {
  if (typeof b.name === 'string' && b.name.trim()) g.name = b.name.trim();
  if (typeof b.why === 'string') g.why = b.why;
  if ('area' in b) g.area_id = areaByKey(str(b.area))?.id ?? null;
  if ('target_value' in b) g.target_value = optNum(b.target_value);
  if ('unit' in b) g.unit = str(b.unit) || null;
  if ('target_date' in b) g.target_date = str(b.target_date) || null;
  if ('start_value' in b) g.start_value = optNum(b.start_value);
  if ('auto' in b) g.auto = str(b.auto) || null;
  if (b.horizon === 'quarter' || b.horizon === 'year' || b.horizon === 'life') g.horizon = b.horizon;
  if (typeof b.next_step === 'string') g.next_step = b.next_step;
  if ('floor_value' in b) g.floor_value = optNum(b.floor_value);
  if ('stretch_value' in b) g.stretch_value = optNum(b.stretch_value);
  if (g.auto === 'body:weight') g.outcome = 1;
}
function whatIf(g: GoalRow, perWeek: number): WhatIf {
  const rw = runway();
  const FLOOR_USD = 900;
  const weeklyBurn = rw.weekly_burn_usd || 75;
  const per_week_usd = round(perWeek, 2);
  const left_usd = Math.max(0, round((g.target_value ?? 0) - (currentOf(g) ?? 0), 2));
  const weeks = per_week_usd > 0 ? Math.ceil(left_usd / per_week_usd) : null;
  const eta = weeks === null ? null : addDays(today(), weeks * 7);
  const spare = Math.max(0, rw.cash_usd - FLOOR_USD);
  const maxUsd = round(Math.max(0, spare / 4), 2);
  const monthly = (weeklyBurn + per_week_usd) * 4.33;
  return {
    goal: g.name, per_week: perWeek, per_week_usd, rate_estimated: false, left_usd, eta,
    on_time: eta && g.target_date ? eta <= g.target_date : null,
    runway_months_after: monthly > 0 ? round(rw.cash_usd / monthly, 1) : null,
    cash_floor_months: round(FLOOR_USD / (weeklyBurn * 4.33), 1),
    capped: perWeek > maxUsd, max_per_week_usd: Math.floor(maxUsd),
  };
}
function quarter(): Quarter {
  const d = today();
  const q = Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
  const weeks = 13;
  const views = goals.map(goalView);
  const wks = Array.from({ length: weeks }, (_, i) => weekGrades(addDays(weekStart(d), -7 * i))).reverse();
  const lines = [
    `# ${d.slice(0, 4)} Q${q} review`, '',
    '## Weeks', ...wks.map((w) => `- ${w.week_start}: ${w.facts.length ? w.facts.join(', ') : 'nothing logged'}`), '',
    '## Goals', ...views.map((g) => `- ${g.name}: ${g.pace_line}`), '',
    '## Milestones reached', ...milestones.filter((m) => m.done_at).map((m) => `- ${m.name} (${m.done_at!.slice(0, 10)})`),
  ];
  return { path: `Reviews/${d.slice(0, 4)}-Q${q}.md`, weeks, milestones: milestones.filter((m) => m.done_at).length, goals: views.length, content: lines.join('\n') };
}
function history(n: number): GradeWeek[] {
  const out: GradeWeek[] = [];
  for (let i = 0; i < n; i++) {
    const ws = addDays(weekStart(today()), -7 * i);
    const g = weekGrades(ws);
    out.push({ week_start: ws, overall: g.overall.letter, areas: Object.fromEntries(g.areas.map((a) => [a.key, a.letter])) });
  }
  return out;
}

// ---------- done-log, next step (mirror api grades/store) ----------
const lifeDayOf = (isoStr: string) => new Date(Date.parse(isoStr) - 4 * 3600000).toISOString().slice(0, 10);
const doneList = (from: string, to: string) => doneTasksBetween(from, to).map((t) => ({ title: t.title, project: t.project_name ?? null, at: t.done_at!, day: lifeDayOf(t.done_at!) }));
const rangeOf = (range: DoneRange, d: string): [string, string] => (range === 'day' ? [d, d] : range === 'week' ? [weekStart(d), d] : [`${d.slice(0, 7)}-01`, d]);
function doneTotals(from: string, to: string): DoneTotals {
  const c = doneCounts(from, to);
  return { tasks: doneList(from, to).length, gym: workoutsBetween(from, to), food_days: sumDays(from, to, (d) => (foodEntriesOn(d) > 0 ? 1 : 0)),
    habits: c.habit_checks, cards: c.cards_reviewed, money_saved_usd: 0 };
}
function totalsLine(label: string, t: DoneTotals): string {
  const p: string[] = [];
  const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (t.gym) p.push(s(t.gym, 'gym session'));
  if (t.food_days) p.push(`${s(t.food_days, 'food day')} logged`);
  if (t.habits) p.push(s(t.habits, 'habit check'));
  if (t.cards) p.push(`${s(t.cards, 'card')} reviewed`);
  if (t.money_saved_usd) p.push(`$${fmt(t.money_saved_usd)} saved`);
  if (t.tasks) p.push(`${s(t.tasks, 'task')} done`);
  return p.length ? `${label}: ${p.join(', ')}.` : `${label}: nothing logged yet.`;
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const wdOf = (d: string) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()]!;
function doneLog(range: DoneRange): DoneLog {
  const d = today();
  const [from, to] = rangeOf(range, d);
  const entries: { day: string; at: string; kind: string; line: string }[] = [];
  for (const r of doneList(from, to)) {
    const proj = r.project && !/^inbox$/i.test(r.project) ? ` (${r.project})` : '';
    entries.push({ day: r.day, at: r.at, kind: 'task', line: `${wdOf(r.day)} · ${r.title}${proj}` });
  }
  entries.sort((a, b2) => a.day.localeCompare(b2.day) || a.at.localeCompare(b2.at));
  const totals = doneTotals(from, to);
  const month = range === 'month' ? totals : doneTotals(rangeOf('month', d)[0], d);
  return { range, from, to, entries: entries.map(({ day, kind, line }) => ({ day, kind, line })), totals, month, month_line: totalsLine('This month', month) };
}
const VERB_FIRST = /^(send|write|build|finish|fix|log|read|do|call|apply|review|plan|draft|ship|make|open|set|add|learn|practice|go|update|book|pay|move|check|clean|weigh|list|record|publish|launch|prepare|study|watch|message|email|run|save|transfer|pick|find)\b/i;
const trim45 = (x: string) => {
  const t = x.replace(/\s+/g, ' ').trim();
  if (t.length <= 44) return t;
  const cut = t.slice(0, 43).replace(/\s+\S*$/, '');
  return `${cut || t.slice(0, 43)}…`;
};
function nextSteps(): NextSteps {
  const views = goals.filter((g) => g.status === 'active' && !g.outcome).map(goalView).filter((g) => g.pace_line !== 'Reached.');
  const steps: NextSteps['steps'] = [];
  for (const a of areas) {
    const g = views.filter((x) => x.area_id === a.id).sort(byNearest)[0];
    if (!g) continue;
    const ms = g.milestones.find((m) => !m.done_at) ?? null;
    const step = (g.next_step ?? '').trim();
    const task = step && VERB_FIRST.test(step) ? step : ms ? `Finish: ${ms.name}` : g.next && VERB_FIRST.test(g.next) ? g.next : `Do one step on ${g.name}`;
    steps.push({ area: a.key ?? a.name, goal_id: g.id, goal: g.name, milestone: ms?.name ?? null, milestone_due: ms?.due ?? null,
      task: trim45(task), est_minutes: 25, pace_line: g.pace_line });
  }
  return { day: today(), avoid_window: { slot: 'afternoon', from: '14:00', to: '17:00' }, steps };
}

// ---------- router ----------

export function handleGrades(c: Ctx): Res | null {
  const { route, qp, b } = c;
  let m: string[] | null;

  if (route === 'GET /grades/week') return ok(weekGrades(qp.get('week')));
  if (route === 'GET /grades/history') return ok(history(Math.max(1, Math.min(26, num(qp.get('weeks'), 8)))));
  if (route === 'PUT /grades/targets') {
    if (!setTarget(str(b.area), str(b.input), num(b.target, NaN))) return bad('Unknown area or input.');
    return ok({ ok: true, area: str(b.area), input: str(b.input), target: num(b.target) });
  }
  if (route === 'GET /grades/areas') return ok(areas);
  if ((m = match(route, /^PATCH \/grades\/areas\/([^/]+)$/))) {
    const a = areaByKey(m[0]);
    if (!a) return notFound('Area');
    if (typeof b.name === 'string' && b.name.trim()) a.name = b.name.trim();
    if (typeof b.emoji === 'string' && b.emoji) a.emoji = b.emoji;
    if (typeof b.vision === 'string') a.vision = b.vision;
    return ok(a);
  }
  if (route === 'POST /grades/quarter-export' || route === 'GET /grades/quarter') return ok(quarter());
  if (route === 'POST /grades/change') {
    const wk = str(b.week);
    if (wk && !/^\d{4}-\d{2}-\d{2}$/.test(wk)) return bad('week must be YYYY-MM-DD');
    const ws = weekStart(wk || today());
    const own = str(b.text).trim();
    if (own.length > 200) return bad('text is too long');
    const body = own || weekGrades(ws).change?.text;
    if (!body) return bad('nothing to accept: write the change you want');
    changes.set(ws, { text: body, edited: !!own });
    return ok(weekGrades(ws).change);
  }

  if (route === 'GET /done-log') {
    const r = (qp.get('range') || 'week') as DoneRange;
    if (!['day', 'week', 'month'].includes(r)) return bad('range must be day, week or month');
    return ok(doneLog(r));
  }
  if (route === 'GET /goals2/next-step') return ok(nextSteps());

  // day rating
  if (route === 'GET /day-rating') return ok(ratingOut(ratings.get(qp.get('day') || today())));
  if (route === 'PUT /day-rating') {
    const rating = Math.round(num(b.rating, NaN));
    if (!(rating >= 1 && rating <= 5)) return bad('Rating is 1 to 5.');
    const day = str(b.day) || today();
    const tags = Array.isArray(b.tags) ? b.tags.map(String).filter((t) => RATING_TAGS.includes(t)) : (ratings.get(day)?.tags ?? []);
    const row: RatingRow = { day, rating, note: str(b.note), tags };
    ratings.set(day, row);
    return ok(ratingOut(row));
  }
  if (route === 'DELETE /day-rating') {
    ratings.delete(qp.get('day') || today());
    return ok({ ok: true });
  }
  if (route === 'GET /day-rating/tags') return ok(RATING_TAGS);
  if (route === 'GET /ratings/patterns') return ok(patterns());

  // quiet areas
  if (route === 'GET /areas/quiet') return ok(quiet());
  if ((m = match(route, /^POST \/areas\/quiet\/([^/]+)\/dismiss$/))) {
    const until = addDays(today(), 7);
    quietDismissed.set(m[0]!, until);
    return ok({ area: m[0], until });
  }
  if ((m = match(route, /^POST \/areas\/quiet\/([^/]+)\/start$/))) {
    const option = str(b.option).trim();
    if (!option) return bad('Pick an option.');
    const a = areaByKey(m[0]);
    const proj = projects.find((p) => p.name === (a?.key === 'learning' ? 'Learning' : a?.key === 'work' ? 'Work' : 'Personal'));
    const t = tasks.find((x) => x.title === option && x.status === 'open');
    if (t) return ok({ ok: true, task: t });
    const nt = { ...tasks[0]!, id: uid('t'), title: option, project_id: proj?.id ?? null, project_name: proj?.name ?? null, status: 'open' as const, due_date: today(), done_at: null, deleted_at: null, created_at: iso(), updated_at: iso(), est_minutes: 15, first_action: null, done_def: null, goal_id: null, pinned: false };
    tasks.push(nt);
    return created({ ok: true, task: nt });
  }

  // goals2 (static paths first)
  if (route === 'GET /goals2') return ok(tree(qp.get('status') ?? 'active'));
  if (route === 'GET /goals2/templates') return ok(TEMPLATES);
  if (route === 'POST /goals2/from-template') {
    const t = TEMPLATES.find((x) => x.key === str(b.key));
    if (!t) return notFound('Template');
    const seeded = t.area === 'work' ? goals.find((x) => x.seed_key === `tpl:${t.key}`) : undefined;
    if (seeded) return created(goalView(seeded));
    const g = mkGoal({
      seed_key: t.area === 'work' ? `tpl:${t.key}` : null, target_date: t.target_date ?? null,
      id: idOf(b, 'g2'), name: t.name, why: t.why, area_id: areaByKey(t.area)?.id ?? null, target_value: t.target_value ?? null, unit: t.unit,
      auto: t.auto || null, horizon: t.horizon as GoalRow['horizon'], next_step: t.next_step, start_value: t.auto === 'body:weight' ? null : 0,
    });
    applyGoalInput(g, Object.fromEntries(Object.entries(b).filter(([k, v]) => k !== 'key' && k !== 'id' && v !== undefined)));
    if (t.key === 'car_fund') g.target_date ??= addDays(today(), 210);
    if (t.milestones && !milestones.some((m) => m.goal_id === g.id)) for (const n of t.milestones) addMs(g.id, n, null);
    return created(goalView(g));
  }
  if (route === 'POST /goals2') {
    if (!str(b.name).trim()) return bad('Name is required.');
    const g = mkGoal({ id: idOf(b, 'g2'), name: str(b.name).trim(), start_value: 0 });
    applyGoalInput(g, b);
    return created(goalView(g));
  }
  if ((m = match(route, /^POST \/goals2\/([^/]+)\/milestones$/))) {
    const g = goals.find((x) => x.id === m![0]);
    if (!g) return notFound('Goal');
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    return created(addMs(g.id, name, str(b.due) || null));
  }
  if ((m = match(route, /^GET \/goals2\/([^/]+)\/whatif$/))) {
    const g = goals.find((x) => x.id === m![0]);
    if (!g) return notFound('Goal');
    return ok(whatIf(g, Math.max(0, num(qp.get('per_week'), 0))));
  }
  if ((m = match(route, /^POST \/goals2\/([^/]+)\/(repace|shrink|pause|resume|finish|reopen)$/))) {
    const g = goals.find((x) => x.id === m![0]);
    if (!g) return notFound('Goal');
    const act = m[1];
    if (act === 'repace') {
      // Only the date moves: start day and start value stay, so progress so far still counts (api repaceGoal).
      const td = str(b.target_date);
      if (td && td <= today()) return bad('target_date must be after today');
      if (td) g.target_date = td;
      else {
        const v = goalView(g);
        const old = g.target_date ?? today();
        const done = v.current !== null && v.start_value !== null ? Math.abs(v.current - v.start_value) : 0;
        const left = v.current !== null && v.target_value !== null ? Math.abs(v.target_value - v.current) : 0;
        const days = Math.max(1, daysBetween(v.start_day ?? today(), today()));
        let proj = addDays(old, 28);
        if (done > 0 && left > 0) proj = addDays(today(), Math.ceil(left / (done / days)));
        if (proj < old) proj = addDays(old, 28);
        const min = addDays(today(), 7);
        g.target_date = proj < min ? min : proj;
      }
    } else if (act === 'shrink') {
      if (g.target_value === null) return bad('This goal has no number to shrink.');
      const start = g.start_value ?? 0;
      g.target_value = round(start + (g.target_value - start) * 0.75, 0);
    } else if (act === 'pause') { g.status = 'paused'; g.paused_at = today(); }
    else if (act === 'resume') {
      // Start day stays; the target date moves by the paused days (api resumeGoal).
      if (g.status !== 'paused') return bad('goal is not paused');
      const days = g.paused_at ? Math.max(0, daysBetween(g.paused_at, today())) : 0;
      if (g.target_date && days) g.target_date = addDays(g.target_date, days);
      g.status = 'active'; g.paused_at = null;
    } else if (act === 'reopen') { g.status = 'active'; g.paused_at = null; }
    else if (act === 'finish') g.status = b.status === 'dropped' ? 'dropped' : 'done';
    return ok(goalView(g));
  }
  if ((m = match(route, /^(GET|PATCH|DELETE) \/goals2\/([^/]+)$/))) {
    const i = goals.findIndex((x) => x.id === m![1]);
    if (i < 0) return notFound('Goal');
    const g = goals[i]!;
    if (m[0] === 'DELETE') {
      goals.splice(i, 1);
      for (let k = milestones.length - 1; k >= 0; k--) if (milestones[k]!.goal_id === g.id) milestones.splice(k, 1);
      return ok({ ok: true });
    }
    if (m[0] === 'PATCH') {
      applyGoalInput(g, b);
      if ('current' in b && optNum(b.current) !== null && !g.auto) {
        const list = goalValues.get(g.id) ?? [];
        list.push({ day: today(), value: optNum(b.current)! });
        goalValues.set(g.id, list);
      }
      return ok(goalView(g));
    }
    const values = [...(goalValues.get(g.id) ?? [])];
    const cur = currentOf(g);
    if (g.auto && cur !== null) values.push({ day: today(), value: cur });
    const linked = tasks
      .filter((t) => !t.deleted_at && (t.goal_id === g.id || (goalLinks.get(g.id) ?? []).some((l) => l.kind === 'project' && t.project_name === l.ref)))
      .slice(0, 20)
      .map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date }));
    return ok({ ...goalView(g), values, tasks: linked });
  }

  // milestones
  if ((m = match(route, /^POST \/milestones\/([^/]+)\/done$/))) {
    const ms = milestones.find((x) => x.id === m![0]);
    if (!ms) return notFound('Milestone');
    const done = b.done !== false;
    ms.done_at = done ? iso() : null;
    const g = goals.find((x) => x.id === ms.goal_id);
    const left = milestones.filter((x) => x.goal_id === ms.goal_id && !x.done_at).length;
    const moment = done && g ? `${ms.name}: reached. ${left ? `${left} milestone${left === 1 ? '' : 's'} left on ${g.name}.` : `All milestones on ${g.name} are reached.`}` : undefined;
    return ok({ milestone: ms, goal: g?.name ?? null, moment });
  }
  if ((m = match(route, /^DELETE \/milestones\/([^/]+)$/))) {
    const i = milestones.findIndex((x) => x.id === m![0]);
    if (i < 0) return notFound('Milestone');
    milestones.splice(i, 1);
    return ok({ ok: true });
  }

  return null;
}
