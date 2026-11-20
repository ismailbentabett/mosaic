// Profile facts + the asks engine. The APP asks personal/body questions (one card at a time, always skippable).
// Claude may propose facts; a proposal never overwrites something the user answered themselves.
import { AppError } from '../../errors.ts';
import { addDays, lifeToday } from '../../time.ts';
import { all, j, now, one, run, uuid } from '../util.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };

export type AnswerType = 'number' | 'choice' | 'text' | 'yes_no';
export type AskSeed = { key: string; module: string; question: string; why: string; answer_type: AnswerType; options?: string[]; min?: number; max?: number; priority?: number };

/** Questions the app asks over time. Higher priority = asked sooner. Key = the profile fact it fills. */
export const SEED: AskSeed[] = [
  { key: 'body.sex', module: 'body', question: 'Sex (for the calorie estimate formula)?', why: 'Mifflin-St Jeor needs it.', answer_type: 'choice', options: ['male', 'female'], priority: 90 },
  { key: 'body.height_cm', module: 'body', question: 'Height in cm?', why: 'Calorie estimate.', answer_type: 'number', min: 120, max: 230, priority: 89 },
  { key: 'body.birth_year', module: 'body', question: 'Birth year?', why: 'Calorie estimate uses age.', answer_type: 'number', min: 1930, max: 2015, priority: 88 },
  { key: 'body.activity', module: 'body', question: 'Day-to-day activity outside the gym?', why: 'Starting TDEE multiplier. The app corrects it from your data later.', answer_type: 'choice', options: ['sedentary', 'light', 'moderate', 'high', 'very_high'], priority: 87 },
  { key: 'gym.days_per_week', module: 'gym', question: 'Gym days per week you aim for?', why: 'Weekly gym count on the Body tile.', answer_type: 'number', min: 0, max: 7, priority: 65 },
  { key: 'money.monthly_fixed_usd', module: 'money', question: 'Fixed monthly personal costs in USD (rough)?', why: 'Runway and goal what-if before 8 weeks of data.', answer_type: 'number', min: 0, max: 100000, priority: 55 },
  { key: 'focus.hardest_time', module: 'focus', question: 'Hardest time of day to start things?', why: 'The planner keeps hard tasks out of that slot.', answer_type: 'choice', options: ['morning', 'afternoon', 'evening', 'night'], priority: 50 },
  { key: 'focus.reminder_style', module: 'focus', question: 'Reminder style?', why: '"none" stops the weekly goal check-in card.', answer_type: 'choice', options: ['few', 'normal', 'none'], priority: 45 },
];
/**
 * Asks removed in Mosaic #41 because nothing read their answer (an ask that changes nothing is a chore).
 * Pending ones are retired on boot; answers already given stay as profile facts.
 * Wired keys: gym.days_per_week (grades body input), money.monthly_fixed_usd (runway + goalWhatIf),
 * focus.hardest_time (hardestWindow → goalsNextStep.avoid_window),
 * focus.reminder_style ('none' = no weekly confidence ask).
 */
export const RETIRED_ASKS = ['goal.weight', 'goal.weight_rate', 'food.show_numbers', 'food.avoid', 'gym.experience', 'money.rate_source'];
/** Bounds for asks created at runtime (pattern → min/max), e.g. the weekly goal confidence 1–5. */
const PATTERN_BOUNDS: [RegExp, number, number][] = [[/^goals\.confidence\./, 1, 5]];
const specOf = (key: string): { min?: number; max?: number } | undefined => {
  const s = SEED.find((x) => x.key === key);
  if (s) return s;
  const p = PATTERN_BOUNDS.find(([re]) => re.test(key));
  return p ? { min: p[1], max: p[2] } : undefined;
};

/** Hardest time of day to start things (focus.hardest_time) as a local-time window, or null if not answered. */
export const HARD_WINDOWS: Record<string, { from: string; to: string }> = {
  morning: { from: '07:30', to: '13:00' }, afternoon: { from: '13:00', to: '17:30' },
  evening: { from: '17:30', to: '22:30' }, night: { from: '22:30', to: '23:30' },
};
export const hardestWindow = (): { slot: string; from: string; to: string } | null => {
  const r = one<{ value: string }>(`SELECT value FROM profile_facts WHERE key = 'focus.hardest_time'`);
  if (!r) return null;
  const slot = String(j<unknown>(r.value, r.value)).toLowerCase();
  const w = HARD_WINDOWS[slot];
  return w ? { slot, ...w } : null;
};

