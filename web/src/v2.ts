// Typed client for /api/v2 (Phase 2 modules: tasks, habits, goals, money, food, gym, body, brain, asks).
// Shapes mirror app/api/src/modules/*. Every create sends a client id so a retried request is idempotent.
import { enc, q, request } from './api';
import { sendOrQueue } from './outbox';

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

// ---- Tasks ----
export type V2View = 'today' | 'needs_day' | 'upcoming' | 'inbox' | 'anytime' | 'someday' | 'waiting' | 'done' | 'trash' | 'all';
export type V2Task = {
  id: string;
  title: string;
  notes: string;
  project_id: string | null;
  parent_id: string | null;
  section: string | null;
  status: 'open' | 'done' | 'dropped';
  priority: number;
  tags: string[];
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  est_minutes: number | null;
  first_action: string | null;
  done_def: string | null;
  recur: string | null;
  pinned: boolean;
  waiting_for: string | null;
  someday: boolean;
  goal_id: string | null;
  source: string;
  event_id: string | null;
  sort: number;
  done_at: string | null;
  deleted_at: string | null;
  project_name: string | null;
  recur_text: string | null;
};
export type TaskInput = Partial<{
  id: string;
  title: string;
  notes: string;
  project: string | null;
  due_date: string | null;
  due_time: string | null;
  est_minutes: number | null;
  first_action: string | null;
  done_def: string | null;
  priority: number;
  pinned: boolean;
  someday: boolean;
  waiting_for: string | null;
  tags: string[];
}>;
export type Counts = { today: number; needs_day: number; upcoming: number; inbox: number; waiting: number };
export type Capacity = { day: string; planned_minutes: number; free_minutes: number; unestimated: number; tasks: number };
/** minutes = the timer to start: the running block's time left, else the task estimate, else 10. reason 'block' = the task of the block running now. */
export type WhatNow = { task: V2Task; first_action: string | null; minutes?: number; reason?: 'block' | 'pick' } | null;
export type V2Project = { id: string; name: string; status: string; emoji: string | null; open_count: number };

export type Habit = { id: string; name: string; target_per_week: number; archived: boolean; this_week: number; today: number };
export type Goal = {
  id: string;
  name: string;
  why: string | null;
  target_value: number | null;
  unit: string | null;
  target_date: string | null;
  status: string;
  current: number | null;
  current_day: string | null;
  open_tasks: number;
};

// ---- Money ----
export type Account = { id: string; name: string; type: string; currency: string; track: string; opening_balance: number; balance: number; archived: boolean };
export type MoneyRecord = {
  id: string;
  account_id: string;
  kind: 'expense' | 'income' | 'transfer';
  amount: number;
  currency: string;
  rate_to_usd: number | null;
  rate_estimated: boolean;
  usd: number | null;
  category_id: string | null;
  labels: string[];
  note: string;
  payee: string | null;
  day: string;
  at: string;
  direction: number;
  account_name: string;
  track: string;
  category_name: string | null;
  parent_category: string | null;
};
export type MoneySummary = {
  from: string;
  to: string;
  track: string;
  spend_usd: number;
  income_usd: number;
  net_usd: number;
  records: number;
  estimated_rates: number;
  by_category: { name: string; usd: number }[];
};
/** Living cash (car fund and money still owed taken out) ÷ weekly spend. `lasts_to` = "Cash lasts to about <date>". */
export type Runway = {
  cash_usd: number; weekly_burn_usd: number; weeks_measured: number; runway_weeks: number | null; under_8_weeks: boolean;
  goal_usd?: number; owed_usd?: number; lasts_to?: string | null;
};
export type Budget = { id: string; name: string; period: string; amount_usd: number; spent_usd: number; left_usd: number; share: number; from: string; to: string; category_ids?: string[] };
export type Savings = { id: string; name: string; target_usd: number; target_date: string | null; saved_usd: number; left_usd: number; monthly_needed_usd: number | null; account_id?: string | null };
export type Debt = { id: string; person: string; direction: 'lent' | 'borrowed'; amount: number; currency: string; note: string; account_id: string | null; closed: boolean; repaid: number; left: number };
export type Rate = { currency: string; day: string; to_usd: number };
export type ShoppingItem = { id: string; list: string; name: string; qty: string | null; done: boolean | number };
export type Category = { id: string; name: string; kind: string; parent_id: string | null; parent_name: string | null; track: string };

