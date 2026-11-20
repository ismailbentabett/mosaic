// Gym: exercise library (free-exercise-db, Unlicense), routines, live workouts, sets, PRs, double progression,
// rest timer, weekly muscle volume, warm-up ramp, plates, Strong/Hevy CSV import. Replaces openGym/Strong/Hevy.
import { createHash } from 'node:crypto';
import { AppError } from '../../errors.ts';
import { addDays, lifeDay, lifeToday, weekStartOf, zonedDate } from '../../time.ts';
import { all, idOr, insert, j, need, now, one, parseCsv, patch, round, run, softDelete, uuid, type Row } from '../util.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
const sha = (s: string) => createHash('sha1').update(s).digest('hex');
export const KINDS = ['weight_reps', 'reps', 'time', 'distance_time', 'assisted'] as const;
export const SET_TYPES = ['warmup', 'working', 'drop', 'failure'] as const;
export const IDLE_FINISH_MS = 3 * 3600 * 1000;

export type Exercise = {
  id: string; source: string; source_ref: string | null; name: string; kind: string; equipment: string | null;
  primary_muscles: string[]; secondary_muscles: string[]; instructions: string[]; images: string[]; increment: number; archived: number;
};
const toEx = (r: Row): Exercise => ({ ...(r as unknown as Exercise), primary_muscles: j(r.primary_muscles, []), secondary_muscles: j(r.secondary_muscles, []),
  instructions: j(r.instructions, []), images: j(r.images, []) });

// ---------- exercises ----------
/** free-exercise-db `exercises.json` entries: {id, name, force, level, mechanic, equipment, primaryMuscles, secondaryMuscles, instructions, category, images}. */
export const importExercises = (list: Row[], dryRun = false) => {
  if (!Array.isArray(list)) bad('expected a JSON array of exercises');
  let added = 0, skipped = 0;
  for (const e of list) {
    const ref = String(e.id ?? e.name ?? '');
    if (!ref || !e.name) { skipped++; continue; }
    if (one('SELECT 1 FROM exercises WHERE source_ref = ?', `fedb:${ref}`)) { skipped++; continue; }
    const cat = String(e.category ?? '');
    const equip = e.equipment ? String(e.equipment) : null;
    const kind = cat === 'cardio' ? 'distance_time' : cat === 'stretching' ? 'time' : equip === 'body only' ? 'reps' : 'weight_reps';
    if (!dryRun) insert('exercises', { id: uuid(), source: 'free-exercise-db', source_ref: `fedb:${ref}`, name: String(e.name), kind, equipment: equip,
      primary_muscles: e.primaryMuscles ?? [], secondary_muscles: e.secondaryMuscles ?? [], instructions: e.instructions ?? [], images: e.images ?? [],
      increment: equip === 'dumbbell' ? 2 : equip === 'barbell' ? 2.5 : 2.5 });
    added++;
  }
  return { added, skipped, dryRun };
};

export const addExercise = (e: { id?: string; name: string; kind?: string; equipment?: string; primary_muscles?: string[]; secondary_muscles?: string[]; increment?: number }) => {
  const name = String(e.name ?? '').trim().slice(0, 120);
  if (!name) bad('exercise name is needed');
  const kind = e.kind ?? 'weight_reps';
  if (!KINDS.includes(kind as never)) bad(`kind must be one of ${KINDS.join(', ')}`);
  const dupe = one<Row>('SELECT id FROM exercises WHERE lower(name) = lower(?) AND deleted_at IS NULL', name);
  if (dupe && !e.id) bad(`"${name}" already exists`);
  const id = idOr(e.id);
  insert('exercises', { id, source: 'own', name, kind, equipment: e.equipment ?? null, primary_muscles: e.primary_muscles ?? [],
    secondary_muscles: e.secondary_muscles ?? [], increment: e.increment && e.increment > 0 ? e.increment : 2.5 });
  return getExercise(id);
};

export const getExercise = (id: string) => toEx(need(one<Row>('SELECT * FROM exercises WHERE id = ? AND deleted_at IS NULL', id), 'exercise'));

export const findExercise = (ref: string): Exercise | null => {
  const s = String(ref ?? '').trim();
  if (!s) return null;
  const r = one<Row>(`SELECT * FROM exercises WHERE (id = ? OR lower(name) = lower(?)) AND deleted_at IS NULL ORDER BY archived, (source = 'own') DESC LIMIT 1`, s, s);
  return r ? toEx(r) : null;
};

