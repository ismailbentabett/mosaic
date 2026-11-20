// Grades + goals v2 (migration v14).
// Area grades: per life area, the mean of min(1, actual / target) over the inputs he actually uses (any data in the last
// 28 days), letters A/B/C/D, never F. An area with nothing logged this week is "not graded". Saturday is rest and is
// left out of the count; a week under 3 active days is not graded.
// Goal grades: pace against a straight line from start to target. Outcome goals (weight) show info, no letter.
// Wording rules: no streaks, no red, no "behind", "missed" or "overdue". Under pace reads "new pace: X/week".
import { AppError } from '../../errors.ts';
import { addDays, daysBetween, dowOf, isDate, lifeDay, lifeToday, weekStartOf, weekdayOf } from '../../time.ts';
import { all, idOr, insert, j, need, now, one, patch, round, run, softDelete, uuid } from '../util.ts';

// Default floor: half way, kept whole when start and target are whole (no "0.5 books").
const halfway = (start: number, target: number): number => {
  const h = start + 0.5 * (target - start);
  if (!Number.isInteger(start) || !Number.isInteger(target)) return round(h, 2);
  return target >= start ? Math.ceil(h) : Math.floor(h);
};
import type { Row } from '../util.ts';
import { listSavingsGoals, runway } from '../money/store.ts';
import { addAsk, hardestWindow } from '../profile/store.ts';
import { addTask } from '../tasks/store.ts';
import { kvGet } from '../../db.ts';
import { resolveVaultPath } from '../../notes.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
const clean = (s: unknown, max: number, what: string, required = true): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (required && !t) bad(`${what} is required`);
  if (t.length > max) bad(`${what} max ${max} characters`);
  return t;
};
const hasTable = (name: string) => !!one(`SELECT 1 AS x FROM sqlite_master WHERE type IN ('table','view') AND name = ?`, name);
const num = (sql: string, ...p: unknown[]): number => {
  try { return Number(one<{ n: number }>(sql, ...p)?.n ?? 0) || 0; } catch { return 0; }
};
/** Count rows whose ISO timestamp column falls on life-days [from, to] (04:00 rollover). */
const isoCount = (table: string, col: string, from: string, to: string, extra = '', ...p: unknown[]): number => {
  if (!hasTable(table)) return 0;
  const lo = `${addDays(from, -1)}T00:00:00Z`, hi = `${addDays(to, 2)}T00:00:00Z`;
  const rows = all<{ at: string }>(`SELECT ${col} AS at FROM ${table} WHERE ${col} >= ? AND ${col} < ? ${extra}`, lo, hi, ...p);
  return rows.filter((r) => { const d = lifeDay(new Date(r.at)); return d >= from && d <= to; }).length;
};

// ---------- letters ----------
export const LETTERS = [{ letter: 'A', min: 0.85 }, { letter: 'B', min: 0.65 }, { letter: 'C', min: 0.4 }, { letter: 'D', min: 0 }] as const;
export const letterOf = (score: number | null): string | null => (score === null ? null : LETTERS.find((l) => score >= l.min)!.letter);
const nextMin = (score: number) => { const up = [...LETTERS].reverse().find((l) => l.min > score + 1e-9); return up ? up.min : null; };

// ---------- areas ----------
export const DEFAULT_AREAS = [
  { key: 'body', name: 'Body', emoji: '🏋️', vision: 'Strong, fed well, rested.' },
  { key: 'money', name: 'Money', emoji: '💵', vision: 'Know where every dollar goes; savings on track.' },
  { key: 'work', name: 'Work', emoji: '🚀', vision: 'Steady progress on the work that matters.' },
  { key: 'learning', name: 'Learning', emoji: '📚', vision: 'Learn a little every week.' },
  { key: 'people', name: 'People', emoji: '👪', vision: 'Family and friends hear from me.' },
  { key: 'home', name: 'Home', emoji: '🏠', vision: 'Chores done before they pile up.' },
] as const;
export type AreaKey = (typeof DEFAULT_AREAS)[number]['key'] | 'other';

/** Make sure every default area exists and carries its key. Existing areas with the same name are adopted. */
export const ensureAreas = () => {
  DEFAULT_AREAS.forEach((a, i) => {
    if (one(`SELECT id FROM areas WHERE key = ? AND deleted_at IS NULL`, a.key)) return;
    const byName = one<{ id: string }>(`SELECT id FROM areas WHERE deleted_at IS NULL AND key IS NULL AND lower(name) = lower(?)`, a.name);
    if (byName) { run(`UPDATE areas SET key = ?, emoji = CASE WHEN emoji = '' THEN ? ELSE emoji END, updated_at = ? WHERE id = ?`, a.key, a.emoji, now(), byName.id); return; }
    insert('areas', { id: uuid(), name: a.name, sort: i, key: a.key, emoji: a.emoji, vision: a.vision });
  });
};
export const listAreas = () => { ensureAreas(); return all<Row>(`SELECT * FROM areas WHERE deleted_at IS NULL ORDER BY sort, name`); };
export const findArea = (ref: string) => need(one<Row>(`SELECT * FROM areas WHERE deleted_at IS NULL AND (id = ? OR key = ? OR lower(name) = lower(?))`, ref, ref, ref), `area ${ref}`);
export const addArea = (a: { id?: string; name: string; emoji?: string; vision?: string }) => {
  const row = { id: idOr(a.id), name: clean(a.name, 40, 'name'), emoji: clean(a.emoji ?? '', 8, 'emoji', false), vision: clean(a.vision ?? '', 300, 'vision', false),
    sort: num(`SELECT COALESCE(MAX(sort),0)+1 AS n FROM areas`) };
  insert('areas', row);
  return findArea(row.id);
};
export const updateArea = (ref: string, f: { name?: string; emoji?: string; vision?: string; sort?: number }) => {
  const a = findArea(ref);
  const up: Row = {};
  if (f.name !== undefined) up.name = clean(f.name, 40, 'name');
  if (f.emoji !== undefined) up.emoji = clean(f.emoji, 8, 'emoji', false);
  if (f.vision !== undefined) up.vision = clean(f.vision, 300, 'vision', false);
  if (f.sort !== undefined) up.sort = Math.round(Number(f.sort)) || 0;
  if (Object.keys(up).length) patch('areas', a.id, up);
  return findArea(a.id);
};

// ---------- targets ----------
type Input = { key: string; label: string; unit: string; target: number; actual: number; used: boolean };
const override = (area: string, input: string, dflt: number) => {
  const r = one<{ target: number }>(`SELECT target FROM grade_targets WHERE area_key = ? AND input = ?`, area, input);
  return r ? Number(r.target) : dflt;
};
export const setGradeTarget = (area: string, input: string, target: number) => {
  if (!Number.isFinite(target) || target <= 0 || target > 100000) bad('target must be a positive number');
  run(`INSERT INTO grade_targets (area_key, input, target, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (area_key, input) DO UPDATE SET target = excluded.target, updated_at = excluded.updated_at`, clean(area, 20, 'area'), clean(input, 80, 'input'), target, now());
  return { area, input, target };
};
const profileNum = (key: string): number | null => {
  const r = hasTable('profile_facts') ? one<{ value: string }>(`SELECT value FROM profile_facts WHERE key = ?`, key) : undefined;
  const v = r ? Number(j(r.value, r.value)) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
};

// ---------- week window ----------
/** Active days (not Saturday) in [ws, min(we, today)]. */
const activeDays = (from: string, to: string) => {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (dowOf(d) !== 6) n++;
  return n;
};