/** Insert seed asks that don't exist yet. Safe to run on every boot. */
export const seedAsks = () => {
  let n = 0;
  for (const s of SEED) {
    const r = run(`INSERT INTO asks (id, key, module, question, why, answer_type, options, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`,
      uuid(), s.key, s.module, s.question, s.why, s.answer_type, JSON.stringify(s.options ?? []), s.priority ?? 50);
    n += Number(r.changes);
  }
  run(`UPDATE asks SET status = 'skipped', skip_until = '9999-12-31' WHERE key IN (${RETIRED_ASKS.map(() => '?').join(',')}) AND status <> 'answered'
    AND (status <> 'skipped' OR skip_until IS NULL OR skip_until <> '9999-12-31')`, ...RETIRED_ASKS);
  return n;
};

/** Usual weekday wake time (profile.wake_time, "HH:MM"), default 07:30. For Today evening timing. */
export const wakeTime = (): string => {
  const r = one<{ value: string }>(`SELECT value FROM profile_facts WHERE key = 'profile.wake_time'`);
  const v = r ? String(j<unknown>(r.value, r.value)) : '';
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '07:30';
};

export type Ask = { id: string; key: string; module: string; question: string; why: string; answer_type: AnswerType; options: string[]; priority: number; status: string };
const toAsk = (r: Record<string, unknown>): Ask => ({
  id: String(r.id), key: String(r.key), module: String(r.module), question: String(r.question), why: String(r.why),
  answer_type: r.answer_type as AnswerType, options: j<string[]>(String(r.options), []), priority: Number(r.priority), status: String(r.status),
});

/** Add a custom ask (e.g. Claude needs a fact). Same key twice = existing ask kept. */
export const addAsk = (a: AskSeed) => {
  if (!/^[a-z_]+\.[a-z0-9_.]+$/.test(a.key ?? '')) bad('key must look like module.name');
  if (!['number', 'choice', 'text', 'yes_no'].includes(a.answer_type)) bad('answer_type must be number, choice, text or yes_no');
  if (a.answer_type === 'choice' && !(a.options?.length)) bad('choice needs options');
  if (!a.question?.trim()) bad('question is required');
  run(`INSERT INTO asks (id, key, module, question, why, answer_type, options, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`,
    uuid(), a.key, a.module || a.key.split('.')[0], a.question.trim(), a.why ?? '', a.answer_type, JSON.stringify(a.options ?? []), a.priority ?? 50);
  return toAsk(one('SELECT * FROM asks WHERE key = ?', a.key)!);
};

/** Next asks to show: open, or skipped whose skip_until has passed. Skips facts that are already known. */
export const asksNext = (n = 1, today = lifeToday()) => {
  seedAsks();
  return all(`SELECT * FROM asks a WHERE (a.status = 'open' OR (a.status = 'skipped' AND (a.skip_until IS NULL OR a.skip_until <= ?)))
      AND NOT EXISTS (SELECT 1 FROM profile_facts f WHERE f.key = a.key AND f.source = 'user')
    ORDER BY a.priority DESC, a.key LIMIT ?`, today, Math.max(1, Math.min(20, n))).map(toAsk);
};

const findAsk = (ref: string) => {
  const r = one('SELECT * FROM asks WHERE id = ? OR key = ?', ref, ref);
  if (!r) throw new AppError('not_found', `No ask ${ref}`);
  return toAsk(r);
};

