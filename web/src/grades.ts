// Client for the grades + goals v2 module (migration v14). Shapes mirror app/api/src/modules/grades/store.ts.
import { enc, q, request } from './api';

const P = '/api/v2';
const get = <T>(path: string) => request<T>('GET', P + path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', P + path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', P + path, body);
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', P + path, body);
const del = <T>(path: string) => request<T>('DELETE', P + path);

export type GradeFact = { key: string; label: string; actual: number; target: number; share: number; unit: string };
export type AreaGrade = {
  key: string; name: string; emoji: string; letter: string | null; score: number | null;
  status: 'graded' | 'not_graded' | 'light_week'; facts: GradeFact[]; lift: string | null;
};
export type WeekGrades = {
  week_start: string; week_end: string; so_far: boolean; active_days: number; light_week: boolean;
  overall: { letter: string | null; score: number | null };
  areas: AreaGrade[]; best: string | null; lift: string | null;
  day_rating_avg: number | null; day_ratings: { day: string; rating: number }[]; day_rating_count: number; line: string;
  /** Up to 3 plain count facts ("4 Gym sessions"). Letters above stay for old clients only. */
  facts: string[]; change: WeekChange | null;
};
export type WeekChange = { text: string; area: string | null; input: string | null; accepted: boolean; edited: boolean };
export type DoneRange = 'day' | 'week' | 'month';
export type DoneTotals = { tasks: number; gym: number; food_days: number; habits: number; cards: number; money_saved_usd: number };
export type DoneLog = { range: DoneRange; from: string; to: string; entries: { day: string; kind: string; line: string }[]; totals: DoneTotals; month: DoneTotals; month_line: string };
export type NextStep = { area: string; goal_id: string; goal: string; milestone: string | null; milestone_due: string | null; task: string; est_minutes: number; pace_line: string };
export type NextSteps = { day: string; avoid_window: { slot: string; from: string; to: string } | null; steps: NextStep[] };
export type GradeWeek = { week_start: string; overall: string | null; areas: Record<string, string | null> };
export type Area = { id: string | null; key: string | null; name: string; emoji: string; vision: string; sort: number };
export type Milestone = { id: string; goal_id: string; name: string; due: string | null; done_at: string | null };
export type GoalLink = { kind: 'habit' | 'project'; ref: string; name: string | null; this_week?: number; target_per_week?: number | null; open_tasks?: number };
export type GoalV2 = {
  id: string; name: string; why: string; area_id: string | null; target_value: number | null; unit: string | null; target_date: string | null;
  start_value: number | null; start_day: string | null; auto: string | null; horizon: 'quarter' | 'year' | 'life'; status: 'active' | 'paused' | 'done' | 'dropped';
  next_step: string; outcome: number; current: number | null; progress: number | null; expected: number | null; pace: number | null;
  letter: string | null; pace_line: string; weeks_left: number | null; per_week_needed: number | null; next: string | null;
  milestones: Milestone[]; links: GoalLink[]; moment: string | null;
  floor: number | null; stretch_value: number | null; stretch_note: string | null; confidence: number | null;
};
export type GoalTree = { areas: (Area & { goals: GoalV2[] })[]; count: number; graded: number; next_up: { goal_id: string; goal: string; next: string; pace_line: string } | null };
export type GoalTemplate = { key: string; name: string; area: string; auto: string | null; unit: string; horizon: string; why: string; next_step: string; needs: string;
  target_value?: number; target_date?: string; outcome?: boolean; milestones?: readonly string[] };
export type GoalInput = Partial<{ name: string; why: string; area: string | null; target_value: number | null; unit: string | null; target_date: string | null;
  start_value: number | null; auto: string | null; horizon: string; next_step: string; floor_value: number | null; stretch_value: number | null }>;
export type DayRating = { day: string; rating: number; note: string; tags?: string[] | string } | null;
export type RatingTag = string;
export type Patterns = { days: number; needed: number; patterns: { key: string; good_share: number; hard_share: number; diff: number; line: string }[]; line: string };
export type QuietArea = { key: string; name: string; emoji: string; line: string; options: string[] };
export type WhatIf = { goal: string; per_week: number; per_week_usd: number; rate_estimated: boolean; left_usd: number; eta: string | null; on_time: boolean | null;
  runway_months_after: number | null; cash_floor_months: number; capped: boolean; max_per_week_usd: number | null };