export const searchExercises = (q = '', muscle?: string, equipment?: string, limit = 40) =>
  all<Row>(`SELECT * FROM exercises WHERE deleted_at IS NULL AND archived = 0 AND name LIKE ?
    AND (? IS NULL OR primary_muscles LIKE ?) AND (? IS NULL OR equipment = ?)
    ORDER BY (SELECT COUNT(*) FROM sets s WHERE s.exercise_id = exercises.id AND s.deleted_at IS NULL) DESC, length(name), name LIMIT ?`,
  `%${q}%`, muscle ?? null, `%"${muscle}"%`, equipment ?? null, equipment ?? null, limit).map(toEx);

/** Exercises with history are archived, never deleted. */
export const removeExercise = (id: string) => {
  getExercise(id);
  const used = one('SELECT 1 FROM sets WHERE exercise_id = ? AND deleted_at IS NULL LIMIT 1', id);
  if (used) { patch('exercises', id, { archived: 1 }); return 'archived' as const; }
  softDelete('exercises', id);
  return 'deleted' as const;
};

// ---------- routines ----------
type ItemIn = { exercise: string; sets?: number; rep_min?: number; rep_max?: number; rest_s?: number; superset_group?: string };
export const addRoutine = (r: { id?: string; name: string; notes?: string; items: ItemIn[] }) => {
  const name = String(r.name ?? '').trim();
  if (!name) bad('routine name is needed');
  const id = idOr(r.id);
  if (insert('routines', { id, name, notes: r.notes ?? '', sort: Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM routines')!.n) })) setRoutineItems(id, r.items ?? []);
  return getRoutine(id);
};
export const setRoutineItems = (routine_id: string, items: ItemIn[]) => {
  if (!Array.isArray(items) || items.some((it) => !it || typeof it !== 'object')) bad('items must be a list of exercises');
  run('UPDATE routine_items SET deleted_at = ? WHERE routine_id = ? AND deleted_at IS NULL', now(), routine_id);
  items.forEach((it, i) => {
    const ex = need(findExercise(it.exercise), `exercise "${it.exercise}"`);
    const rmin = it.rep_min ?? 8, rmax = it.rep_max ?? Math.max(rmin, 12);
    if (!(rmin > 0 && rmax >= rmin && rmax <= 100)) bad('rep range must be 1-100 and min <= max');
    insert('routine_items', { id: uuid(), routine_id, exercise_id: ex.id, sets: Math.min(Math.max(it.sets ?? 3, 1), 20), rep_min: rmin, rep_max: rmax,
      rest_s: Math.min(Math.max(it.rest_s ?? 120, 0), 900), superset_group: it.superset_group ?? null, sort: i });
  });
};
export const getRoutine = (ref: string) => {
  const r = need(one<Row>('SELECT * FROM routines WHERE (id = ? OR lower(name) = lower(?)) AND deleted_at IS NULL', ref, ref), 'routine');
  const items = all<Row>(`SELECT ri.*, e.name AS exercise_name, e.kind FROM routine_items ri JOIN exercises e ON e.id = ri.exercise_id
    WHERE ri.routine_id = ? AND ri.deleted_at IS NULL ORDER BY ri.sort`, r.id);
  return { ...r, items };
};
export const listRoutines = () => all<Row>('SELECT * FROM routines WHERE deleted_at IS NULL ORDER BY sort, name').map((r) => getRoutine(String(r.id)));

// ---------- workouts ----------
/** Close active workouts idle for more than 3 h. End = last set + 120 s (or start + 1 h if no sets). */
export const autoFinishStale = (at = new Date()) => {
  let n = 0;
  for (const w of all<Row>(`SELECT * FROM workouts WHERE status = 'active' AND deleted_at IS NULL`)) {
    const last = one<{ t: string | null }>('SELECT MAX(done_at) AS t FROM sets WHERE workout_id = ? AND deleted_at IS NULL', w.id)!.t;
    const lastMs = Date.parse(last ?? String(w.started_at));
    if (at.getTime() - lastMs > IDLE_FINISH_MS) {
      const end = last ? new Date(lastMs + 120000) : new Date(lastMs + 3600000);
      patch('workouts', String(w.id), { status: 'done', ended_at: end.toISOString(), notes: `${w.notes ?? ''}${w.notes ? '\n' : ''}(auto-finished)` });
      n++;
    }
  }
  return n;
};

export const activeWorkout = () => {
  autoFinishStale();
  const w = one<Row>(`SELECT * FROM workouts WHERE status = 'active' AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1`);
  return w ? getWorkout(String(w.id)) : null;
};

export const startWorkout = (w: { id?: string; routine?: string; name?: string; at?: string } = {}) => {
  autoFinishStale(w.at ? new Date(w.at) : new Date());
  if (w.id && one('SELECT 1 FROM workouts WHERE id = ?', w.id)) return getWorkout(w.id);
  const act = one<Row>(`SELECT id FROM workouts WHERE status = 'active' AND deleted_at IS NULL LIMIT 1`);
  if (act) throw new AppError('conflict', 'a workout is already running; finish it first');
  const routine = w.routine ? getRoutine(w.routine) : null;
  const at = w.at ? new Date(w.at) : new Date();
  const id = idOr(w.id);
  insert('workouts', { id, routine_id: routine?.id ?? null, name: String(w.name ?? routine?.name ?? 'Workout').slice(0, 100), started_at: at.toISOString(),
    status: 'active', day: lifeDay(at) });
  return getWorkout(id);
};

export const getWorkout = (id: string) => {
  const w = need(one<Row>('SELECT * FROM workouts WHERE id = ? AND deleted_at IS NULL', id), 'workout');
  const sets = all<Row>(`SELECT s.*, e.name AS exercise_name FROM sets s JOIN exercises e ON e.id = s.exercise_id
    WHERE s.workout_id = ? AND s.deleted_at IS NULL ORDER BY s.idx`, id);
  const working = sets.filter((s) => s.type !== 'warmup');
  const volume = round(working.reduce((a, s) => a + Number(s.weight ?? 0) * Number(s.reps ?? 0), 0), 1);
  const end = w.ended_at ? Date.parse(String(w.ended_at)) : Date.now();
  return { ...w, sets, volume_kg: volume, working_sets: working.length, minutes: Math.round((end - Date.parse(String(w.started_at))) / 60000), prs: workoutPrs(id) };
};

export const finishWorkout = (id: string, notes?: string, at = new Date()) => {
  const w = getWorkout(id);
  if (w.status === 'done') return w;
  patch('workouts', id, { status: 'done', ended_at: at.toISOString(), notes: notes ?? w.notes });
  run('DELETE FROM rest_timers');
  return getWorkout(id);
};

export const listWorkouts = (from?: string, to?: string, limit = 50) =>
  all<Row>(`SELECT w.*, (SELECT COUNT(*) FROM sets s WHERE s.workout_id = w.id AND s.deleted_at IS NULL AND s.type != 'warmup') AS working_sets
    FROM workouts w WHERE w.deleted_at IS NULL AND (? IS NULL OR w.day >= ?) AND (? IS NULL OR w.day <= ?) ORDER BY w.started_at DESC LIMIT ?`,
  from ?? null, from ?? null, to ?? null, to ?? null, limit);

export const deleteWorkout = (id: string) => { softDelete('workouts', id); run('UPDATE sets SET deleted_at = ? WHERE workout_id = ?', now(), id); recomputeAllPrs(); };

// ---------- e1RM + PRs ----------
/** Epley estimated 1RM. Null above 12 reps or without weight. */
export const e1rm = (weight?: number | null, reps?: number | null) => {
  if (!weight || !reps || reps < 1 || reps > 12) return null;
  return reps === 1 ? weight : round(weight * (1 + reps / 30), 1);
};

type SetRow = { id: string; workout_id: string; exercise_id: string; type: string; weight: number | null; reps: number | null; done_at: string | null };
const prCandidates = (s: SetRow) => {
  const out: [string, number][] = [];
  if (s.type === 'warmup') return out;
  if (s.weight && s.weight > 0) out.push(['heaviest', s.weight]);
  const e = e1rm(s.weight, s.reps);
  if (e) out.push(['e1rm', e]);
  if (s.weight && s.reps) out.push(['volume', round(s.weight * s.reps, 1)]);
  if (s.reps) out.push([`reps@${s.weight ?? 0}`, s.reps]);
  return out;
};

/** True when the exercise has a working set in an earlier (not this) workout. Without one, a "PR" is just a first record. */
export const hasEarlierSession = (exercise_id: string, workout_id: string) => !!one(`SELECT 1 FROM sets s JOIN workouts w ON w.id = s.workout_id
  JOIN workouts cur ON cur.id = ? WHERE s.exercise_id = ? AND s.workout_id != ? AND s.deleted_at IS NULL AND w.deleted_at IS NULL
  AND s.type != 'warmup' AND w.started_at < cur.started_at LIMIT 1`, workout_id, exercise_id, workout_id);

export type Pr = { kind: string; value: number; previous: number | null };

/**
 * Apply PRs for one set. Records always update, but a PR is only reported once the exercise has an earlier session:
 * the first-ever session sets a baseline, not a PR.
 */
const applyPrs = (s: SetRow) => {
  const got: Pr[] = [];
  const report = hasEarlierSession(s.exercise_id, s.workout_id);
  for (const [kind, value] of prCandidates(s)) {
    const cur = one<{ value: number }>('SELECT value FROM prs WHERE exercise_id = ? AND kind = ?', s.exercise_id, kind);
    if (!cur || value > cur.value) {
      run(`INSERT INTO prs (exercise_id, kind, value, set_id, at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (exercise_id, kind) DO UPDATE SET value = excluded.value, set_id = excluded.set_id, at = excluded.at`, s.exercise_id, kind, value, s.id, s.done_at ?? now());
      if (report && cur) got.push({ kind, value, previous: cur.value });
    }
  }
  return got;
};

/** Readable PR label: heaviest, e1rm, volume, reps@<kg>. */
export const prLabel = (kind: string) => {
  if (kind === 'heaviest') return 'Heaviest weight';
  if (kind === 'e1rm') return 'Best estimated 1-rep max';
  if (kind === 'volume') return 'Best set volume';
  const m = /^reps@(.+)$/.exec(kind);
  if (m) return Number(m[1]) > 0 ? `Most reps at ${Number(m[1])} kg` : 'Most reps';
  return kind;
};

/** PRs held by sets of this workout (exercises with an earlier session only). */
export const workoutPrs = (workout_id: string) =>
  all<{ exercise_id: string; exercise_name: string; kind: string; value: number; set_id: string }>(`SELECT p.exercise_id, e.name AS exercise_name, p.kind, p.value, p.set_id
    FROM prs p JOIN sets s ON s.id = p.set_id JOIN exercises e ON e.id = p.exercise_id WHERE s.workout_id = ? AND s.deleted_at IS NULL ORDER BY e.name, p.kind`, workout_id)
    .filter((p) => hasEarlierSession(p.exercise_id, workout_id))
    .map((p) => ({ ...p, label: prLabel(p.kind) }));

export const recomputePrs = (exercise_id: string) => {
  run('DELETE FROM prs WHERE exercise_id = ?', exercise_id);
  for (const s of all<SetRow>(`SELECT s.* FROM sets s JOIN workouts w ON w.id = s.workout_id WHERE s.exercise_id = ? AND s.deleted_at IS NULL
    AND w.deleted_at IS NULL ORDER BY s.done_at, s.idx`, exercise_id)) applyPrs(s);
};
const recomputeAllPrs = () => { for (const r of all<{ id: string }>('SELECT DISTINCT exercise_id AS id FROM sets')) recomputePrs(r.id); };

export const listPrs = (exercise?: string) => {
  const ex = exercise ? need(findExercise(exercise), 'exercise') : null;
  return all<Row>(`SELECT p.*, e.name AS exercise_name FROM prs p JOIN exercises e ON e.id = p.exercise_id
    WHERE (? IS NULL OR p.exercise_id = ?) AND p.kind NOT LIKE 'reps@%' ORDER BY e.name, p.kind`, ex?.id ?? null, ex?.id ?? null);
};

// ---------- sets ----------
export type SetIn = { id?: string; workout_id?: string; exercise: string; type?: string; weight?: number; reps?: number; seconds?: number;
  distance?: number; rpe?: number; at?: string; note?: string; unit?: 'kg' | 'lb'; rest_s?: number };

/** Log one set into the given (or active) workout. Same id twice = one row. Returns the set and any new PRs. */
export const logSet = (s: SetIn) => {
  const wid = s.workout_id ?? activeWorkout()?.id;
  if (!wid) bad('no workout running; start one first');
  const w = getWorkout(String(wid));
  const ex = need(findExercise(s.exercise), `exercise "${s.exercise}"`);
  const type = s.type ?? 'working';
  if (!SET_TYPES.includes(type as never)) bad(`type must be one of ${SET_TYPES.join(', ')}`);
  let weight = s.weight;
  if (weight !== undefined && s.unit === 'lb') weight = round(weight * 0.45359237, 2);
  if (weight !== undefined && !(weight >= 0 && weight <= 1000)) bad('weight must be 0-1000 kg');
  if (s.reps !== undefined && !(Number.isInteger(s.reps) && s.reps >= 0 && s.reps <= 500)) bad('reps must be a whole number 0-500');
  if (s.rpe !== undefined && !(s.rpe >= 1 && s.rpe <= 10)) bad('RPE must be 1-10');
  if (ex.kind === 'weight_reps' && s.reps === undefined) bad('reps are needed');
  if ((ex.kind === 'time' || ex.kind === 'distance_time') && s.seconds === undefined && s.distance === undefined) bad('time or distance is needed');
  // Bodyweight exercises: no extra load means weight 0 (PRs then track reps@0). Volume stays load x reps, so bodyweight sets add 0 kg.
  if (ex.kind === 'reps' && weight === undefined) weight = 0;
  const id = idOr(s.id);
  const existed = one('SELECT 1 FROM sets WHERE id = ?', id);
  if (!existed) {
    const idx = Number(one<{ n: number }>('SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM sets WHERE workout_id = ?', w.id)!.n);
    insert('sets', { id, workout_id: w.id, exercise_id: ex.id, idx, type, weight: weight ?? null, reps: s.reps ?? null, seconds: s.seconds ?? null,
      distance: s.distance ?? null, rpe: s.rpe ?? null, done_at: s.at ?? now(), note: String(s.note ?? '').slice(0, 300) });
  }
  const row = one<SetRow>('SELECT * FROM sets WHERE id = ?', id)!;
  const prs = existed ? [] : applyPrs(row);
  if (!existed && s.rest_s !== 0) {
    const rest = s.rest_s ?? Number(one<{ r: number }>('SELECT rest_s AS r FROM routine_items WHERE routine_id = ? AND exercise_id = ? AND deleted_at IS NULL', w.routine_id, ex.id)?.r ?? 120);
    startRest(rest, ex.name);
  }
  return { set: row, prs: prs.map((p) => ({ ...p, label: prLabel(p.kind) })) };
};

export const updateSet = (id: string, f: { weight?: number; reps?: number; type?: string; rpe?: number; note?: string }) => {
  const cur = need(one<SetRow>('SELECT * FROM sets WHERE id = ? AND deleted_at IS NULL', id), 'set');
  if (f.type && !SET_TYPES.includes(f.type as never)) bad('bad set type');
  patch('sets', id, f);
  recomputePrs(cur.exercise_id);
  return one<Row>('SELECT * FROM sets WHERE id = ?', id)!;
};
export const deleteSet = (id: string) => {
  const cur = need(one<SetRow>('SELECT * FROM sets WHERE id = ?', id), 'set');
  softDelete('sets', id);
  recomputePrs(cur.exercise_id);
};

// ---------- history + progression ----------
/** The most recent finished (or current) session's sets for an exercise. */
export const lastPerformance = (exercise: string, beforeWorkout?: string) => {
  const ex = need(findExercise(exercise), `exercise "${exercise}"`);
  const w = one<{ id: string; day: string }>(`SELECT w.id, w.day FROM workouts w JOIN sets s ON s.workout_id = w.id
    WHERE s.exercise_id = ? AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND (? IS NULL OR w.id != ?) ORDER BY w.started_at DESC LIMIT 1`,
  ex.id, beforeWorkout ?? null, beforeWorkout ?? null);
  if (!w) return { exercise: ex.name, day: null, sets: [] as Row[] };
  return { exercise: ex.name, day: w.day, sets: all<Row>(`SELECT type, weight, reps, seconds, distance, rpe FROM sets WHERE workout_id = ? AND exercise_id = ?
    AND deleted_at IS NULL ORDER BY idx`, w.id, ex.id) };
};

/**
 * Double progression: if every working set last time hit rep_max → add the exercise increment, reps back to rep_min.
 * Else same weight, aim +1 rep on the sets that fell short. Deload = a lighter week, no stall talk.
 */
export const suggestNext = (exercise: string, rep_min = 8, rep_max = 12, deload = false) => {
  const ex = need(findExercise(exercise), `exercise "${exercise}"`);
  const last = lastPerformance(ex.id);
  const working = last.sets.filter((s) => s.type !== 'warmup' && s.reps);
  if (!working.length) return { exercise: ex.name, weight: null, reps: rep_min, why: 'no history yet: pick a weight you can do for ' + rep_max + ' clean reps' };
  const top = Math.max(...working.map((s) => Number(s.weight ?? 0)));
  const atTop = working.filter((s) => Number(s.weight ?? 0) === top);
  if (deload) { const inc = ex.increment > 0 ? ex.increment : 2.5; return { exercise: ex.name, weight: round(Math.round((top * 0.9) / inc) * inc, 2), reps: rep_min, why: 'lighter week: about 90% of last top weight' }; }
  if (atTop.every((s) => Number(s.reps) >= rep_max)) {
    return { exercise: ex.name, weight: round(top + ex.increment, 2), reps: rep_min, why: `all sets hit ${rep_max}: add ${ex.increment} kg` };
  }
  const minReps = Math.min(...atTop.map((s) => Number(s.reps)));
  return { exercise: ex.name, weight: top, reps: Math.min(rep_max, minReps + 1), why: `same weight, aim for ${Math.min(rep_max, minReps + 1)} reps` };
};

/** Working sets per primary muscle for the Monday-Sunday week holding `day` (secondary muscles count half). */
export const muscleVolume = (day: string) => {
  const weekStart = weekStartOf(day);
  const end = addDays(weekStart, 6);
  const rows = all<{ p: string; s: string }>(`SELECT e.primary_muscles AS p, e.secondary_muscles AS s FROM sets st JOIN workouts w ON w.id = st.workout_id
    JOIN exercises e ON e.id = st.exercise_id WHERE st.deleted_at IS NULL AND w.deleted_at IS NULL AND st.type != 'warmup' AND w.day BETWEEN ? AND ?`, weekStart, end);
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const m of j<string[]>(r.p, [])) out[m] = (out[m] ?? 0) + 1;
    for (const m of j<string[]>(r.s, [])) out[m] = (out[m] ?? 0) + 0.5;
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([muscle, sets]) => ({ muscle, sets }));
};

export const exerciseHistory = (exercise: string, limit = 30) => {
  const ex = need(findExercise(exercise), `exercise "${exercise}"`);
  return all<Row>(`SELECT w.day, MAX(s.weight) AS top_weight, MAX(CASE WHEN s.reps <= 12 THEN s.weight * (1 + s.reps / 30.0) END) AS best_e1rm,
    SUM(COALESCE(s.weight, 0) * COALESCE(s.reps, 0)) AS volume, COUNT(*) AS sets FROM sets s JOIN workouts w ON w.id = s.workout_id
    WHERE s.exercise_id = ? AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND s.type != 'warmup' GROUP BY w.id ORDER BY w.started_at DESC LIMIT ?`, ex.id, limit)
    .map((r) => ({ ...r, best_e1rm: r.best_e1rm === null ? null : round(Number(r.best_e1rm), 1) }));
};

// ---------- helpers ----------
/** Warm-up ramp toward a working weight: 40%×5, 60%×3, 80%×2 (rounded to 2.5 kg, never below the bar). */
export const warmup = (working: number, bar = 20) => {
  if (!(working > 0)) bad('working weight must be > 0');
  if (working <= bar) return [{ weight: bar, reps: 8 }];
  return [[0.4, 5], [0.6, 3], [0.8, 2]].map(([p, reps]) => ({ weight: Math.max(bar, Math.round((working * p) / 2.5) * 2.5), reps }))
    .filter((s, i, a) => i === 0 || s.weight > a[i - 1].weight);
};

/** Plates per side for a barbell. Returns plates and any remainder that cannot be loaded. */
export const plates = (target: number, bar = 20, available = [25, 20, 15, 10, 5, 2.5, 1.25]) => {
  if (!(target >= bar)) bad(`target must be at least the bar (${bar} kg)`);
  let side = round((target - bar) / 2, 3);
  const out: number[] = [];
  for (const p of [...available].sort((a, b) => b - a)) while (side + 1e-9 >= p) { out.push(p); side = round(side - p, 3); }
  return { per_side: out, loaded: round(bar + 2 * out.reduce((a, b) => a + b, 0), 2), remainder: round(side * 2, 2) };
};

// ---------- rest timer (absolute end time; server pushes when due) ----------
export const startRest = (seconds: number, label = 'Rest') => {
  if (!(seconds > 0 && seconds <= 900)) return null;
  const ends = new Date(Date.now() + seconds * 1000).toISOString();
  run(`INSERT INTO rest_timers (id, ends_at, label, pushed) VALUES (1, ?, ?, 0) ON CONFLICT (id) DO UPDATE SET ends_at = excluded.ends_at, label = excluded.label, pushed = 0`, ends, label);
  return { ends_at: ends, label };
};
export const getRest = () => one<{ ends_at: string; label: string; pushed: number }>('SELECT ends_at, label, pushed FROM rest_timers WHERE id = 1') ?? null;
export const clearRest = () => run('DELETE FROM rest_timers');
/** For the 5-s/1-min cron: returns the timer once when due, then marks it pushed. */
export const dueRest = (at = new Date()) => {
  const t = getRest();
  if (!t || t.pushed || Date.parse(t.ends_at) > at.getTime()) return null;
  run('UPDATE rest_timers SET pushed = 1 WHERE id = 1');
  return t;
};

// ---------- imports ----------
const ALIASES: Record<string, string> = {
  'bench press (barbell)': 'barbell bench press - medium grip', 'bench press': 'barbell bench press - medium grip',
  'squat (barbell)': 'barbell squat', 'squat': 'barbell squat', 'deadlift (barbell)': 'barbell deadlift', 'deadlift': 'barbell deadlift',
  'overhead press (barbell)': 'standing military press', 'overhead press': 'standing military press',
  'bent over row (barbell)': 'bent over barbell row', 'pull up': 'pullups', 'pull-up': 'pullups', 'chin up': 'chin-up',
  'lat pulldown (cable)': 'wide-grip lat pulldown', 'lat pulldown': 'wide-grip lat pulldown',
  'bicep curl (dumbbell)': 'dumbbell bicep curl', 'triceps pushdown (cable)': 'triceps pushdown', 'leg press': 'leg press',
  'push up': 'pushups', 'push-up': 'pushups', 'plank': 'plank',
};
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Exact → alias → token-overlap fuzzy (>= 0.6 Jaccard) → create an own exercise. */
export const matchExercise = (name: string, kindHint = 'weight_reps'): { exercise: Exercise; how: 'exact' | 'alias' | 'fuzzy' | 'created' } => {
  const exact = findExercise(name);
  if (exact) return { exercise: exact, how: 'exact' };
  const alias = ALIASES[name.toLowerCase().trim()];
  const a = alias ? findExercise(alias) : null;
  if (a) return { exercise: a, how: 'alias' };
  const toks = new Set(normName(name).split(' ').filter((t) => t.length > 1));
  let best: { r: Row; score: number } | null = null;
  for (const r of all<Row>('SELECT * FROM exercises WHERE deleted_at IS NULL')) {
    const t2 = new Set(normName(String(r.name)).split(' ').filter((t) => t.length > 1));
    const inter = [...toks].filter((t) => t2.has(t)).length;
    const score = inter / (toks.size + t2.size - inter || 1);
    if (!best || score > best.score) best = { r, score };
  }
  if (best && best.score >= 0.6) return { exercise: toEx(best.r), how: 'fuzzy' };
  return { exercise: addExercise({ name: name.trim(), kind: kindHint }), how: 'created' };
};

type ImpSet = { exercise: string; type: string; weight?: number; reps?: number; seconds?: number; distance?: number; rpe?: number; note?: string };
type ImpWorkout = { ref: string; name: string; start: Date; end: Date | null; notes: string; sets: ImpSet[] };
const writeImported = (list: ImpWorkout[], dryRun: boolean) => {
  let added = 0, skipped = 0, sets = 0; const created: string[] = [];
  for (const w of list) {
    if (one('SELECT 1 FROM workouts WHERE import_ref = ?', w.ref)) { skipped++; continue; }
    added++; sets += w.sets.length;
    if (dryRun) continue;
    const id = uuid();
    insert('workouts', { id, name: w.name.slice(0, 100), started_at: w.start.toISOString(), ended_at: (w.end ?? w.start).toISOString(), notes: w.notes,
      status: 'done', day: lifeDay(w.start), import_ref: w.ref });
    w.sets.forEach((s, i) => {
      const m = matchExercise(s.exercise, s.seconds && !s.reps ? 'time' : 'weight_reps');
      if (m.how === 'created') created.push(m.exercise.name);
      insert('sets', { id: uuid(), workout_id: id, exercise_id: m.exercise.id, idx: i, type: s.type, weight: s.weight ?? null, reps: s.reps ?? null,
        seconds: s.seconds ?? null, distance: s.distance ?? null, rpe: s.rpe ?? null, done_at: new Date(w.start.getTime() + i * 1000).toISOString(), note: s.note ?? '' });
    });
  }
  if (!dryRun) recomputeAllPrs();
  return { added, skipped, sets, created_exercises: [...new Set(created)], dryRun };
};
const n = (v: unknown) => { const s = String(v ?? '').replace(',', '.').trim(); if (!s) return undefined; const x = Number(s); return Number.isFinite(x) ? x : undefined; };
const setType = (v: unknown) => { const s = String(v ?? '').toLowerCase(); return s.startsWith('warm') || s === 'w' ? 'warmup' : s.startsWith('drop') || s === 'd' ? 'drop' : s.startsWith('fail') || s === 'f' ? 'failure' : 'working'; };

/** Strong CSV: Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, Distance, Seconds, Notes, Workout Notes, RPE. Weights assumed kg unless unit = 'lb'. */
export const importStrong = (csv: string, dryRun = false, unit: 'kg' | 'lb' = 'kg') => {
  const rows = parseCsv(csv);
  if (!rows.length || !('Exercise Name' in rows[0]) || !('Date' in rows[0])) bad('not a Strong CSV export');
  const by = new Map<string, ImpWorkout>();
  const f = unit === 'lb' ? 0.45359237 : 1;
  for (const r of rows) {
    const start = localOrIso(String(r.Date));
    if (Number.isNaN(start.getTime())) continue;
    const ref = `strong:${sha(`${r.Date}|${r['Workout Name']}`).slice(0, 24)}`;
    const w = by.get(ref) ?? { ref, name: String(r['Workout Name'] || 'Workout'), start, end: null, notes: String(r['Workout Notes'] ?? ''), sets: [] };
    const dur = String(r.Duration ?? '');
    const mins = (Number(/(\d+)h/.exec(dur)?.[1] ?? 0) * 60) + Number(/(\d+)m/.exec(dur)?.[1] ?? 0);
    if (mins) w.end = new Date(start.getTime() + mins * 60000);
    const so = String(r['Set Order'] ?? '');
    if (/rest/i.test(so)) { by.set(ref, w); continue; }
    const wt = n(r.Weight);
    w.sets.push({ exercise: String(r['Exercise Name']), type: setType(so), weight: wt !== undefined ? round(wt * f, 2) : undefined, reps: n(r.Reps),
      seconds: n(r.Seconds) || undefined, distance: n(r.Distance) || undefined, rpe: n(r.RPE), note: String(r.Notes ?? '') });
    by.set(ref, w);
  }
  return writeImported([...by.values()], dryRun);
};

/** "2026-11-03 19:30:00" (wall time in TZ) or an ISO string with its own offset → Date. */
const localOrIso = (s: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(s.trim());
  return m ? zonedDate(m[1], m[2]) : new Date(s.replace(' ', 'T'));
};

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** Hevy dates look like "3 Nov 2026, 19:30" (local) or ISO. */
export const parseHevyDate = (s: string) => {
  const m = /^(\d{1,2}) (\w{3})\w* (\d{4}),? (\d{1,2}):(\d{2})/.exec(String(s).trim());
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    const p = (x: number | string) => String(x).padStart(2, '0');
    return zonedDate(`${m[3]}-${p(MONTHS[m[2].toLowerCase()] + 1)}-${p(m[1])}`, `${p(m[4])}:${m[5]}`);
  }
  return new Date(String(s));
};