// ---- Food ----
export type Macros = { kcal: number; protein: number; carbs: number; fat: number };
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snacks' | 'late';
/** Always shown. The others (late) show only on days they hold food. */
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snacks'];
export const EXTRA_SLOTS: Slot[] = ['late'];
export type FoodEntry = Macros & { id: string; slot: Slot; name: string; grams: number | null; estimate: number | boolean; food_id: string | null };
export type FoodDay = {
  day: string;
  total: Macros;
  slots: Partial<Record<Slot, { entries: FoodEntry[]; total: Macros }>>;
  water_ml: number;
  status: string | null;
  target: (Macros & { from_day: string; method: string }) | null;
  left: { kcal: number; protein: number } | null;
  estimates: number;
  note: string;
};
export type DayStatus = 'complete' | 'partial';
export type Tdee = {
  adaptive: { from: string; to: string; counted_days: number; weigh_ins: number; tdee: number | null; reason?: string; avg_intake?: number; weekly_rate_kg?: number; note?: string };
  suggestion: { kcal: number | null; protein?: number | null; method: string | null; tdee?: number; floored?: boolean; missing?: string[]; reason?: string };
};
export type FoodItem = Macros & { id: string; name: string; brand: string | null; source: string; uses: number };
export type LogIn = Partial<{ id: string; day: string; slot: Slot; food: string; grams: number; qty: number; name: string; kcal: number; protein: number; carbs: number; fat: number; estimate: boolean }>;

// ---- Gym ----
export type RoutineItem = { exercise_id: string; exercise_name: string; sets: number; rep_min: number | null; rep_max: number | null; rest_s: number | null; kind: string };
export type Routine = { id: string; name: string; items: RoutineItem[] };
export type WorkoutRow = { id: string; name: string; day: string; started_at: string; ended_at: string | null; status: string; working_sets: number };
export type GymSet = {
  id: string;
  workout_id: string;
  exercise_id: string;
  exercise_name: string;
  idx: number;
  type: 'warmup' | 'working' | 'drop' | 'failure';
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  rpe: number | null;
  done_at: string;
};
/** A personal record from one set. kind: heaviest | e1rm | volume | reps@<kg>. Never on the first session of an exercise. */
export type Pr = { exercise_id?: string; exercise_name?: string; kind: string; value: number; previous?: number | null; set_id?: string; label: string };
export type Workout = WorkoutRow & { routine_id: string | null; notes: string; sets: GymSet[]; volume_kg: number; minutes: number | null; prs?: Pr[] };
export type MuscleVolume = { muscle: string; sets: number }[];
export type Rest = { ends_at: string; label: string } | null;
export type NextSet = { exercise: string; weight: number | null; reps: number; why: string };
export type Exercise = { id: string; name: string; kind: string; equipment: string | null; primary_muscles: string[]; increment: number };
export type SetIn = Partial<{ id: string; workout_id: string; exercise: string; type: GymSet['type']; weight: number; reps: number; seconds: number; rpe: number; rest_s: number }>;

// ---- Body ----
export type Metric = { id: string; day: string; kind: string; value: number; unit: string };
export type BodySummary = {
  last_weight: { day: string; kg: number } | null;
  trend_kg: number | null;
  change_7d: number | null;
  change_28d: number | null;
  weigh_ins_21d: number;
  /** Mean weigh-in of the last 7 days and of the 7 before (older servers omit them). */
  avg_7d?: number | null;
  avg_prev_7d?: number | null;
  latest: Record<string, Metric>;
  note: string;
};

