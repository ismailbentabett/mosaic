// Body: weight, measurements, progress photo paths, EWMA trend weight. Numbers are estimates, never medical advice.
import { AppError } from '../../errors.ts';
import { addDays, daysBetween, isDate, lifeToday } from '../../time.ts';
import { all, idOr, insert, j, one, round, softDelete } from '../util.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
export const KINDS: Record<string, { unit: string; min: number; max: number }> = {
  weight: { unit: 'kg', min: 25, max: 300 },
  waist: { unit: 'cm', min: 40, max: 200 },
  chest: { unit: 'cm', min: 50, max: 200 },
  hips: { unit: 'cm', min: 50, max: 200 },
  arm: { unit: 'cm', min: 15, max: 70 },
  thigh: { unit: 'cm', min: 25, max: 100 },
  neck: { unit: 'cm', min: 20, max: 70 },
  body_fat: { unit: '%', min: 3, max: 60 },
  sleep_h: { unit: 'h', min: 0, max: 16 },
  steps: { unit: 'steps', min: 0, max: 100000 },
  resting_hr: { unit: 'bpm', min: 30, max: 140 },
};
const LB = 0.45359237;

export type Metric = { id: string; day: string; kind: string; value: number; unit: string };

/** Log one metric. Weight in lb is converted to kg. Same id twice = one row. */
export const logMetric = (m: { id?: string; day?: string; kind: string; value: number; unit?: string }): Metric => {
  const kind = String(m.kind ?? '').toLowerCase().trim();
  const spec = KINDS[kind];
  if (!spec) bad(`kind must be one of ${Object.keys(KINDS).join(', ')}`);
  const day = m.day ?? lifeToday();
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  let value = Number(m.value);
  if (kind === 'weight' && (m.unit === 'lb' || m.unit === 'lbs')) value *= LB;
  if (kind !== 'weight' && m.unit === 'in' && spec.unit === 'cm') value *= 2.54;
  value = round(value, 2);
  if (!Number.isFinite(value) || value < spec.min || value > spec.max) bad(`${kind} must be between ${spec.min} and ${spec.max} ${spec.unit}`);
  const id = idOr(m.id);
  insert('body_metrics', { id, day, kind, value, unit: spec.unit });
  return one<Metric>('SELECT id, day, kind, value, unit FROM body_metrics WHERE id = ?', id)!;
};

export const deleteMetric = (id: string) => softDelete('body_metrics', id);

export const listMetrics = (kind: string, from?: string, to?: string) =>
  all<Metric>(`SELECT id, day, kind, value, unit FROM body_metrics WHERE deleted_at IS NULL AND kind = ?
    AND (? IS NULL OR day >= ?) AND (? IS NULL OR day <= ?) ORDER BY day, created_at`, kind, from ?? null, from ?? null, to ?? null, to ?? null);

/** One value per day (mean of that day's entries). */
export const dailyWeights = (from?: string, to?: string) => {
  const by = new Map<string, number[]>();
  for (const r of listMetrics('weight', from, to)) by.set(r.day, [...(by.get(r.day) ?? []), r.value]);
  return [...by].map(([day, v]) => ({ day, kg: v.reduce((a, b) => a + b, 0) / v.length }));
};

/**
 * EWMA trend weight per day from the first weigh-in to `to`. Days without a weigh-in carry the trend.
 * alpha 0.1 per day (Hacker's Diet style). Returns [] with no weigh-ins.
 */
export const trend = (to = lifeToday(), alpha = 0.1) => {
  const w = dailyWeights(undefined, to);
  if (!w.length) return [] as { day: string; trend: number; kg?: number }[];
  const map = new Map(w.map((x) => [x.day, x.kg]));
  const out: { day: string; trend: number; kg?: number }[] = [];
  let t = w[0].kg;
  for (let d = w[0].day; d <= to; d = addDays(d, 1)) {
    const kg = map.get(d);
    if (kg !== undefined) t = t + alpha * (kg - t);
    out.push({ day: d, trend: round(t, 2), kg });
  }
  return out;
};

export const trendOn = (day: string) => trend(day).at(-1)?.trend ?? null;

export const bodySummary = (today = lifeToday()) => {
  const tr = trend(today);
  const last = dailyWeights(undefined, today).at(-1) ?? null;
  const at = (d: string) => tr.find((x) => x.day === d)?.trend ?? null;
  const now = tr.at(-1)?.trend ?? null;
  const diff = (d: number) => { const p = at(addDays(today, -d)); return now !== null && p !== null ? round(now - p, 2) : null; };
  const latest: Record<string, Metric> = {};
  for (const r of all<Metric>(`SELECT id, day, kind, value, unit FROM body_metrics WHERE deleted_at IS NULL AND day <= ? ORDER BY day, created_at`, today)) latest[r.kind] = r;
  const avg = (from: string, to: string) => { const w = dailyWeights(from, to); return w.length ? round(w.reduce((a, x) => a + x.kg, 0) / w.length, 1) : null; };
  const avg7 = avg(addDays(today, -6), today), prev7 = avg(addDays(today, -13), addDays(today, -7));
  return {
    last_weight: last ? { day: last.day, kg: round(last.kg, 2) } : null,
    /** Mean of the weigh-ins in the last 7 days, and in the 7 before. The headline uses these, not single weigh-ins. */
    avg_7d: avg7,
    avg_prev_7d: prev7,
    trend_kg: now,
    change_7d: diff(7),
    change_28d: diff(28),
    weigh_ins_21d: dailyWeights(addDays(today, -20), today).length,
    latest,
    note: 'Trend smooths daily water swings. Estimates only.',
  };
};

// ---------- profile facts used for estimates ----------
const fact = <T>(key: string): T | undefined => {
  const r = one<{ value: string }>('SELECT value FROM profile_facts WHERE key = ?', key);
  return r ? j<T>(r.value, r.value as unknown as T) : undefined;
};

/** Mifflin-St Jeor BMR (kcal/day). sex 'male' | 'female'. */
export const mifflin = (p: { sex: string; weight_kg: number; height_cm: number; age: number }) => {
  if (!(p.weight_kg > 0 && p.height_cm > 0 && p.age > 0)) bad('weight, height and age are needed');
  const base = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age;
  return Math.round(base + (String(p.sex).toLowerCase().startsWith('f') ? -161 : 5));
};
export const ACTIVITY: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725, very_high: 1.9 };

/** BMR + starting TDEE from profile facts and the trend weight. Null fields say what is missing (the app asks, not chat). */
export const estimateFromProfile = (today = lifeToday()) => {
  const sex = fact<string>('body.sex');
  const height = Number(fact('body.height_cm'));
  const birthYear = Number(fact('body.birth_year'));
  const activity = String(fact('body.activity') ?? 'moderate');
  const weight = trendOn(today);
  const missing = [!sex && 'body.sex', !(height > 0) && 'body.height_cm', !(birthYear > 1900) && 'body.birth_year', weight === null && 'weight'].filter(Boolean) as string[];
  if (missing.length) return { bmr: null, tdee: null, missing };
  const age = Number(today.slice(0, 4)) - birthYear;
  const bmr = mifflin({ sex: sex!, weight_kg: weight!, height_cm: height, age });
  return { bmr, tdee: Math.round(bmr * (ACTIVITY[activity] ?? 1.55)), missing, weight_kg: weight, method: 'mifflin' };
};

export const weeksBetween = (a: string, b: string) => daysBetween(a, b) / 7;
