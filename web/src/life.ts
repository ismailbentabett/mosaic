// Client for the people, thrift and habitat modules (migrations v10–v13).
// Shapes mirror app/api/src/modules/{people,thrift,habitat}/store.ts.
import { enc, q, request } from './api';

const P = '/api/v2';
const get = <T>(path: string) => request<T>('GET', P + path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', P + path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', P + path, body);
const del = <T>(path: string) => request<T>('DELETE', P + path);

export type Promise_ = { id: string; who: string; what: string; due: string | null; status: 'open' | 'kept' | 'released'; days_until?: number | null; when?: string };
export type PersonDue = { id: string; name: string; relation: string; last_contact: string | null; cadence_days: number; days_since: number | null; note: string; phone?: string | null };
export type Occasion = { id: string; name: string; kind: string; date: string; days_until: number; person_name: string | null; years: number | null; approx?: boolean; note?: string };
export type WaitingDue = { id: string; title: string; waiting_for: string | null; check_on: string | null };
export type Capsule = { id: string; title: string; body?: string; open_on: string; opened_at: string | null; written_day?: string };
export type Experiment = { id: string; name: string; hypothesis: string; start_day: string; end_day: string; status: string; day_n: number; length_days: number; past_end: boolean; line: string };
export type HabitatToday = {
  day: string; rest_day: boolean;
  usual_buys: { name: string; line?: string; days_until?: number }[];
  last_done_count: number;
  experiment: Experiment | null;
  lent_open: { count: number; lent: number; borrowed: number };
  free_to_spend: { free: number | null; reason?: string; estimate: boolean; currency?: string; line?: string };
};
export type Recurring = { rule: string; items: { name: string; monthly_usd?: number; line?: string; allowed?: boolean }[]; count: number; monthly_usd: number; message: string };
export type Skipped = { items: { id: string; name: string | null; amount: number | null; currency: string; usd: number | null; day: string }[]; summary: { total_usd: number; count: number } };
export type ShopGroup = { store: string; count: number; items: { id: string; name: string; qty: string | null; done: boolean }[] };
export type Removed = { table: string; id: string; label: string; deleted_at: string };
export type LastDone = { id: string; name: string; last_day: string | null; days_since: number | null; line: string | null };
export type Helped = { thing: string; times: number };
export type WeekFacts = { week_start: string; week_end: string; tasks_done: number; focus_minutes: number; habit_checks: number; gym_workouts: number; expenses: number; spend_personal_usd: number; food_days_logged: number; promises_kept: number };
export type Lent = { id: string; thing: string; person: string; direction: 'lent' | 'borrowed'; since: string; back_by: string | null };
export type SwapOption = { name: string; title: string; start: string; end: string; must: boolean };
export type Forecast = { ends_at?: string; minutes_left?: number; line?: string };
export type CarryForward = { exercise: string; note: string | null; line?: string } | null;

export const life = {
  habitat: () => get<HabitatToday>('/habitat/today'),
  promisesSoon: () => get<Promise_[]>('/promises/soon'),
  addPromise: (who: string, what: string, due?: string) => post<Promise_>('/promises', { who, what, due }),
  keepPromise: (id: string) => post<Promise_>(`/promises/${enc(id)}/keep`),
  releasePromise: (id: string) => post<Promise_>(`/promises/${enc(id)}/release`),
  // Screens pass screen=1: Saturday is quiet for pushes, not for the list.
  peopleDue: (screen = true) => get<PersonDue[]>('/people/due' + q({ screen: screen ? '1' : undefined })),
  touch: (ref: string, note = '') => post<unknown>(`/people/${enc(ref)}/touch`, { note }),
  occasionsSoon: () => get<Occasion[]>('/occasions/soon'),
  waitingDue: () => get<WaitingDue[]>('/waiting/due'),
  capsulesDue: () => get<Capsule[]>('/capsules/due'),
  capsules: () => get<Capsule[]>('/capsules'),
  writeCapsule: (body: string, in_days: number, title?: string) => post<Capsule>('/capsules', { body, in_days, title }),
  openCapsule: (id: string) => post<Capsule & { body: string }>(`/capsules/${enc(id)}/open`),
  weekFacts: (week?: string) => get<WeekFacts>('/week-facts' + q({ week })),
  recurring: () => get<Recurring>('/thrift/recurring'),
  skipped: () => get<Skipped>('/thrift/skipped'),
  skip: (name: string, amount?: number, currency = 'USD') => post<unknown>('/thrift/skipped', { name, amount, currency }),
  shopGroups: (list?: string) => get<ShopGroup[]>('/thrift/shop-groups' + q({ list })),
  removed: () => get<Removed[]>('/removed'),
  restore: (table: string, id: string) => post<unknown>(`/removed/${enc(table)}/${enc(id)}/restore`),
  lastDone: () => get<LastDone[]>('/last-done'),
  stamp: (name: string) => post<LastDone>('/last-done/stamp', { name }),
  helpedTop: () => get<Helped[]>('/helped/top'),
  addHelped: (situation: string, thing: string) => post<unknown>('/helped', { situation, thing }),
  lent: () => get<Lent[]>('/lent'),
  returnLent: (id: string) => post<Lent>(`/lent/${enc(id)}/return`),
  swap: (block: string) => get<SwapOption[]>('/blocks/swap' + q({ block })),
  carryForward: (exercise: string) => get<CarryForward>('/gym/carry-forward' + q({ exercise })),
  setNextNote: (exercise: string, note: string) => put<unknown>('/gym/next-note', { exercise, note }),
  forecast: (id: string) => get<Forecast>(`/gym/workouts/${enc(id)}/forecast`),
  endExperiment: (id: string, note: string) => post<unknown>(`/experiments/${enc(id)}/end`, { note }),
  removeHelped: (id: string) => del<unknown>(`/helped/${enc(id)}`),
};