// ---- Asks + brain ----
export type Ask = { id: string; key: string; module: string; question: string; why: string | null; answer_type: 'choice' | 'number' | 'text'; options: string[]; priority: number; status: string };
export type BrainHit = {
  kind: string; id: string; title: string; snippet?: string; conflict?: boolean; day?: string;
  amount?: number; currency?: string; income?: boolean; kcal?: number; status?: string;
};
export type BrainSearch = { q: string; results: Record<string, BrainHit[]>; total: number };

// ---- Life snapshot ----
export type LifeSnapshot = {
  day: string;
  mode: string;
  tasks: { counts: Counts; what_now: WhatNow; capacity: Capacity };
  habits: Habit[];
  goals: Goal[];
  money: { week: MoneySummary; runway: Runway };
  food: { total: Macros; target: FoodDay['target']; water_ml: number };
  gym: { active: WorkoutRow | null; last: { id: string; name: string; day: string } | null; workouts_7d: number; rest: Rest };
  body: BodySummary;
  asks_open: { key: string; question: string }[];
  note: string;
  next_anchor?: Anchor | null;
  days_away?: DaysAway | null;
  rescue?: boolean | null;
  closed?: CloseDay | null;
  first_thing?: string | null;
  done?: DoneCounts | null;
  screentime?: ScreenGlance | null;
  car?: import('./features/car/client').CarGlance | null;
};

// ---- Extras (time, day, documents, wishlist, cards, screen time) ----
export type Anchor = { name: string; key: string; at: string; hhmm: string; in_minutes: number };
export type TimerGuard = { ok: boolean; minutes: number; suggest_minutes?: number; next: Anchor | null; message?: string };
export type DoneCounts = {
  tasks: number; focus_minutes: number; focus_sessions: number; sets: number; workouts: number;
  food_entries: number; water_ml: number; money_records: number; habit_checks: number; cards_reviewed: number;
};
export type DoneList = { from: string; to: string; tasks: { id: string; title: string; done_at: string; tags: string[]; project_name: string | null }[]; counts: DoneCounts; note: string };
/** Rescue = Zero for one life-day: ends at ends_at (next 04:00) unless kept; tonight's run plans tomorrow in `after`. */
export type Rescue = { mode: string; sheet?: unknown; push_silence_until: string; menu: string[]; next: WhatNow; message: string; ends_at?: string | null; after?: string; titles_cleared?: number; titles_error?: string | null };
export type CloseDay = { day: string; closed_at: string; first_thing: string | null; note: string | null; counts: DoneCounts; done: string[]; message: string };
export type DaysAway = { days: number; last_at: string | null; returning: boolean; message?: string | null };
/** One register for every paper with a date (passport, ID, licence, car papers with car_id + tag "car"). Never the numbers. */
export type Doc = {
  id: string; name: string; expires_on: string | null; where_kept: string | null; note: string | null; days_left: number | null;
  tags?: string[]; car_id?: string | null; kind?: string | null; amount?: number | null; currency?: string | null;
  state?: 'ok' | 'soon' | 'ended' | 'no_date' | 'renewed'; renewed?: boolean; line?: string;
};
export type Wish = {
  id: string; name: string; price: number; currency: string; usd: number | null; ready_on: string; note: string | null;
  status: 'waiting' | 'bought' | 'dropped'; pushed: boolean; ready: boolean; hours_left: number;
};
export type Afford = {
  amount: number; currency: string; usd: number; rate_estimated: boolean;
  cash_usd: number; cash_after_usd: number; weekly_burn_usd: number; from?: 'living_cash' | 'savings_goal';
  runway_weeks: number | null; runway_after_weeks: number | null; under_8_weeks_after: boolean; weeks_of_spend: number | null;
  car_fund: { name: string; saved_usd?: number; saved_after_usd?: number; left_usd: number; left_after_usd: number; target_date: string | null; monthly_needed_usd: number | null; monthly_needed_after_usd: number | null } | null;
  cooling_off: string | null;
};
export type PriceMemory = {
  q: string; count: number;
  last: { amount: number; currency: string; day: string; note: string } | null;
  stats: { currency: string; n: number; last: number; min: number; max: number; avg: number }[];
  entries: { amount: number; currency: string; day: string; note: string }[];
};
export type Estimates = { overall: { n: number; ratio: number | null }; by_tag: { tag: string; n: number; ratio: number }[]; min_samples: number; note: string };
export type EstimateHint = { minutes: number; suggest: number; ratio: number; from: string } | null;
export type Card = {
  id: string; front: string; back: string; deck: string; gender: 'm' | 'f' | null; example: string | null;
  due: string; stability: number; difficulty: number; reps: number; lapses: number; state: string; interval_days?: number; duplicate?: boolean;
};
export type CardQueue = { cards: Card[]; due: number; new: number; total: number };
export type CardDraft = { front: string; back: string; gender: 'm' | 'f' | null; deck: string; needs_back: boolean; note?: string };
export type DumpItem = { kind: 'task' | 'expense' | 'note'; text: string };
export type DumpResult = { tasks: number; expenses: number; notes: number; failed: { text: string; error: string }[] };
export type Weather = { place: string; temp_c?: number; text?: string; max_c?: number; min_c?: number; rain_pct?: number; cached?: boolean; stale?: boolean; error?: string };
export type TodayRoutine = { active: Workout | null; routine: Routine | null; last: { routine_id: string; name: string; day: string } | null };
export type ScreenDevice = { device: string; kind: string; last_sync: string };
export type ScreenSummary = {
  from: string; to: string; days: number; total_minutes: number; avg_minutes_per_day: number;
  per_device: { device: string; kind: string | null; minutes: number }[];
  top_apps: { app: string; kind: string; minutes: number; devices: string[] }[];
  by_day: { day: string; minutes: number }[];
  devices: ScreenDevice[];
  note: string;
};
export type ScreenGlance = { total_minutes: number; top_apps: { app: string; minutes: number }[]; devices: number };