/** Validate + coerce an answer for its ask type. */
export const coerce = (a: Ask, value: unknown): unknown => {
  const spec = specOf(a.key);
  if (a.answer_type === 'number') {
    const n = Number(value);
    if (value === '' || value === null || !Number.isFinite(n)) bad('Answer must be a number');
    if (spec?.min !== undefined && n < spec.min) bad(`Answer must be at least ${spec.min}`);
    if (spec?.max !== undefined && n > spec.max) bad(`Answer must be at most ${spec.max}`);
    return n;
  }
  if (a.answer_type === 'choice') {
    const s = String(value ?? '').trim().toLowerCase();
    const hit = a.options.find((o) => o.toLowerCase() === s);
    if (!hit) bad(`Answer must be one of ${a.options.join(', ')}`);
    return hit;
  }
  if (a.answer_type === 'yes_no') {
    const s = String(value).toLowerCase();
    if (['yes', 'y', 'true', '1'].includes(s) || value === true) return true;
    if (['no', 'n', 'false', '0'].includes(s) || value === false) return false;
    bad('Answer must be yes or no');
  }
  const s = String(value ?? '').trim();
  if (!s) bad('Answer is empty');
  if (s.length > 500) bad('Answer is too long (500 max)');
  return s;
};

const setFact = (key: string, value: unknown, source: string, confidence: number) =>
  run(`INSERT INTO profile_facts (key, value, source, confidence, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, source = excluded.source, confidence = excluded.confidence, updated_at = excluded.updated_at`,
    key, JSON.stringify(value), source, confidence, now());

/** Answer an ask (by id or key). Writes the profile fact with source 'user'. */
export const asksAnswer = (ref: string, value: unknown) => {
  const a = findAsk(ref);
  const v = coerce(a, value);
  setFact(a.key, v, 'user', 1);
  run(`UPDATE asks SET status = 'answered', answered_at = ?, skip_until = NULL WHERE id = ?`, now(), a.id);
  return { key: a.key, value: v };
};

/** Skip: comes back after `days` (default 7); days = 0 means "don't ask again". Every ask is skippable; skipping leaves no other mark. */
export const asksSkip = (ref: string, days = 7, today = lifeToday()) => {
  const a = findAsk(ref);
  const d = Number(days);
  const until = d === 0 ? '9999-12-31' : addDays(today, Math.max(1, Math.min(365, Math.round(Number.isFinite(d) ? d : 7))));
  run(`UPDATE asks SET status = 'skipped', skip_until = ?, asked_at = COALESCE(asked_at, ?) WHERE id = ?`, until, now(), a.id);
  return { key: a.key, skip_until: until };
};

export type Fact = { key: string; value: unknown; source: string; confidence: number; updated_at: string };
/** All facts, or those under a prefix ('body.'). */
export const profileGet = (prefix = ''): Fact[] =>
  all<{ key: string; value: string; source: string; confidence: number; updated_at: string }>(
    `SELECT * FROM profile_facts WHERE key LIKE ? ESCAPE '\\' ORDER BY key`, prefix.replace(/[\\%_]/g, (c) => '\\' + c) + '%')
    .map((r) => ({ key: r.key, value: j(r.value, r.value), source: r.source, confidence: Number(r.confidence), updated_at: r.updated_at }));

/**
 * Claude (or an import) proposes a fact. Never overwrites a fact the user answered (source 'user').
 * If an ask exists for the key, its answer is still asked unless confidence is 1 from 'import'.
 */
export const profilePropose = (key: string, value: unknown, source = 'claude', confidence = 0.6) => {
  if (!/^[a-z_]+\.[a-z0-9_.]+$/.test(key ?? '')) bad('key must look like module.name');
  if (source === 'user') bad('source "user" is reserved for answers in the app');
  if (value === undefined || value === null || value === '') bad('value is required');
  const c = Math.max(0, Math.min(1, Number(confidence)));
  const cur = one<{ source: string; confidence: number }>('SELECT source, confidence FROM profile_facts WHERE key = ?', key);
  if (cur?.source === 'user') return { key, stored: false, reason: 'answered by you' };
  if (cur && cur.confidence > c) return { key, stored: false, reason: 'existing fact has higher confidence' };
  const ask = one<Record<string, unknown>>('SELECT * FROM asks WHERE key = ?', key);
  const v = ask ? coerce(toAsk(ask), value) : value;
  setFact(key, v, source, c);
  return { key, stored: true, value: v };
};