/** Hevy CSV: title, start_time, end_time, description, exercise_title, superset_id, exercise_notes, set_index, set_type, weight_kg, reps, distance_km, duration_seconds, rpe. */
export const importHevy = (csv: string, dryRun = false) => {
  const rows = parseCsv(csv);
  if (!rows.length || !('exercise_title' in rows[0]) || !('start_time' in rows[0])) bad('not a Hevy CSV export');
  const by = new Map<string, ImpWorkout>();
  for (const r of rows) {
    const start = parseHevyDate(String(r.start_time));
    if (Number.isNaN(start.getTime())) continue;
    const ref = `hevy:${sha(`${r.start_time}|${r.title}`).slice(0, 24)}`;
    const end = parseHevyDate(String(r.end_time));
    const w = by.get(ref) ?? { ref, name: String(r.title || 'Workout'), start, end: Number.isNaN(end.getTime()) ? null : end, notes: String(r.description ?? ''), sets: [] };
    const km = n(r.distance_km);
    w.sets.push({ exercise: String(r.exercise_title), type: setType(r.set_type === 'normal' ? 'working' : r.set_type), weight: n(r.weight_kg), reps: n(r.reps),
      seconds: n(r.duration_seconds) || undefined, distance: km ? km * 1000 : undefined, rpe: n(r.rpe), note: String(r.exercise_notes ?? '') });
    by.set(ref, w);
  }
  return writeImported([...by.values()], dryRun);
};

export const gymSummary = (today = lifeToday()) => {
  const act = activeWorkout();
  const last = one<Row>(`SELECT id, name, day FROM workouts WHERE status = 'done' AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1`);
  const week = listWorkouts(addDays(today, -6), today, 20);
  return { active: act ? { id: act.id, name: act.name, sets: act.working_sets, minutes: act.minutes } : null, last, workouts_7d: week.length, rest: getRest() };
};