// ---- Notifications (push centre) ----
export const PUSH_CATS = ['tasks', 'blocks', 'timer', 'gym', 'brief', 'docs', 'wishlist', 'nightly', 'ops', 'custom'] as const;
export type PushCat = (typeof PUSH_CATS)[number];
export type PushStatus = 'sent' | 'held' | 'failed' | 'deduped' | 'muted';
export type PushResult = { status: PushStatus; reason?: string | null; until?: string | null };
export type PushPrefs = {
  cats: Record<PushCat, boolean>;
  block_lead_min: number;
  hourly_cap: number;
  snooze_min: number;
  labels: Record<PushCat, string>;
};
export type PushLogRow = { id: number; at: string; cat: string; title: string; message: string; priority: number; status: PushStatus; reason: string | null; key: string | null };
export type HeldPush = { id: number; key: string | null; title: string; message: string; cat: string; priority: number; reason: string; held_at: string; expires_at: string | null };
export type ScheduledPush = { id: number; key: string | null; at: string; title: string; message: string; cat: string; task_id: string | null; created_at: string };
export type UpcomingPush = { at: string; hhmm: string; kind: 'block' | 'task' | 'scheduled'; title: string; task_id: string | null; id?: number };
export type PushCentre = {
  quiet: boolean;
  reason: string | null;
  until: string | null;
  sleep: { start: string; wake: string };
  mode: string;
  held: number;
  upcoming: UpcomingPush[];
  last24h: Record<PushStatus, number>;
  last_sent: PushLogRow | null;
};

const P = '/api/v2';
const get = <T>(path: string) => request<T>('GET', P + path);
/** Creates (body has a client id) go through the offline outbox; everything else is sent directly. */
const post = <T>(path: string, body: unknown = {}) =>
  body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string'
    ? sendOrQueue<T>('POST', P + path, body as Record<string, unknown>)
    : request<T>('POST', P + path, body);
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', P + path, body);
const del = <T>(path: string) => request<T>('DELETE', P + path);