/** Raw inputs for an area over [from, to]. used = he logs this kind of thing (any row in the 28 days before `to`). */
const inputsFor = (area: AreaKey, from: string, to: string): Input[] => {
  const look = addDays(to, -27);
  const out: Input[] = [];
  const add = (key: string, label: string, unit: string, dflt: number, actual: number, used: boolean) =>
    out.push({ key, label, unit, target: override(area, key, dflt), actual: round(actual, 1), used });
  const T = (t: string) => hasTable(t);
  if (area === 'body') {
    if (T('workouts')) {
      const w = (a: string, b: string) => num(`SELECT COUNT(DISTINCT day) AS n FROM workouts WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, a, b);
      add('gym', 'gym days', 'days', profileNum('gym.days_per_week') ?? 5, w(from, to), w(look, to) > 0);
    }
    if (T('food_log')) {
      const f = (a: string, b: string) => num(`SELECT COUNT(DISTINCT day) AS n FROM food_log WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, a, b);
      add('food', 'food days logged', 'days', 5, f(from, to), f(look, to) > 0);
    }
    if (T('body_metrics')) {
      const b = (a: string, c: string) => num(`SELECT COUNT(DISTINCT day) AS n FROM body_metrics WHERE deleted_at IS NULL AND kind = 'weight' AND day >= ? AND day <= ?`, a, c);
      add('weigh', 'weigh-ins', 'days', 2, b(from, to), b(look, to) > 0);
    }
  }
  if (area === 'money' && T('records')) {
    const m = (a: string, b: string) => num(`SELECT COUNT(DISTINCT r.day) AS n FROM records r JOIN accounts ac ON ac.id = r.account_id
      WHERE r.deleted_at IS NULL AND ac.track = 'personal' AND r.kind = 'expense' AND r.day >= ? AND r.day <= ?`, a, b);
    add('expense_days', 'days with expenses logged', 'days', 5, m(from, to), m(look, to) > 0);
  }
  if (area === 'work') {
    if (T('tasks')) {
      const extra = `AND status = 'done' AND deleted_at IS NULL`;
      add('tasks', 'tasks done', 'tasks', 10, isoCount('tasks', 'done_at', from, to, extra), isoCount('tasks', 'done_at', look, to, extra) > 0);
    }
    if (T('focus_sessions')) {
      const lo = `${addDays(from, -1)}T00:00:00Z`, hi = `${addDays(to, 2)}T00:00:00Z`;
      const mins = (a: string, b: string) => all<{ at: string; m: number }>(`SELECT started_at AS at, minutes AS m FROM focus_sessions WHERE deleted_at IS NULL AND started_at >= ? AND started_at < ?`,
        `${addDays(a, -1)}T00:00:00Z`, `${addDays(b, 2)}T00:00:00Z`).filter((r) => { const d = lifeDay(new Date(r.at)); return d >= a && d <= b; }).reduce((s, r) => s + Number(r.m), 0);
      void lo; void hi;
      add('focus', 'focus minutes', 'min', 750, mins(from, to), mins(look, to) > 0);
    }
  }
  if (area === 'learning') {
    if (T('card_reviews')) add('cards', 'cards reviewed', 'cards', 50, isoCount('card_reviews', 'at', from, to), isoCount('card_reviews', 'at', look, to) > 0);
  }
  if (area === 'people') {
    if (T('person_contacts')) {
      const pc = (a: string, b: string) => num(`SELECT COUNT(*) AS n FROM person_contacts WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, a, b);
      add('contacts', 'people contacted', 'contacts', 3, pc(from, to), pc(look, to) > 0);
    }
    if (T('promises')) {
      const due = num(`SELECT COUNT(*) AS n FROM promises WHERE deleted_at IS NULL AND status <> 'released' AND due >= ? AND due <= ?`, from, to);
      const kept = num(`SELECT COUNT(*) AS n FROM promises WHERE deleted_at IS NULL AND status = 'kept' AND closed_day >= ? AND closed_day <= ?`, from, to);
      if (due > 0) add('promises', 'promises kept', 'kept', due, kept, true);
    }
  }
  if (area === 'home' && T('last_done')) {
    add('chores', 'chores stamped', 'chores', 3, isoCount('last_done', 'last_at', from, to, 'AND deleted_at IS NULL'), isoCount('last_done', 'last_at', look, to, 'AND deleted_at IS NULL') > 0);
  }
  // Habits attached to this area (or unassigned habits for 'other').
  if (T('habits')) {
    const areaRow = area === 'other' ? null : one<{ id: string }>(`SELECT id FROM areas WHERE key = ? AND deleted_at IS NULL`, area);
    if (area === 'other' || areaRow) {
      const hs = area === 'other'
        ? all<Row>(`SELECT * FROM habits WHERE deleted_at IS NULL AND archived = 0 AND (area_id IS NULL OR area_id NOT IN (SELECT id FROM areas WHERE deleted_at IS NULL))`)
        : all<Row>(`SELECT * FROM habits WHERE deleted_at IS NULL AND archived = 0 AND area_id = ?`, areaRow!.id);
      for (const h of hs) {
        const c = num(`SELECT COALESCE(SUM(count),0) AS n FROM habit_checks WHERE habit_id = ? AND deleted_at IS NULL AND day >= ? AND day <= ?`, h.id, from, to);
        add(`habit:${h.id}`, String(h.name), 'checks', Math.max(1, Math.min(7, Number(h.target_per_week) || 7)), c, true);
      }
    }
  }
  return out;
};

export type AreaGrade = {
  key: string; name: string; emoji: string; letter: string | null; score: number | null; status: 'graded' | 'not_graded' | 'light_week';
  facts: { key: string; label: string; actual: number; target: number; share: number; unit: string }[];
  lift: string | null;
};

const gradeArea = (key: AreaKey, name: string, emoji: string, from: string, to: string, scale: number, light: boolean): AreaGrade => {
  const ins = inputsFor(key, from, to).filter((i) => i.used);
  const facts = ins.map((i) => {
    const target = Math.max(1, Math.round(i.target * scale * 10) / 10);
    return { key: i.key, label: i.label, actual: i.actual, target, share: round(Math.min(1, i.actual / target), 2), unit: i.unit };
  });
  const base = { key, name, emoji, facts };
  if (light) return { ...base, letter: null, score: null, status: 'light_week', lift: null };
  if (!facts.length || facts.every((f) => f.actual <= 0)) return { ...base, letter: null, score: null, status: 'not_graded', lift: facts.length ? `Log one ${facts[0].label.replace(/s$/, '')} to see it here.` : null };
  const score = round(facts.reduce((s, f) => s + f.share, 0) / facts.length, 3);
  return { ...base, letter: letterOf(score), score, status: 'graded', lift: liftFor(score, facts) };
};

/** The single smallest thing that would raise this area to the next letter. */
const liftFor = (score: number, facts: AreaGrade['facts']): string | null => {
  const next = nextMin(score);
  if (next === null) return null;
  const need = (next - score) * facts.length; // share points needed in total
  let best: { f: AreaGrade['facts'][number]; units: number } | null = null;
  for (const f of facts) {
    const room = 1 - f.share;
    if (room + 1e-9 < need) continue;
    const units = Math.max(1, Math.ceil(need * f.target - 1e-9));
    if (!best || units / f.target < best.units / best.f.target) best = { f, units };
  }
  if (!best) {
    const f = [...facts].sort((a, b) => a.share - b.share)[0];
    const units = Math.max(1, Math.ceil((1 - f.share) * f.target));
    return `${units} more ${f.unit} of ${f.label} moves this up.`;
  }
  return `${best.units} more ${best.f.unit} of ${best.f.label} moves this up.`;
};

/** One suggested change for next week. Accepted/edited text is stored per week in review_changes. */
export type WeekChange = { text: string; area: string | null; input: string | null; accepted: boolean; edited: boolean };

/** Plain count fact, e.g. "4 gym days". */
const factLine = (f: AreaGrade['facts'][number]) => `${fmt(f.actual)} ${f.label}`;

/** Up to 3 plain count facts: one per area, the input closest to its target, only things that happened. */
const weekFacts = (areas: AreaGrade[]): string[] => {
  const out: { line: string; share: number }[] = [];
  for (const a of areas) {
    const best = a.facts.filter((f) => f.actual > 0).sort((x, y) => y.share - x.share)[0];
    if (best) out.push({ line: factLine(best), share: best.share });
  }
  return out.sort((x, y) => y.share - x.share).slice(0, 3).map((x) => x.line);
};

const reviewChangeRow = (ws: string) => (hasTable('review_changes')
  ? one<{ text: string; accepted_at: string | null; edited: number }>(`SELECT text, accepted_at, edited FROM review_changes WHERE week_start = ?`, ws) : undefined);

/** One suggested change: a fixed slot for the used input furthest from its target. Stored text wins. */
const weekChange = (ws: string, areas: AreaGrade[]): WeekChange | null => {
  const stored = reviewChangeRow(ws);
  if (stored) return { text: stored.text, area: null, input: null, accepted: !!stored.accepted_at, edited: !!stored.edited };
  let low: { a: AreaGrade; f: AreaGrade['facts'][number] } | null = null;
  for (const a of areas) for (const f of a.facts) if (!low || f.share < low.f.share) low = { a, f };
  if (!low || low.f.share >= 1) return null;
  const left = Math.max(1, Math.ceil(low.f.target - low.f.actual));
  return { text: `Next week: put ${low.f.label} in one fixed slot (${fmt(left)} ${low.f.unit} short of the usual).`,
    area: low.a.key, input: low.f.key, accepted: false, edited: false };
};

/** Accept the suggested change for a week, or replace it with your own text. */
export const setWeekChange = (week: string | undefined, text?: string, today = lifeToday()) => {
  if (week !== undefined && week !== '' && !isDate(week)) bad('week must be YYYY-MM-DD');
  const ws = weekStartOf(week || today);
  const g = gradesWeek(ws, today);
  const own = text === undefined || text === null || String(text).trim() === '' ? null : clean(text, 200, 'text');
  const body = own ?? g.change?.text ?? null;
  if (!body) bad('nothing to accept: write the change you want');
  const t = now();
  run(`INSERT INTO review_changes (week_start, text, accepted_at, edited, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (week_start) DO UPDATE SET text = excluded.text, accepted_at = excluded.accepted_at, edited = excluded.edited, updated_at = excluded.updated_at`,
    ws, body, t, own ? 1 : 0, t);
  return gradesWeek(ws, today).change;
};

export type WeekGrades = {
  week_start: string; week_end: string; so_far: boolean; active_days: number; light_week: boolean;
  /** Letters stay in the payload for older clients only. The app shows facts + change. */
  overall: { letter: string | null; score: number | null }; areas: AreaGrade[];
  best: string | null; lift: string | null; day_rating_avg: number | null;
  day_ratings: { day: string; rating: number }[]; day_rating_count: number; line: string;
  facts: string[]; change: WeekChange | null;
};

export const gradesWeek = (week?: string, today = lifeToday()): WeekGrades => {
  if (week !== undefined && !isDate(week)) bad('week must be YYYY-MM-DD');
  ensureAreas();
  const ws = weekStartOf(week ?? today), we = addDays(ws, 6);
  const soFar = today >= ws && today <= we;
  if (ws > today) bad('week is in the future');
  const to = soFar ? today : we;
  const act = activeDays(ws, to);
  const light = act < 3;
  const scale = act / 6;
  const areas = listAreas();
  const graded: AreaGrade[] = [];
  for (const a of areas) {
    if (!a.key) continue;
    graded.push(gradeArea(a.key as AreaKey, String(a.name), String(a.emoji ?? ''), ws, to, scale, light));
  }
  const other = gradeArea('other', 'Other habits', '✳️', ws, to, scale, light);
  if (other.facts.length) graded.push(other);
  const g = graded.filter((a) => a.score !== null);
  const overall = g.length ? round(g.reduce((s, a) => s + a.score!, 0) / g.length, 3) : null;
  const best = g.length ? [...g].sort((a, b) => b.score! - a.score!)[0] : null;
  const low = g.length ? [...g].sort((a, b) => a.score! - b.score!)[0] : null;
  const rated = all<{ day: string; rating: number }>(`SELECT day, rating FROM day_ratings WHERE deleted_at IS NULL AND day >= ? AND day <= ? ORDER BY day`, ws, to);
  const avg = rated.length ? round(rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length, 1) : null;
  const facts = weekFacts(graded);
  const line = facts.length ? `${soFar ? 'So far' : 'This week'}: ${facts.join(', ')}.`
    : light && soFar ? 'Early in the week. Counts show up as you log.' : 'Nothing logged this week yet.';
  return {
    week_start: ws, week_end: we, so_far: soFar, active_days: act, light_week: light,
    overall: { letter: light ? null : letterOf(overall), score: light ? null : overall }, areas: graded,
    best: best && !light ? best.name : null, lift: low && !light ? (low.lift ? `${low.name}: ${low.lift}` : null) : null,
    day_rating_avg: avg, day_ratings: rated.map((r) => ({ day: String(r.day), rating: Number(r.rating) })), day_rating_count: rated.length, line,
    facts, change: weekChange(ws, graded),
  };
};

/** Store a week's grades (finished weeks are frozen once stored; the current week is refreshed). */
export const snapshotWeek = (week?: string, today = lifeToday()) => {
  const g = gradesWeek(week, today);
  const t = now();
  for (const a of g.areas) {
    run(`INSERT INTO grade_weeks (week_start, area_key, letter, score, facts, computed_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (week_start, area_key) DO UPDATE SET letter = excluded.letter, score = excluded.score, facts = excluded.facts, computed_at = excluded.computed_at`,
      g.week_start, a.key, a.letter, a.score, JSON.stringify({ facts: a.facts, status: a.status }), t);
  }
  run(`INSERT INTO grade_weeks (week_start, area_key, letter, score, facts, computed_at) VALUES (?, '_overall', ?, ?, ?, ?)
       ON CONFLICT (week_start, area_key) DO UPDATE SET letter = excluded.letter, score = excluded.score, facts = excluded.facts, computed_at = excluded.computed_at`,
    g.week_start, g.overall.letter, g.overall.score, JSON.stringify({ light_week: g.light_week, day_rating_avg: g.day_rating_avg }), t);
  return g;
};

/** Last N weeks of letters per area (oldest first). Missing finished weeks are computed and stored. */
export const gradesHistory = (weeks = 8, today = lifeToday()) => {
  const n = Math.max(1, Math.min(52, Math.round(weeks)));
  const cur = weekStartOf(today);
  const out: { week_start: string; overall: string | null; areas: Record<string, string | null> }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const ws = addDays(cur, -7 * i);
    let rows = all<{ area_key: string; letter: string | null }>(`SELECT area_key, letter FROM grade_weeks WHERE week_start = ?`, ws);
    if (!rows.length || ws === cur) { snapshotWeek(ws, today); rows = all(`SELECT area_key, letter FROM grade_weeks WHERE week_start = ?`, ws); }
    const areas: Record<string, string | null> = {};
    let overall: string | null = null;
    for (const r of rows) { if (r.area_key === '_overall') overall = r.letter; else areas[r.area_key] = r.letter; }
    out.push({ week_start: ws, overall, areas });
  }
  return out;
};

// ---------- day rating ----------
/** Optional context tags on a day rating. Fixed list so patterns can be counted. */
export const RATING_TAGS = ['launch_used', 'gym', 'late_start', 'family_event', 'power_cut', 'outside'] as const;
const parseTags = (s: unknown): string[] => { try { const a = JSON.parse(String(s ?? '[]')); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; } catch { return []; } };
export const setDayRating = (rating: number, day = lifeToday(), note = '', tags?: string[]) => {
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  if (day > lifeToday()) bad('day is in the future');
  const r = Math.round(Number(rating));
  if (!(r >= 1 && r <= 5)) bad('rating must be 1–5');
  if (tags !== undefined) {
    if (!Array.isArray(tags)) bad('tags must be a list');
    const badTag = tags.find((x) => !(RATING_TAGS as readonly string[]).includes(x));
    if (badTag) bad(`tag must be one of ${RATING_TAGS.join(', ')}`);
  }
  const t = now();
  const tagJson = tags === undefined ? null : JSON.stringify([...new Set(tags)]);
  run(`INSERT INTO day_ratings (id, day, rating, note, tags, created_at, updated_at) VALUES (?, ?, ?, ?, COALESCE(?, '[]'), ?, ?)
       ON CONFLICT (day) DO UPDATE SET rating = excluded.rating, note = excluded.note, tags = COALESCE(?, day_ratings.tags), updated_at = excluded.updated_at, deleted_at = NULL`,
    uuid(), day, r, clean(note, 300, 'note', false), tagJson, t, t, tagJson);
  return getDayRating(day);
};
export const getDayRating = (day = lifeToday()) => {
  const r = one<Row>(`SELECT day, rating, note, tags FROM day_ratings WHERE day = ? AND deleted_at IS NULL`, day);
  return r ? { day: r.day, rating: Number(r.rating), note: r.note, tags: parseTags(r.tags) } : { day, rating: null, note: '', tags: [] as string[] };
};
export const clearDayRating = (day = lifeToday()) => { run(`UPDATE day_ratings SET deleted_at = ?, updated_at = ? WHERE day = ?`, now(), now(), day); return { day, rating: null }; };

// ---------- goals v2 ----------
export const AUTO_KINDS = ['savings', 'body:weight', 'cards:reviewed', 'gym:workouts', 'habit', 'project', 'milestones'] as const;
const autoOk = (a: string) => /^(savings:.{1,60}|body:weight|cards:reviewed|gym:workouts|habit:.{1,64}|project:.{1,80}|milestones)$/.test(a);

/** Current value from the auto source, or null. `since` = goal start day for counting sources. */
export const autoValue = (auto: string, since: string | null, today = lifeToday()): number | null => {
  const from = since ?? '0000-01-01';
  try {
    if (auto.startsWith('savings:')) {
      const name = auto.slice(8).toLowerCase();
      const g = listSavingsGoals(today).find((s) => String(s.name).toLowerCase().includes(name));
      return g ? Number(g.saved_usd) : null;
    }
    if (auto === 'body:weight') {
      const r = one<{ value: number }>(`SELECT value FROM body_metrics WHERE deleted_at IS NULL AND kind = 'weight' ORDER BY day DESC, created_at DESC LIMIT 1`);
      return r ? Number(r.value) : null;
    }
    if (auto === 'cards:reviewed') return isoCount('card_reviews', 'at', from, today);
    if (auto === 'gym:workouts') return num(`SELECT COUNT(*) AS n FROM workouts WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, from, today);
    if (auto.startsWith('habit:')) {
      const ref = auto.slice(6);
      const h = one<{ id: string }>(`SELECT id FROM habits WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref);
      return h ? num(`SELECT COALESCE(SUM(count),0) AS n FROM habit_checks WHERE habit_id = ? AND deleted_at IS NULL AND day >= ? AND day <= ?`, h.id, from, today) : null;
    }
    if (auto.startsWith('project:')) {
      const ref = auto.slice(8);
      const p = one<{ id: string }>(`SELECT id FROM projects WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref);
      return p ? isoCount('tasks', 'done_at', from, today, `AND status = 'done' AND deleted_at IS NULL AND project_id = ?`, p.id) : null;
    }
  } catch { return null; }
  return null;
};

const fmt = (n: number) => (Math.abs(n) >= 100 ? String(Math.round(n)) : String(round(n, 1)));

export type GoalView = Row & {
  current: number | null; progress: number | null; expected: number | null; pace: number | null; letter: string | null;
  pace_line: string; weeks_left: number | null; per_week_needed: number | null; next: string | null;
  milestones: Row[]; links: Row[]; moment: string | null;
  floor: number | null; stretch_note: string | null; confidence: number | null;
};

/** Latest weekly confidence answer (1–5) for a goal, from the last 14 days, or null. Copies answered asks into goal_confidence. */
const confidenceFor = (goalId: string, today: string): number | null => {
  try {
    const r = one<{ week_start: string; ask_key: string; value: number | null }>(
      `SELECT week_start, ask_key, value FROM goal_confidence WHERE goal_id = ? AND week_start >= ? ORDER BY week_start DESC LIMIT 1`, goalId, addDays(today, -14));
    if (!r) return null;
    if (r.value !== null && r.value !== undefined) return Number(r.value);
    const f = one<{ value: string }>(`SELECT value FROM profile_facts WHERE key = ?`, r.ask_key);
    if (!f) return null;
    let v: unknown = f.value; try { v = JSON.parse(String(f.value)); } catch { /* raw */ }
    const n = Math.round(Number(v));
    if (!(n >= 1 && n <= 5)) return null;
    run(`UPDATE goal_confidence SET value = ? WHERE week_start = ? AND goal_id = ?`, n, r.week_start, goalId);
    return n;
  } catch { return null; }
};

const milestonesOf = (id: string) => all<Row>(`SELECT * FROM goal_milestones WHERE goal_id = ? AND deleted_at IS NULL ORDER BY done_at IS NOT NULL, sort, due IS NULL, due, created_at`, id);
const linksOf = (id: string) => all<Row>(`SELECT * FROM goal_links WHERE goal_id = ? AND deleted_at IS NULL`, id).map((l) => {
  if (l.kind === 'habit') {
    const h = one<Row>(`SELECT id, name, target_per_week FROM habits WHERE id = ? AND deleted_at IS NULL`, l.ref);
    const ws = weekStartOf(lifeToday());
    return { ...l, name: h?.name ?? null, this_week: h ? num(`SELECT COALESCE(SUM(count),0) AS n FROM habit_checks WHERE habit_id = ? AND deleted_at IS NULL AND day >= ? AND day <= ?`, h.id, ws, addDays(ws, 6)) : 0, target_per_week: h?.target_per_week ?? null };
  }
  const p = one<Row>(`SELECT id, name FROM projects WHERE id = ? AND deleted_at IS NULL`, l.ref);
  return { ...l, name: p?.name ?? null, open_tasks: p ? num(`SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status = 'open' AND deleted_at IS NULL`, p.id) : 0 };
});

export const goalView = (g: Row, today = lifeToday()): GoalView => {
  const ms = milestonesOf(g.id);
  const links = linksOf(g.id);
  let current: number | null;
  if (g.auto === 'milestones') current = ms.filter((m) => m.done_at).length;
  else if (g.auto) current = autoValue(String(g.auto), g.start_day ?? null, today);
  else current = one<{ value: number }>(`SELECT value FROM goal_values WHERE goal_id = ? ORDER BY day DESC LIMIT 1`, g.id)?.value ?? null;
  const target = g.auto === 'milestones' ? ms.length || null : g.target_value === null || g.target_value === undefined ? null : Number(g.target_value);
  const start = g.start_value === null || g.start_value === undefined ? (g.auto === 'body:weight' ? null : 0) : Number(g.start_value);
  const startDay = g.start_day ?? String(g.created_at ?? '').slice(0, 10) ?? today;
  let progress: number | null = null, expected: number | null = null, pace: number | null = null, letter: string | null = null;
  let weeksLeft: number | null = null, perWeek: number | null = null, frac: number | null = null;
  let line = '';
  if (current !== null && target !== null && start !== null && target !== start) {
    progress = round(Math.max(0, Math.min(1, (current - start) / (target - start))), 3);
  }
  if (g.target_date && isDate(String(g.target_date))) {
    const total = Math.max(1, daysBetween(startDay, String(g.target_date)));
    const left = daysBetween(today, String(g.target_date));
    weeksLeft = round(Math.max(0, left) / 7, 1);
    if (target !== null && start !== null && current !== null && target !== start) {
      frac = Math.max(0, Math.min(1, daysBetween(startDay, today) / total));
      expected = round(start + (target - start) * frac, 2);
      const doneFrac = (current - start) / (target - start);
      pace = frac <= 0 ? null : round(doneFrac / frac, 3);
      const remaining = target - current;
      perWeek = left > 0 && (target > start ? remaining > 0 : remaining < 0) ? round(Math.abs(remaining) / Math.max(1, left / 7), 1) : null;
    }
  }
  const unit = g.unit ? ` ${g.unit}` : '';
  const reached = current !== null && target !== null && start !== null && (target >= start ? current >= target : current <= target);
  if (g.status === 'done' || reached) line = 'Reached.';
  else if (g.status === 'paused') line = 'Paused. Pace and dates wait until you resume.';
  else if (current === null) line = g.auto ? 'No data yet from its source.' : 'No value logged yet.';
  else if (pace === null) line = target !== null ? `${fmt(current)} of ${fmt(target)}${unit}.` : `${fmt(current)}${unit}.`;
  else if (pace >= 1.05) line = 'Ahead of pace.';
  else if (pace >= 0.95) line = 'On pace.';
  else line = perWeek !== null ? `New pace: ${fmt(perWeek)}${unit}/week to arrive by ${g.target_date}.` : `Target day has come; ${fmt(Math.abs((target ?? 0) - current))}${unit} to go.`;
  // Three lines: floor (half way by default), plan (target), stretch. A = on plan pace, B = on floor pace, C = any movement, D = not started.
  const floor = target !== null && start !== null
    ? (g.floor_value !== null && g.floor_value !== undefined ? Number(g.floor_value) : halfway(start, target)) : null;
  if (!g.outcome && g.status === 'active' && pace !== null && !reached && current !== null && start !== null && target !== null) {
    const floorPace = floor !== null && floor !== start && frac ? (current - start) / (floor - start) / frac : null;
    const moved = target > start ? current > start : current < start;
    letter = pace >= 0.95 ? 'A' : floorPace !== null && floorPace >= 0.95 ? 'B' : moved ? 'C' : 'D';
  }
  if (reached || g.status === 'done') letter = g.outcome ? null : 'A';
  const stretch = g.stretch_value === null || g.stretch_value === undefined ? null : Number(g.stretch_value);
  const stretchReached = stretch !== null && current !== null && start !== null && (stretch >= start ? current >= stretch : current <= stretch);
  const stretch_note = stretchReached ? 'Stretch reached.' : null;
  const nextMs = ms.find((m) => !m.done_at);
  const task = one<{ title: string }>(`SELECT title FROM tasks WHERE goal_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY pinned DESC, priority DESC, due_date IS NULL, due_date, created_at LIMIT 1`, g.id);
  const next = String(g.next_step ?? '') || task?.title || (nextMs ? `Milestone: ${nextMs.name}` : null);
  return { ...g, outcome: !!g.outcome, current, target_value: target, start_value: start, start_day: startDay, progress, expected, pace, letter, pace_line: line,
    weeks_left: weeksLeft, per_week_needed: perWeek, next, milestones: ms, links, moment: null,
    floor, stretch_value: stretch, stretch_note, confidence: g.status === 'active' ? confidenceFor(String(g.id), today) : null };
};

export const findGoal = (ref: string) => need(one<Row>(`SELECT * FROM goals WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?) OR seed_key = ?)`, ref, ref, ref), `goal ${ref}`);
export const goalDetail = (ref: string, today = lifeToday()) => {
  const g = goalView(findGoal(ref), today);
  const values = all<Row>(`SELECT day, value FROM goal_values WHERE goal_id = ? ORDER BY day DESC LIMIT 60`, g.id).reverse();
  const tasks = all<Row>(`SELECT id, title, status, due_date FROM tasks WHERE goal_id = ? AND deleted_at IS NULL ORDER BY status = 'done', created_at DESC LIMIT 30`, g.id);
  return { ...g, values, tasks };
};

/** Areas → goals, with grades. Paused/done goals at the end of each area. */
export const goalsTree = (today = lifeToday(), status: 'active' | 'all' = 'active') => {
  const areas = listAreas();
  const goals = all<Row>(`SELECT * FROM goals WHERE deleted_at IS NULL AND (? = 'all' OR status IN ('active','paused')) ORDER BY sort, target_date IS NULL, target_date, created_at`, status)
    .map((g) => goalView(g, today));
  const rank = (s: string) => (s === 'active' ? 0 : s === 'paused' ? 1 : 2);
  const byArea = (id: string | null) => goals.filter((g) => (id ? g.area_id === id : !g.area_id || !areas.some((a) => a.id === g.area_id)))
    .sort((a, b) => rank(String(a.status)) - rank(String(b.status)));
  const tree = areas.map((a) => ({ ...a, goals: byArea(a.id) }));
  const loose = byArea(null);
  if (loose.length) tree.push({ id: null, key: null, name: 'No area', emoji: '', vision: '', sort: 999, goals: loose });
  const graded = goals.filter((g) => g.letter);
  return { areas: tree, count: goals.length, graded: graded.length, next_up: nextUp(goals) };
};

/** Nearest due date among a goal's open milestones, else its target date, else far away. */
const nearestDue = (g: GoalView): string => {
  const ms = (g.milestones as Row[]).filter((m) => !m.done_at && m.due).map((m) => String(m.due)).sort()[0];
  return ms ?? (g.target_date ? String(g.target_date) : '9999-12-31');
};
/** Rank for "what to do next": nearest milestone/target date first, then the goal closest to done. */
const byNearest = (a: GoalView, b: GoalView) => nearestDue(a).localeCompare(nearestDue(b)) || (Number(b.progress ?? 0) - Number(a.progress ?? 0)) || (Number(a.sort ?? 0) - Number(b.sort ?? 0));

/** The nearest useful step: an active goal with a next step, nearest date first. Used by Home. Never written into calendar titles. */
const nextUp = (goals: GoalView[]) => {
  const c = goals.filter((g) => g.status === 'active' && g.next && !g.outcome).sort(byNearest)[0];
  return c ? { goal_id: c.id, goal: c.name, next: c.next, pace_line: c.pace_line } : null;
};
export const goalNextUp = (today = lifeToday()) => nextUp(all<Row>(`SELECT * FROM goals WHERE deleted_at IS NULL AND status = 'active'`).map((g) => goalView(g, today)));

export type GoalInput = {
  id?: string; name?: string; why?: string; area?: string | null; target_value?: number | null; unit?: string | null; target_date?: string | null;
  start_value?: number | null; start_day?: string | null; auto?: string | null; horizon?: string; next_step?: string; outcome?: boolean; seed_key?: string; sort?: number;
  floor_value?: number | null; stretch_value?: number | null;
};
const HORIZONS = ['quarter', 'year', 'life'];
/** True when text holds an email or a phone-like run of 9+ digits (ISO dates and money amounts don't count). */
export const hasContact = (text: string): boolean => {
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) return true;
  const t = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  return (t.match(/\+?\d[\d\s().-]*\d/g) ?? []).some((m) => m.replace(/\D/g, '').length >= 9);
};
const goalFields = (f: GoalInput, creating: boolean): Row => {
  const up: Row = {};
  if (f.name !== undefined || creating) up.name = clean(f.name, 120, 'name');
  if (f.why !== undefined) up.why = clean(f.why, 500, 'why', false);
  if (f.area !== undefined) up.area_id = f.area === null || f.area === '' ? null : findArea(f.area).id;
  if (f.target_value !== undefined) { if (f.target_value !== null && !Number.isFinite(Number(f.target_value))) bad('target_value must be a number'); up.target_value = f.target_value === null ? null : Number(f.target_value); }
  if (f.unit !== undefined) up.unit = f.unit === null ? null : clean(f.unit, 20, 'unit', false) || null;
  if (f.target_date !== undefined) { if (f.target_date !== null && !isDate(f.target_date)) bad('target_date must be YYYY-MM-DD'); up.target_date = f.target_date; }
  if (f.start_value !== undefined) { if (f.start_value !== null && !Number.isFinite(Number(f.start_value))) bad('start_value must be a number'); up.start_value = f.start_value === null ? null : Number(f.start_value); }
  if (f.start_day !== undefined) { if (f.start_day !== null && !isDate(f.start_day)) bad('start_day must be YYYY-MM-DD'); up.start_day = f.start_day; }
  for (const k of ['floor_value', 'stretch_value'] as const) {
    const v = f[k];
    if (v === undefined) continue;
    if (v !== null && !Number.isFinite(Number(v))) bad(`${k} must be a number`);
    up[k] = v === null ? null : Number(v);
  }
  if (f.auto !== undefined) {
    if (f.auto !== null && f.auto !== '' && !autoOk(f.auto)) bad(`auto must be one of: savings:<name>, body:weight, cards:reviewed, gym:workouts, habit:<id|name>, project:<id|name>, milestones`);
    up.auto = f.auto || null;
    if (f.auto === 'body:weight' && f.outcome === undefined) up.outcome = 1;
  }
  if (f.horizon !== undefined) { if (!HORIZONS.includes(f.horizon)) bad('horizon must be quarter, year or life'); up.horizon = f.horizon; }
  if (f.next_step !== undefined) up.next_step = clean(f.next_step, 120, 'next_step', false);
  if (f.outcome !== undefined) up.outcome = f.outcome ? 1 : 0;
  if (f.sort !== undefined) up.sort = Math.round(Number(f.sort)) || 0;
  if (f.seed_key !== undefined) up.seed_key = clean(f.seed_key, 60, 'seed_key', false) || null;
  // Goals hold plans, not contact data.
  if (hasContact(`${up.name ?? ''} ${up.why ?? ''} ${up.next_step ?? ''}`)) bad('no phone numbers or emails in goals; keep contact details in People');
  return up;
};

export const createGoal = (f: GoalInput, today = lifeToday()) => {
  if (f.seed_key) {
    const ex = one<{ id: string }>(`SELECT id FROM goals WHERE seed_key = ? AND deleted_at IS NULL`, f.seed_key);
    if (ex) return goalView(findGoal(ex.id), today);
  }
  const fields = goalFields(f, true);
  const row: Row = { id: idOr(f.id), status: 'active', source_kind: fields.auto ? 'auto' : 'manual', start_day: today, ...fields };
  if (row.start_value === undefined && row.auto && row.auto !== 'milestones') {
    const v = autoValue(String(row.auto), null, today);
    // Counting sources start from 0 at the start day; levels (savings, weight) start from today's level.
    row.start_value = /^(savings:|body:weight)/.test(String(row.auto)) ? v : 0;
  }
  insert('goals', row);
  return goalView(findGoal(row.id), today);
};
export const updateGoal = (ref: string, f: GoalInput, today = lifeToday()) => {
  const g = findGoal(ref);
  const up = goalFields(f, false);
  if (Object.keys(up).length) patch('goals', g.id, up);
  return goalView(findGoal(g.id), today);
};
/**
 * New date: only target_date moves. Start, target and the progress meter stay as they are.
 * Without a date: the date your actual rate so far would reach the target (never earlier than the old date),
 * or the old date + 4 weeks when there is no rate yet. Always at least a week out.
 */
export const repaceGoal = (ref: string, today = lifeToday(), target_date?: string) => {
  const g = goalView(findGoal(ref), today);
  if (target_date !== undefined && !isDate(target_date)) bad('target_date must be YYYY-MM-DD');
  if (target_date && target_date <= today) bad('target_date must be after today');
  let date = target_date;
  if (!date) {
    const old = g.target_date && isDate(String(g.target_date)) ? String(g.target_date) : today;
    const done = g.current !== null && g.start_value !== null ? Math.abs(Number(g.current) - Number(g.start_value)) : 0;
    const left = g.current !== null && g.target_value !== null ? Math.abs(Number(g.target_value) - Number(g.current)) : 0;
    const days = Math.max(1, daysBetween(String(g.start_day), today));
    let proj = addDays(old, 28);
    if (done > 0 && left > 0) proj = addDays(today, Math.ceil(left / (done / days)));
    if (proj < old) proj = addDays(old, 28);
    const min = addDays(today, 7);
    date = proj < min ? min : proj;
  }
  patch('goals', g.id, { target_date: date });
  return goalView(findGoal(g.id), today);
};
export const pauseGoal = (ref: string) => {
  const g = findGoal(ref);
  if (g.status !== 'active') bad('only an active goal can be paused');
  patch('goals', g.id, { status: 'paused', paused_at: lifeToday() });
  return goalView(findGoal(g.id));
};
/** Resume: only the target date moves by the paused days. start_day stays, so counted progress is kept. */
export const resumeGoal = (ref: string, today = lifeToday()) => {
  const g = findGoal(ref);
  if (g.status !== 'paused') bad('goal is not paused');
  const days = g.paused_at ? Math.max(0, daysBetween(String(g.paused_at).slice(0, 10), today) || 0) : 0;
  const up: Row = { status: 'active', paused_at: null };
  if (g.target_date && days) up.target_date = addDays(String(g.target_date), days);
  patch('goals', g.id, up);
  return { ...goalView(findGoal(g.id), today), paused_days: days };
};
export const finishGoal = (ref: string, status: 'done' | 'dropped' = 'done') => {
  const g = findGoal(ref);
  patch('goals', g.id, { status, done_at: status === 'done' ? now() : null });
  return goalView(findGoal(g.id));
};
export const reopenGoal = (ref: string) => { const g = findGoal(ref); patch('goals', g.id, { status: 'active', done_at: null, paused_at: null }); return goalView(findGoal(g.id)); };
export const removeGoal = (ref: string) => { const g = findGoal(ref); softDelete('goals', g.id); return { id: g.id, removed: true }; };

// ---------- milestones ----------
export const addMilestone = (goalRef: string, name: string, due?: string | null, id?: string) => {
  const g = findGoal(goalRef);
  if (due && !isDate(due)) bad('due must be YYYY-MM-DD');
  const n = clean(name, 120, 'name');
  const ex = one<{ id: string }>(`SELECT id FROM goal_milestones WHERE goal_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL`, g.id, n);
  if (ex) return one<Row>(`SELECT * FROM goal_milestones WHERE id = ?`, ex.id);
  const row = { id: idOr(id), goal_id: g.id, name: n, due: due ?? null, sort: num(`SELECT COALESCE(MAX(sort),0)+1 AS n FROM goal_milestones WHERE goal_id = ?`, g.id) };
  insert('goal_milestones', row);
  return one<Row>(`SELECT * FROM goal_milestones WHERE id = ?`, row.id);
};
const findMilestone = (id: string) => need(one<Row>(`SELECT * FROM goal_milestones WHERE id = ? AND deleted_at IS NULL`, id), 'milestone');
/** Mark a milestone reached. Returns one quiet line for the moment card. */
export const milestoneDone = (id: string, done = true) => {
  const m = findMilestone(id);
  patch('goal_milestones', m.id, { done_at: done ? now() : null });
  const g = goalView(findGoal(m.goal_id));
  const left = g.milestones.filter((x: Row) => !x.done_at).length;
  return { milestone: findMilestone(m.id), goal: g.name, moment: done ? `${m.name}: reached. ${left ? `${left} milestone${left === 1 ? '' : 's'} left on ${g.name}.` : `All milestones on ${g.name} are reached.`}` : null };
};
export const updateMilestone = (id: string, f: { name?: string; due?: string | null; sort?: number }) => {
  const m = findMilestone(id);
  const up: Row = {};
  if (f.name !== undefined) up.name = clean(f.name, 120, 'name');
  if (f.due !== undefined) { if (f.due !== null && !isDate(f.due)) bad('due must be YYYY-MM-DD'); up.due = f.due; }
  if (f.sort !== undefined) up.sort = Math.round(Number(f.sort)) || 0;
  if (Object.keys(up).length) patch('goal_milestones', m.id, up);
  return findMilestone(m.id);
};
export const removeMilestone = (id: string) => { const m = findMilestone(id); softDelete('goal_milestones', m.id); return { id: m.id, removed: true }; };

// ---------- links ----------
export const linkGoal = (goalRef: string, kind: 'habit' | 'project', ref: string) => {
  const g = findGoal(goalRef);
  let target: { id: string } | undefined;
  if (kind === 'habit') target = one(`SELECT id FROM habits WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref);
  else if (kind === 'project') target = one(`SELECT id FROM projects WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref);
  else bad('kind must be habit or project');
  if (!target) bad(`${kind} ${ref} not found`);
  const t = now();
  run(`INSERT INTO goal_links (id, goal_id, kind, ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (goal_id, kind, ref) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at`, uuid(), g.id, kind, target!.id, t, t);
  return linksOf(g.id);
};
export const unlinkGoal = (goalRef: string, kind: string, ref: string) => {
  const g = findGoal(goalRef);
  run(`UPDATE goal_links SET deleted_at = ?, updated_at = ? WHERE goal_id = ? AND kind = ? AND ref = ?`, now(), now(), g.id, kind, ref);
  return linksOf(g.id);
};

// ---------- templates ----------
export const GOAL_TEMPLATES = [
  { key: 'car_fund', name: 'Savings fund', area: 'money', auto: 'savings:car', unit: 'USD', horizon: 'year', why: 'Save toward one thing that matters.', next_step: 'Log this week’s savings transfer', needs: 'target_value, target_date' },
  { key: 'weight', name: 'Body weight', area: 'body', auto: 'body:weight', unit: 'kg', horizon: 'year', outcome: true, why: 'Shown as info; the gym and food logs are what you control.', next_step: 'Weigh in this morning', needs: 'target_value, target_date' },
  { key: 'cards', name: 'Card reviews', area: 'learning', auto: 'cards:reviewed', unit: 'cards', horizon: 'quarter', why: 'A little review every week.', next_step: 'Review 10 flashcards', needs: 'target_value, target_date' },
  { key: 'gym', name: 'Gym sessions', area: 'body', auto: 'gym:workouts', unit: 'sessions', horizon: 'quarter', why: 'Strength that lasts.', next_step: 'Go to the next gym session', needs: 'target_value, target_date' },
  { key: 'read_books', name: 'Read 12 books', area: 'learning', auto: null, unit: 'books', target_value: 12, horizon: 'year', why: 'One book a month.', next_step: 'Read 10 pages', needs: 'target_date (optional)' },
  { key: 'run_10k', name: 'Run a 10k', area: 'body', auto: 'milestones', unit: 'steps', horizon: 'quarter', why: 'A clear finish line for fitness.', next_step: 'Go for a 20-minute run', needs: 'target_date (optional)',
    milestones: ['Run 3k without stopping', 'Run 5k', 'Run 8k', 'Run 10k'] },
  // Work goals. Added once (seed_key = template key).
  { key: 'side_project', name: 'Ship a side project', area: 'work', auto: 'milestones', unit: 'steps', horizon: 'year', why: 'One finished thing beats ten started ones.',
    next_step: 'Write the one-page plan', needs: 'target_date (optional)',
    milestones: ['Write the one-page plan', 'Build the first version', 'Show it to three people', 'Ship it'] },
] as const;
export const goalFromTemplate = (key: string, f: GoalInput = {}, today = lifeToday()) => {
  const t = GOAL_TEMPLATES.find((x) => x.key === key) ?? bad(`template must be one of ${GOAL_TEMPLATES.map((x) => x.key).join(', ')}`);
  const { key: _k, needs: _n, milestones, ...base } = t as Row;
  const business = t.area === 'work';
  const g = createGoal({ ...(business ? { seed_key: `tpl:${t.key}` } : {}), ...base, ...f }, today);
  if (Array.isArray(milestones) && !(g.milestones as Row[]).length) {
    for (const m of milestones) addMilestone(String(g.id), String(m));
    return goalView(findGoal(String(g.id)), today);
  }
  return g;
};

// ---------- daily job ----------
/** Snapshot auto goal values for today (so goal charts have history) and refresh this week's grades. */
export const gradesDaily = (today = lifeToday()) => {
  let n = 0;
  for (const g of all<Row>(`SELECT * FROM goals WHERE deleted_at IS NULL AND status = 'active' AND auto IS NOT NULL AND auto <> 'milestones'`)) {
    const v = autoValue(String(g.auto), g.start_day ?? null, today);
    if (v === null) continue;
    run(`INSERT INTO goal_values (goal_id, day, value) VALUES (?, ?, ?) ON CONFLICT (goal_id, day) DO UPDATE SET value = excluded.value`, g.id, today, v);
    n++;
  }
  snapshotWeek(undefined, today);
  const prev = addDays(weekStartOf(today), -7);
  if (!one(`SELECT 1 AS x FROM grade_weeks WHERE week_start = ? AND area_key = '_overall'`, prev)) snapshotWeek(prev, today);
  const confidence_ask = ensureConfidenceAsk(today);
  return { goals_snapshotted: n, confidence_ask };
};

// ---------- round 4: floor/stretch, confidence, quiet areas, rating patterns, what-if, quarter report ----------
const factValue = (key: string): unknown => {
  try {
    const f = one<{ value: string }>(`SELECT value FROM profile_facts WHERE key = ?`, key);
    if (!f) return null;
    try { return JSON.parse(String(f.value)); } catch { return f.value; }
  } catch { return null; }
};

/** Shrink a goal to its floor: the floor becomes the target. Pace line keeps its start. */
export const shrinkGoal = (ref: string, today = lifeToday()) => {
  const g = goalView(findGoal(ref), today);
  if (g.outcome) bad('outcome goals have no floor');
  if (g.floor === null || g.target_value === null) bad('goal needs a start and a target first');
  if (Number(g.floor) === Number(g.target_value)) bad('goal is already at its floor');
  patch('goals', String(g.id), { target_value: g.floor, floor_value: g.floor });
  return goalView(findGoal(String(g.id)), today);
};

/**
 * Fresh-start days only (Monday, or the 1st of the month): one app question (1–5) about the active goal
 * with the nearest date that isn't reached yet, framed forward. Never the worst goal.
 * Older unanswered confidence questions are put away for good (one at a time, never a pile).
 * Off when profile focus.reminder_style = 'none'.
 */
/** Fresh-start days: Monday or the 1st of the month (natural reset points). */
export const isFreshStart = (day: string) => dowOf(day) === 1 || day.endsWith('-01');

export const ensureConfidenceAsk = (today = lifeToday()): string | null => {
  if (!isFreshStart(today)) return null;
  if (String(factValue('focus.reminder_style') ?? '') === 'none') return null;
  const key = `goals.confidence.w${today.replace(/-/g, '')}`;
  run(`UPDATE asks SET status = 'skipped', skip_until = '9999-12-31' WHERE key LIKE 'goals.confidence.%' AND status = 'open' AND key <> ?`, key);
  if (one(`SELECT 1 AS x FROM asks WHERE key = ?`, key)) return key;
  const goals = all<Row>(`SELECT * FROM goals WHERE deleted_at IS NULL AND status = 'active' AND outcome = 0 AND target_date IS NOT NULL AND target_date > ?`, today)
    .map((g) => goalView(g, today)).filter((g) => g.pace_line !== 'Reached.');
  if (!goals.length) return null;
  const g = goals.sort(byNearest)[0];
  addAsk({ key, module: 'goals', answer_type: 'number', priority: 95, min: 1, max: 5,
    question: `Fresh start. From today, how sure are you that you will reach "${String(g.name).slice(0, 60)}" by ${g.target_date}? 1 = not at all, 5 = sure.`,
    why: 'A low number offers a smaller target or a new date. Progress so far stays. Skip any time.' });
  run(`INSERT INTO goal_confidence (week_start, goal_id, ask_key) VALUES (?, ?, ?) ON CONFLICT (week_start, goal_id) DO NOTHING`, weekStartOf(today), g.id, key);
  return key;
};

const QUIET_SEEDS: Record<string, string[]> = {
  body: ['Walk 15 minutes', 'Log one meal', 'Weigh in once'],
  money: ['Log today’s spending', 'Check the cash total', 'Move one transfer to savings'],
  learning: ['10 minutes of a course', 'Read 10 pages', 'Watch one lesson'],
  people: ['Message one person', 'Call a family member', 'Plan one visit'],
  home: ['15-minute tidy', 'One chore from the list', 'Clear one surface'],
  work: ['Open the first priority for 10 minutes', 'Write one plan line', 'Close one small open loop'],
};

/** Areas with no grade above D for the last 3 finished weeks. Hidden outside Normal mode. Offers 3 small starts. */
export const quietAreas = (today = lifeToday()) => {
  const mode = String(kvGet('mode') ?? 'Normal');
  if (mode !== 'Normal') return { mode, areas: [] as Row[] };
  const hist = gradesHistory(4, today).slice(0, 3);
  if (hist.length < 3) return { mode, areas: [] as Row[] };
  const dismissed = new Set(all<{ area_key: string }>(`SELECT area_key FROM quiet_dismiss WHERE until > ?`, today).map((r) => r.area_key));
  const out: Row[] = [];
  for (const a of listAreas()) {
    const k = String(a.key ?? a.id);
    if (dismissed.has(k)) continue;
    if (!hist.every((w) => { const l = w.areas[k]; return l === null || l === undefined || l === 'D'; })) continue;
    const habits = hasTable('habits') ? all<Row>(`SELECT name FROM habits WHERE deleted_at IS NULL AND archived = 0 AND area_id = ? ORDER BY created_at LIMIT 3`, a.id) : [];
    const steps = all<Row>(`SELECT name, next_step FROM goals WHERE deleted_at IS NULL AND status = 'active' AND area_id = ? AND next_step <> '' ORDER BY sort LIMIT 3`, a.id);
    if (!habits.length && !steps.length) continue; // nothing to grade there: not quiet, just empty
    const opts: string[] = [];
    for (const s of steps) opts.push(String(s.next_step));
    for (const h of habits) opts.push(`Do "${h.name}" once`);
    for (const s of QUIET_SEEDS[k] ?? []) opts.push(s);
    const options = [...new Set(opts.map((o) => o.slice(0, 44)))].slice(0, 3);
    out.push({ key: k, name: a.name, emoji: a.emoji, line: 'Quiet for 3 weeks. One small start?', options });
  }
  return { mode, areas: out };
};
export const dismissQuiet = (areaKey: string, today = lifeToday()) => {
  const k = clean(areaKey, 40, 'area');
  const until = addDays(today, 28);
  run(`INSERT INTO quiet_dismiss (area_key, until) VALUES (?, ?) ON CONFLICT (area_key) DO UPDATE SET until = excluded.until`, k, until);
  return { area: k, until };
};
/** Turn a quiet-area option into an Inbox task (10 min, optional). */
export const quietStart = (areaKey: string, option: string, today = lifeToday()) => {
  const title = clean(option, 44, 'option');
  const k = clean(areaKey, 40, 'area');
  const t = addTask({ title, est_minutes: 10, first_action: 'Open it and start a 10-minute timer', done_def: title, source: `quiet:${k}` } as never);
  dismissQuiet(k, today);
  return t;
};

/** What tends to show up on good vs hard days. Needs 40 ratings. Plain shares, no cause claimed. */
export const ratingPatterns = (today = lifeToday()) => {
  const rows = all<{ day: string; rating: number; tags: string }>(`SELECT day, rating, tags FROM day_ratings WHERE deleted_at IS NULL AND day <= ? ORDER BY day DESC LIMIT 180`, today);
  if (rows.length < 40) return { days: rows.length, needed: 40, patterns: [] as Row[], line: 'Not enough days yet.' };
  // Everything keyed by life-day (04:00 rollover), the same day a rating belongs to.
  const lo = rows[rows.length - 1].day, hi = rows[0].day;
  const lifeDays = (sql: string, ...p: unknown[]) => {
    const m = new Map<string, number>();
    for (const r of all<{ at: string }>(sql, ...p)) { const d = lifeDay(new Date(r.at)); m.set(d, (m.get(d) ?? 0) + 1); }
    return m;
  };
  const isoLo = `${addDays(lo, -1)}T00:00:00Z`, isoHi = `${addDays(hi, 2)}T00:00:00Z`;
  const feats: Record<string, (d: string, tags: string[]) => boolean> = {};
  for (const t of RATING_TAGS) feats[`tag:${t}`] = (_d, tags) => tags.includes(t);
  if (hasTable('workouts')) {
    const s = new Set(all<{ day: string }>(`SELECT DISTINCT day FROM workouts WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, lo, hi).map((r) => r.day));
    feats.gym = (d) => s.has(d);
  }
  if (hasTable('tasks')) {
    const m = lifeDays(`SELECT done_at AS at FROM tasks WHERE deleted_at IS NULL AND status = 'done' AND done_at >= ? AND done_at < ?`, isoLo, isoHi);
    feats.tasks3 = (d) => (m.get(d) ?? 0) >= 3;
  }
  if (hasTable('focus_sessions')) {
    const m = lifeDays(`SELECT started_at AS at FROM focus_sessions WHERE deleted_at IS NULL AND started_at >= ? AND started_at < ?`, isoLo, isoHi);
    feats.focus = (d) => m.has(d);
  }
  if (hasTable('food_log')) {
    const s = new Set(all<{ day: string }>(`SELECT DISTINCT day FROM food_log WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, lo, hi).map((r) => r.day));
    feats.food = (d) => s.has(d);
  }
  const label: Record<string, string> = {
    'tag:launch_used': 'used the Kickoff block', 'tag:gym': 'gym', 'tag:late_start': 'a late start', 'tag:family_event': 'a family event',
    'tag:power_cut': 'a power cut', 'tag:outside': 'time outside', gym: 'a logged workout', tasks3: '3+ tasks done', focus: 'a focus session', food: 'food logged',
  };
  const good = rows.filter((r) => r.rating >= 4), hard = rows.filter((r) => r.rating <= 2);
  if (good.length < 5 || hard.length < 5) return { days: rows.length, needed: 40, patterns: [] as Row[], line: 'Ratings are too even to compare yet.' };
  const share = (set: typeof rows, f: (d: string, t: string[]) => boolean) => set.filter((r) => f(r.day, parseTags(r.tags))).length / set.length;
  const pats: Row[] = [];
  for (const [k, f] of Object.entries(feats)) {
    const g = share(good, f), h = share(hard, f);
    const diff = g - h;
    if (Math.abs(diff) < 0.15) continue;
    pats.push({ key: k, good_share: round(g, 2), hard_share: round(h, 2), diff: round(diff, 2),
      line: `${label[k] ?? k}: on ${Math.round(g * 100)}% of 4–5 days, ${Math.round(h * 100)}% of 1–2 days.` });
  }
  pats.sort((a, b) => Math.abs(Number(b.diff)) - Math.abs(Number(a.diff)));
  return { days: rows.length, needed: 40, patterns: pats.slice(0, 3), line: pats.length ? 'Shows up together. Not proof of cause.' : 'No clear difference yet.' };
};

/** Savings goals: what a weekly amount (USD) does to the date and the cash runway. Capped to keep a cash floor. */
export const goalWhatIf = (ref: string, perWeek: number, today = lifeToday()) => {
  const g = goalView(findGoal(ref), today);
  if (!String(g.auto ?? '').startsWith('savings:')) bad('what-if works on savings goals only');
  const amt = Number(perWeek);
  if (!(amt > 0) || amt > 1e9) bad('per_week must be a positive amount');
  const target = Number(g.target_value ?? 0), cur = Number(g.current ?? 0);
  const left = Math.max(0, target - cur);
  const rw = runway(today) as { cash_usd: number; weekly_burn_usd: number };
  const months = Number(factValue('money.cash_floor_months') ?? 3) || 3;
  // Before there is spending data, the profile's rough fixed monthly cost stands in for the burn.
  const fixed = Number(factValue('money.monthly_fixed_usd') ?? 0) || 0;
  const burn = Number(rw.weekly_burn_usd) || (fixed > 0 ? fixed / 4.33 : 0);
  const floorCash = months * 4.33 * burn;
  const weeksToDate = g.target_date ? Math.max(1, daysBetween(today, String(g.target_date)) / 7) : null;
  const spare = Math.max(0, Number(rw.cash_usd) - floorCash);
  const maxPerWeekUsd = weeksToDate ? spare / weeksToDate : spare;
  let perWeekUsd = amt;
  const capped = burn > 0 && perWeekUsd > maxPerWeekUsd;
  if (capped) perWeekUsd = maxPerWeekUsd;
  const weeks = perWeekUsd > 0 ? left / perWeekUsd : null;
  const eta = left === 0 ? today : weeks === null ? null : addDays(today, Math.ceil(weeks * 7));
  return {
    goal: g.name, per_week: amt, per_week_usd: round(perWeekUsd, 2), rate_estimated: false, left_usd: round(left, 2),
    eta, on_time: eta === null || !g.target_date ? null : eta <= String(g.target_date),
    runway_months_after: burn > 0 ? round((Number(rw.cash_usd) - left) / (burn * 4.33), 1) : null,
    cash_floor_months: months, capped, max_per_week_usd: burn > 0 ? Math.floor(maxPerWeekUsd) : null,
  };
};

/**
 * Quarter review file in the vault: 3 plain facts per week, milestones reached, goal values at start and end.
 * Goals hold no phones or emails (goals refuse them).
 */
export const quarterReport = (today = lifeToday(), write = true) => {
  const y = Number(today.slice(0, 4)), q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const qStart = `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
  const weeks = Math.min(14, Math.max(1, Math.ceil((daysBetween(weekStartOf(qStart), today) + 1) / 7)));
  const cur = weekStartOf(today);
  const wss: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) { const ws = addDays(cur, -7 * i); if (addDays(ws, 6) >= qStart) wss.push(ws); }
  const lines: string[] = [`# ${y}-Q${q} review`, '', `Written ${today}. Plain counts per week.`, '', '| Week | Facts |', '|---|---|'];
  for (const ws of wss) { const f = gradesWeek(ws, today).facts; lines.push(`| ${ws} | ${f.length ? f.join(', ') : '—'} |`); }
  const ms = all<Row>(`SELECT m.name, m.done_at, g.name AS goal FROM goal_milestones m JOIN goals g ON g.id = m.goal_id
    WHERE m.deleted_at IS NULL AND g.deleted_at IS NULL AND m.done_at IS NOT NULL AND substr(m.done_at, 1, 10) >= ? ORDER BY m.done_at`, qStart);
  lines.push('', '## Milestones reached', '');
  if (ms.length) for (const m of ms) lines.push(`- ${String(m.done_at).slice(0, 10)} · ${m.goal}: ${m.name}`); else lines.push('- None logged this quarter.');
  lines.push('', '## Goals', '');
  const gs = all<Row>(`SELECT g.* FROM goals g WHERE g.deleted_at IS NULL AND g.status IN ('active','done') ORDER BY g.sort, g.name`);
  for (const g of gs) {
    const v = goalView(g, today);
    const first = one<{ value: number }>(`SELECT value FROM goal_values WHERE goal_id = ? AND day >= ? ORDER BY day LIMIT 1`, g.id, qStart);
    const startV: unknown = first ? first.value : v.start_value;
    lines.push(`- ${g.name}: ${startV ?? '—'} → ${v.current ?? '—'}${g.unit ? ` ${g.unit}` : ''}${v.target_value !== null && v.target_value !== undefined ? ` (target ${v.target_value})` : ''} · ${v.pace_line}`);
  }
  if (!gs.length) lines.push('- No goals yet.');
  lines.push('');
  const path = `Reviews/${y}-Q${q}.md`;
  const content = lines.join('\n');
  if (write) {
    const abs = resolveVaultPath(path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return { path, weeks: wss.length, milestones: ms.length, goals: gs.length, content };
};

// ---------- done tasks ----------
/** First count in a title that isn't a duration, time or percent: "Read 10 pages" → 10. */
export const titleCount = (title: string): number | null => {
  for (const m of String(title).matchAll(/(?<![\d:.])(\d{1,4})(?![\d:.])(?!\s*(?:m\b|min|minutes?\b|h\b|hrs?\b|hours?\b|%))/gi)) {
    const n = Number(m[1]);
    if (n > 0 && n <= 1000) return n;
  }
  return null;
};

type DoneTask = { title: string; done_at: string; project: string | null; day: string };
/** Done tasks whose life-day falls in [from, to], with project name. */
const doneTasks = (from: string, to: string): DoneTask[] => {
  if (!hasTable('tasks')) return [];
  return all<{ title: string; done_at: string; project: string | null }>(`SELECT t.title, t.done_at, p.name AS project FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id WHERE t.deleted_at IS NULL AND t.status = 'done' AND t.done_at >= ? AND t.done_at < ? ORDER BY t.done_at`,
  `${addDays(from, -1)}T00:00:00Z`, `${addDays(to, 2)}T00:00:00Z`)
    .map((r) => ({ ...r, day: lifeDay(new Date(r.done_at)) })).filter((r) => r.day >= from && r.day <= to);
};
// ---------- done-log ----------
export type DoneRange = 'day' | 'week' | 'month';
const rangeOf = (range: DoneRange, today: string): [string, string] =>
  range === 'day' ? [today, today] : range === 'week' ? [weekStartOf(today), today] : [`${today.slice(0, 7)}-01`, today];

/** Totals over [from, to]: tasks, gym days, food days logged, habit checks, cards reviewed, money saved. */
export const doneTotals = (from: string, to: string) => {
  const T = hasTable;
  const done = doneTasks(from, to);
  const gym = T('workouts') ? num(`SELECT COUNT(DISTINCT day) AS n FROM workouts WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, from, to) : 0;
  const food_days = T('food_log') ? num(`SELECT COUNT(DISTINCT day) AS n FROM food_log WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, from, to) : 0;
  const habits = T('habit_checks') ? num(`SELECT COALESCE(SUM(count),0) AS n FROM habit_checks WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, from, to) : 0;
  const cards = T('card_reviews') ? isoCount('card_reviews', 'at', from, to) : 0;
  const money_saved_usd = T('records') && T('savings_goals') ? round(num(`SELECT COALESCE(SUM(r.usd),0) AS n FROM records r
    WHERE r.deleted_at IS NULL AND r.kind = 'transfer' AND r.direction = 1 AND r.day >= ? AND r.day <= ?
    AND r.account_id IN (SELECT account_id FROM savings_goals WHERE deleted_at IS NULL AND account_id IS NOT NULL)`, from, to), 2) : 0;
  return { tasks: done.length, gym, food_days, habits, cards, money_saved_usd };
};
export type DoneTotals = ReturnType<typeof doneTotals>;

/** "This month: 42 tasks done, 19 gym sessions, 20 food days logged." Only the non-zero parts. */
export const totalsLine = (label: string, t: DoneTotals) => {
  const p: string[] = [];
  const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (t.tasks) p.push(`${s(t.tasks, 'task')} done`);
  if (t.gym) p.push(s(t.gym, 'gym session'));
  if (t.food_days) p.push(`${s(t.food_days, 'food day')} logged`);
  if (t.habits) p.push(s(t.habits, 'habit check'));
  if (t.cards) p.push(`${s(t.cards, 'card')} reviewed`);
  if (t.money_saved_usd) p.push(`$${fmt(t.money_saved_usd)} saved`);
  return p.length ? `${label}: ${p.join(', ')}.` : `${label}: nothing logged yet.`;
};

/** Done-log: one line per thing done ("Tue · Read 20 pages (Personal)"), range totals and month totals. */
export const doneLog = (range: DoneRange = 'week', today = lifeToday()) => {
  if (!['day', 'week', 'month'].includes(range)) bad('range must be day, week or month');
  if (!isDate(today)) bad('day must be YYYY-MM-DD');
  const [from, to] = rangeOf(range, today);
  const wd = (d: string) => weekdayOf(d).slice(0, 3);
  const entries: { day: string; at: string; kind: string; line: string }[] = [];
  for (const r of doneTasks(from, to)) {
    const proj = r.project && !/^inbox$/i.test(r.project) ? ` (${r.project})` : '';
    entries.push({ day: r.day, at: r.done_at, kind: 'task', line: `${wd(r.day)} · ${r.title}${proj}` });
  }
  if (hasTable('workouts')) {
    for (const w of all<{ day: string; name: string; started_at: string }>(`SELECT day, name, started_at FROM workouts WHERE deleted_at IS NULL AND status = 'done' AND day >= ? AND day <= ? ORDER BY day`, from, to)) {
      entries.push({ day: w.day, at: String(w.started_at), kind: 'gym', line: `${wd(w.day)} · Gym: ${w.name}` });
    }
  }
  entries.sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at));
  const totals = doneTotals(from, to);
  const month = range === 'month' ? totals : doneTotals(rangeOf('month', today)[0], today);
  return { range, from, to, entries: entries.map(({ day, kind, line }) => ({ day, kind, line })), totals, month, month_line: totalsLine('This month', month) };
};

// ---------- next step per area (nightly planner: Learning + buffer blocks) ----------
const VERB_FIRST = /^(send|write|build|finish|fix|log|read|do|call|apply|review|plan|draft|ship|make|open|set|add|learn|practice|go|update|book|pay|move|check|clean|weigh|list|record|publish|launch|prepare|study|watch|message|email|run|save|transfer|pick|find)\b/i;
export const trim45 = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= 44) return t;
  const cut = t.slice(0, 43).replace(/\s+\S*$/, '');
  return `${cut || t.slice(0, 43)}…`;
};
/**
 * For each area: the top active goal (nearest date first) and its next open milestone, as one verb-first task under 45 chars.
 * The planner may use these for Learning and buffer blocks. avoid_window = focus.hardest_time (keep hard tasks out of it).
 */
export const goalsNextStep = (today = lifeToday()) => {
  const goals = all<Row>(`SELECT * FROM goals WHERE deleted_at IS NULL AND status = 'active' AND outcome = 0`).map((g) => goalView(g, today))
    .filter((g) => g.pace_line !== 'Reached.');
  const steps: Row[] = [];
  for (const a of listAreas()) {
    const g = goals.filter((x) => x.area_id === a.id).sort(byNearest)[0];
    if (!g) continue;
    const ms = (g.milestones as Row[]).find((m) => !m.done_at) ?? null;
    const step = String(g.next_step ?? '').trim();
    const task = step && VERB_FIRST.test(step) ? step
      : ms ? `Finish: ${ms.name}`
        : g.next && VERB_FIRST.test(String(g.next)) ? String(g.next)
          : `Do one step on ${g.name}`;
    steps.push({ area: a.key ?? a.name, goal_id: g.id, goal: g.name, milestone: ms ? ms.name : null, milestone_due: ms?.due ?? null,
      task: trim45(task), est_minutes: 25, pace_line: g.pace_line });
  }
  return { day: today, avoid_window: hardestWindow(), steps };
};