export type Quarter = { path: string; weeks: number; milestones: number; goals: number; content: string };

export const grades = {
  week: (week?: string) => get<WeekGrades>(`/grades/week${q({ week })}`),
  /** Legacy letter history. Kept for old clients; the v3 app does not show it. */
  history: (weeks = 8) => get<GradeWeek[]>(`/grades/history${q({ weeks })}`),
  /** Accept the suggested change for a week (no text) or replace it with your own. */
  setChange: (week: string, text?: string) => post<WeekChange>('/grades/change', { week, text }),
  doneLog: (range: DoneRange = 'week') => get<DoneLog>(`/done-log${q({ range })}`),
  nextSteps: () => get<NextSteps>('/goals2/next-step'),
  setTarget: (area: string, input: string, target: number) => put<unknown>('/grades/targets', { area, input, target }),
  areas: () => get<Area[]>('/grades/areas'),
  updateArea: (id: string, f: Partial<Pick<Area, 'name' | 'emoji' | 'vision'>>) => patch<Area>(`/grades/areas/${enc(id)}`, f),
  dayRating: (day?: string) => get<DayRating>(`/day-rating${q({ day })}`),
  rateDay: (rating: number, note = '', day?: string, tags?: string[]) => put<DayRating>('/day-rating', { rating, note, day, tags }),
  ratingTags: () => get<RatingTag[]>('/day-rating/tags'),
  patterns: () => get<Patterns>('/ratings/patterns'),
  quiet: () => get<{ mode: string; areas: QuietArea[] }>('/areas/quiet'),
  quietDismiss: (key: string) => post<{ area: string; until: string }>(`/areas/quiet/${enc(key)}/dismiss`),
  quietStart: (key: string, option: string) => post<unknown>(`/areas/quiet/${enc(key)}/start`, { option }),
  quarterExport: () => post<Quarter>('/grades/quarter-export'),
  quarterPreview: () => get<Quarter>('/grades/quarter'),
  shrink: (id: string) => post<GoalV2>(`/goals2/${enc(id)}/shrink`),
  whatIf: (id: string, per_week: number) => get<WhatIf>(`/goals2/${enc(id)}/whatif${q({ per_week })}`),
  clearDayRating: (day?: string) => del<unknown>(`/day-rating${q({ day })}`),
  tree: (status: 'active' | 'all' = 'active') => get<GoalTree>(`/goals2${q({ status })}`),
  goal: (id: string) => get<GoalV2 & { values: { day: string; value: number }[]; tasks: { id: string; title: string; status: string; due_date: string | null }[] }>(`/goals2/${enc(id)}`),
  templates: () => get<GoalTemplate[]>('/goals2/templates'),
  fromTemplate: (key: string, f: GoalInput = {}) => post<GoalV2>('/goals2/from-template', { key, ...f }),
  create: (f: GoalInput & { name: string }) => post<GoalV2>('/goals2', f),
  update: (id: string, f: GoalInput) => patch<GoalV2>(`/goals2/${enc(id)}`, f),
  remove: (id: string) => del<unknown>(`/goals2/${enc(id)}`),
  repace: (id: string, target_date?: string) => post<GoalV2>(`/goals2/${enc(id)}/repace`, { target_date }),
  pause: (id: string) => post<GoalV2>(`/goals2/${enc(id)}/pause`),
  resume: (id: string) => post<GoalV2>(`/goals2/${enc(id)}/resume`),
  finish: (id: string, status: 'done' | 'dropped' = 'done') => post<GoalV2>(`/goals2/${enc(id)}/finish`, { status }),
  reopen: (id: string) => post<GoalV2>(`/goals2/${enc(id)}/reopen`),
  addMilestone: (id: string, name: string, due?: string) => post<Milestone>(`/goals2/${enc(id)}/milestones`, { name, due }),
  milestoneDone: (id: string, done = true) => post<{ moment?: string }>(`/milestones/${enc(id)}/done`, { done }),
  removeMilestone: (id: string) => del<unknown>(`/milestones/${enc(id)}`),
};