export type Question = { id: string; text: string; status: 'open' | 'answered' | 'dropped'; answer_md: string | null; answered_at: string | null; created_at: string; duplicate?: boolean };
export type Fits = { gap_min: number | null; anchor: Anchor | null; tasks: V2Task[]; reason: string | null };
export type Similar = { id: string; title: string; due_date: string | null; score: number };
export type CompostRun = { moved: number; titles: string[]; dry_run: boolean };
export type Triage = { items: V2Task[]; inbox_total: number; promoted_today: { id: string; title: string } | null };
export type TriageAction = 'project' | 'someday' | 'trash' | 'keep';

export const v2 = {
  life: () => get<LifeSnapshot>('/life'),

  asks: (n = 3) => get<Ask[]>('/asks' + q({ n })),
  answerAsk: (ref: string, value: string | number) => post<{ ok: boolean }>(`/asks/${enc(ref)}/answer`, { value }),
  skipAsk: (ref: string, days = 7) => post<{ ok: boolean }>(`/asks/${enc(ref)}/skip`, { days }),

  tasks: (view: V2View, project?: string | null, query?: string) => get<V2Task[]>('/tasks' + q({ view, project, q: query })),
  counts: () => get<Counts>('/tasks/counts'),
  now: () => get<{ what_now: WhatNow; capacity: Capacity }>('/tasks/now'),
  quickAdd: (text: string, extra: TaskInput = {}) => post<V2Task & { similar?: Similar[] }>('/tasks', { id: newId(), ...extra, text }),
  addTask: (t: TaskInput & { title: string }) => post<V2Task & { similar?: Similar[] }>('/tasks', { id: newId(), ...t }),
  patchTask: (id: string, p: TaskInput) => patch<V2Task>(`/tasks/${enc(id)}`, p),
  setDay: (ids: string[], day: string | null) => post<{ updated: number }>('/tasks/set-day', { ids, day }),
  done: (id: string) => post<V2Task>(`/tasks/${enc(id)}/done`),
  reopen: (id: string) => post<V2Task>(`/tasks/${enc(id)}/reopen`),
  /** Not today: a one-off moves to tomorrow, a recurring task to its next occurrence. prev_due restores it (setDay). */
  skip: (id: string) => post<V2Task & { prev_due: string | null }>(`/tasks/${enc(id)}/skip`),
  doneMonth: () => get<{ month: string; tasks: number }>('/done/month'),
  removeTask: (id: string) => del<V2Task>(`/tasks/${enc(id)}`),
  restore: (id: string) => post<V2Task>(`/tasks/${enc(id)}/restore`),
  focus: (id: string, minutes: number, started_at: string) => post<unknown>(`/tasks/${enc(id)}/focus`, { minutes, started_at, id: newId() }),
  projects: () => get<V2Project[]>('/projects'),

  habits: () => get<Habit[]>('/habits'),
  addHabit: (name: string, target_per_week: number) => post<Habit>('/habits', { name, target_per_week, id: newId() }),
  checkHabit: (ref: string, count = 1, day?: string) => post<Habit>(`/habits/${enc(ref)}/check`, { count, day }),
  goals: () => get<Goal[]>('/goals'),
  goalValue: (id: string, value: number) => post<Goal>(`/goals/${enc(id)}/value`, { value }),

  accounts: () => get<Account[]>('/money/accounts'),
  categories: () => get<Category[]>('/money/categories'),
  records: (p: { from?: string; to?: string; q?: string; limit?: number; kind?: 'expense' | 'income' | 'transfer' } = {}) => get<MoneyRecord[]>('/money/records' + q(p)),
  addAccount: (a: { name: string; currency: string; type?: string; track?: 'personal' | 'business'; opening_balance?: number }) =>
    post<Account>('/money/accounts', { id: newId(), ...a }),
  patchAccount: (id: string, a: Partial<{ name: string; archived: boolean; opening_balance: number }>) => patch<Account>(`/money/accounts/${enc(id)}`, a),
  transfer: (t: { from: string; to: string; amount: number; to_amount?: number; day?: string; note?: string }) => post<unknown>('/money/transfer', { id: newId(), ...t }),
  rates: () => get<Rate[]>('/money/rates'),
  /** `to_usd` = how many USD one unit is worth (EUR: USD per euro). */
  setRate: (currency: string, to_usd: number, day?: string) => post<Rate>('/money/rates', { currency, to_usd, day }),
  setWeeklyBudget: (amount_usd: number) => post<Budget>('/money/budgets/weekly', { amount_usd }),
  addBudget: (b: { name: string; period: 'week' | 'month' | 'year'; amount_usd: number; categories?: string[] }) => post<Budget>('/money/budgets', { id: newId(), ...b }),
  patchBudget: (id: string, b: Partial<{ name: string; amount_usd: number; period: string; categories: string[] }>) => patch<Budget>(`/money/budgets/${enc(id)}`, b),
  deleteBudget: (id: string) => del<unknown>(`/money/budgets/${enc(id)}`),
  addSavings: (g: { name: string; target_usd: number; target_date?: string; account?: string }) => post<Savings>('/money/savings', { id: newId(), ...g }),
  patchSavings: (id: string, g: Partial<{ name: string; target_usd: number; target_date: string | null; account: string | null }>) => patch<Savings>(`/money/savings/${enc(id)}`, g),
  deleteSavings: (id: string) => del<unknown>(`/money/savings/${enc(id)}`),
  debts: () => get<Debt[]>('/money/debts'),
  addDebt: (d: { person: string; direction: 'lent' | 'borrowed'; amount: number; currency?: string; account?: string; note?: string; record?: boolean }) =>
    post<Debt>('/money/debts', { id: newId(), ...d }),
  repayDebt: (id: string, amount: number, account?: string) => post<Debt>(`/money/debts/${enc(id)}/repay`, { amount, account }),
  quickLog: (text: string, account?: string) => post<MoneyRecord>('/money/records', { id: newId(), text, account }),
  deleteRecord: (id: string) => del<unknown>(`/money/records/${enc(id)}`),
  summary: (period: 'week' | 'month' | 'year' = 'week') => get<MoneySummary>('/money/summary' + q({ period })),
  runway: () => get<Runway>('/money/runway'),
  budgets: () => get<Budget[]>('/money/budgets'),
  savings: () => get<Savings[]>('/money/savings'),
  shopping: () => get<ShoppingItem[]>('/shopping'),
  addShopping: (name: string, qty?: string) => post<ShoppingItem>('/shopping', { name, qty, id: newId() }),
  toggleShopping: (id: string, done: boolean) => post<ShoppingItem>(`/shopping/${enc(id)}/toggle`, { done }),
  clearShopping: () => post<{ cleared: number }>('/shopping/clear-done'),

  foodDay: (day?: string) => get<FoodDay>('/food/day' + q({ day })),
  foodSearch: (query: string, limit = 12) => get<FoodItem[]>('/food/search' + q({ q: query, limit })),
  logFood: (l: LogIn) => post<FoodEntry>('/food/log', { id: newId(), ...l }),
  deleteLog: (id: string) => del<unknown>(`/food/log/${enc(id)}`),
  water: (ml: number) => post<{ water_ml: number }>('/food/water', { ml, id: newId() }),
  /** Mark a day complete / partial (null clears). Only complete days feed the maintenance estimate. */
  dayStatus: (status: DayStatus | null, day?: string) => post<{ day: string; status: DayStatus | null }>('/food/day-status', { status, day }),
  foodTdee: (rate?: number) => get<Tdee>('/food/tdee' + q({ rate })),

  routines: () => get<Routine[]>('/gym/routines'),
  active: () => get<{ workout: Workout | null; rest: Rest }>('/gym/active'),
  workouts: (limit = 10) => get<WorkoutRow[]>('/gym/workouts' + q({ limit })),
  workout: (id: string) => get<Workout>(`/gym/workouts/${enc(id)}`),
  startWorkout: (routine?: string) => post<Workout>('/gym/workouts', { routine, id: newId() }),
  finishWorkout: (id: string, notes?: string) => post<Workout>(`/gym/workouts/${enc(id)}/finish`, { notes }),
  /** The server answers { set, prs }; flattened so callers keep using the set's id. */
  logSet: (s: SetIn) =>
    post<{ set: GymSet; prs: Pr[] } | GymSet>('/gym/sets', { id: newId(), ...s })
      .then((r): GymSet & { prs?: Pr[] } => ('set' in r && r.set ? { ...r.set, prs: r.prs ?? [] } : (r as GymSet))),
  deleteSet: (id: string) => del<unknown>(`/gym/sets/${enc(id)}`),
  clearRest: () => del<unknown>('/gym/rest'),
  exercises: (query?: string) => get<Exercise[]>('/gym/exercises' + q({ q: query, limit: 20 })),
  /** Double-progression suggestion for the next set of an exercise. */
  nextSet: (ref: string, rep_min?: number | null, rep_max?: number | null, deload?: boolean) =>
    get<{ next: NextSet }>(`/gym/exercises/${enc(ref)}/history` + q({ rep_min, rep_max, deload: deload ? 1 : undefined })).then((r) => r.next),
  /** Working sets per muscle this week (secondary muscles count half). */
  gymVolume: (week?: string) => get<MuscleVolume>('/gym/volume' + q({ week })),

  body: () => get<BodySummary>('/body'),
  metrics: (kind = 'weight') => get<Metric[]>('/body/metrics' + q({ kind })),
  logMetric: (kind: string, value: number, unit?: string) => post<Metric>('/body/metrics', { id: newId(), kind, value, unit }),
  deleteMetric: (id: string) => del<unknown>(`/body/metrics/${enc(id)}`),

  brain: (query: string) => get<BrainSearch>('/brain/search' + q({ q: query, limit: 8 })),

  // Extras
  timerGuard: (minutes: number) => get<TimerGuard>('/timer/guard' + q({ minutes })),
  doneList: (from?: string, to?: string) => get<DoneList>('/done' + q({ from, to })),
  rescue: () => post<Rescue>('/rescue'),
  endRescue: () => post<{ mode: string }>('/rescue/end'),
  keepRescue: () => post<{ mode: string; kept: boolean }>('/rescue/keep'),
  badDay: () => get<{ items: string[] }>('/badday'),
  setBadDay: (items: string[]) => request<{ items: string[] }>('PUT', P + '/badday', { items }),
  closeDayState: () => get<{ closed: CloseDay | null; tomorrow_first: string | null }>('/close-day'),
  closeDay: (first_thing: string, note?: string) => post<CloseDay>('/close-day', { first_thing, note }),
  daysAway: () => get<DaysAway>('/days-away'),
  documents: (o: { car?: string; tag?: string } = {}) => get<Doc[]>('/documents' + q({ car: o.car, tag: o.tag })),
  addDocument: (d: Partial<Doc> & { name: string }) => post<Doc>('/documents', { id: newId(), ...d }),
  patchDocument: (id: string, d: Partial<Doc>) => patch<Doc>(`/documents/${enc(id)}`, d),
  deleteDocument: (id: string) => del<unknown>(`/documents/${enc(id)}`),
  wishlist: (status?: string) => get<Wish[]>('/wishlist' + q({ status })),
  addWish: (w: { name: string; price: number; currency: string; note?: string }) => post<Wish>('/wishlist', { id: newId(), ...w }),
  wishStatus: (id: string, status: Wish['status']) => post<Wish>(`/wishlist/${enc(id)}/status`, { status }),
  deleteWish: (id: string) => del<unknown>(`/wishlist/${enc(id)}`),
  /** `from` = 'car' (or a savings goal) when it is paid from the car fund; default is living cash. */
  afford: (amount: number, currency = 'USD', from?: string) => get<Afford>('/afford' + q({ amount, currency, from })),
  priceMemory: (query: string) => get<PriceMemory>('/money/price-memory' + q({ q: query })),
  estimates: () => get<Estimates>('/tasks-estimates'),
  estimateHint: (minutes: number, tags: string[] = []) => get<EstimateHint>('/tasks-estimates/hint' + q({ minutes, tags: tags.join(',') || undefined })),
  cards: (deck?: string) => get<Card[]>('/cards' + q({ deck })),
  cardQueue: () => get<CardQueue>('/cards/queue'),
  draftCard: (text: string) => post<CardDraft>('/cards/draft', { text }),
  addCard: (c: { front: string; back: string; gender?: string | null; deck?: string; example?: string }) => post<Card>('/cards', c),
  reviewCard: (id: string, grade: 1 | 2 | 3 | 4) => post<Card>(`/cards/${enc(id)}/review`, { grade }),
  deleteCard: (id: string) => del<unknown>(`/cards/${enc(id)}`),
  brainDump: (text: string) => post<{ items: DumpItem[] }>('/brain-dump', { text }),
  brainDumpCommit: (items: DumpItem[]) => post<DumpResult>('/brain-dump/commit', { items }),
  parked: () => get<V2Task[]>('/park'),
  park: (text: string) => post<{ id: string; title: string; message: string }>('/park', { text }),
  seedLocalFoods: () => post<{ added: number; total: number; note: string }>('/food/seed-local'),
  weather: () => get<Weather>('/weather'),
  todayRoutine: () => get<TodayRoutine>('/gym/today-routine'),
  screentime: (days = 1, day?: string, top = 15) => get<ScreenSummary>('/screentime' + q({ day, days, top })),
  forgetDevice: (device: string) => del<{ device: string; removed_rows: number }>(`/screentime/devices/${enc(device)}`),
  questions: (status?: string) => get<Question[]>('/questions' + q({ status })),
  addQuestion: (text: string) => post<Question>('/questions', { id: newId(), text }),
  answerQuestion: (id: string, answer_md: string) => post<Question>(`/questions/${enc(id)}/answer`, { answer_md }),
  dropQuestion: (id: string) => patch<Question>(`/questions/${enc(id)}`, { status: 'dropped' }),
  fits: () => get<Fits>('/fits'),
  mergeTask: (drop: string, keep: string) => post<V2Task>(`/tasks/${enc(drop)}/merge-into/${enc(keep)}`),
  compost: () => get<{ items: V2Task[]; preview: CompostRun }>('/compost'),
  runCompost: () => post<CompostRun>('/compost/run'),
  restoreCompost: (id: string) => post<V2Task>(`/compost/${enc(id)}/restore`),
  triage: () => get<Triage>('/triage'),
  triageDecide: (id: string, action: TriageAction, o: { project?: string; urgent?: boolean } = {}) =>
    post<{ action: TriageAction; task: V2Task | null }>(`/triage/${enc(id)}`, { action, ...o }),
  // Notifications
  pushStatus: () => get<PushCentre>('/push/status'),
  pushPrefs: () => get<PushPrefs>('/push/prefs'),
  setPushPrefs: (p: Partial<Omit<PushPrefs, 'labels' | 'cats'>> & { cats?: Partial<Record<PushCat, boolean>> }) =>
    request<PushPrefs>('PUT', P + '/push/prefs', p),
  pushLog: (limit = 50, cat?: PushCat) => get<{ items: PushLogRow[] }>('/push/log' + q({ limit, cat })),
  heldPushes: () => get<{ items: HeldPush[] }>('/push/held'),
  dropHeld: (id: number) => del<{ ok: boolean }>(`/push/held/${id}`),
  flushHeld: () => request<{ sent: number; held: number }>('POST', P + '/push/held/flush', {}),
  scheduledPushes: () => get<{ items: ScheduledPush[] }>('/push/scheduled'),
  schedulePush: (p: { at: string; title?: string; message?: string; task_id?: string }) => request<ScheduledPush>('POST', P + '/push/scheduled', p),
  cancelScheduled: (id: number) => del<{ ok: boolean }>(`/push/scheduled/${id}`),
  testPush: () => request<PushResult>('POST', P + '/push/test', {}),
};

// Formatting lives in fmt.ts (one module for every number, unit, date and time).
