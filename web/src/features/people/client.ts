// People endpoints. Calls that life.ts already has go through life.*; the rest are here: people CRUD, promise list/reopen/delete, occasions, waiting check-on, capsules, lent, helped.
// Shapes mirror app/api/src/modules/{people,habitat}/store.ts.
import { enc, q, request } from '../../api';
import { life } from '../../life';

const P = '/api/v2';
const get = <T>(path: string) => request<T>('GET', P + path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', P + path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', P + path, body);
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', P + path, body);
const del = <T>(path: string) => request<T>('DELETE', P + path);

export type Relation = 'family' | 'friend' | 'other';
export const RELATIONS: Relation[] = ['family', 'friend', 'other'];
export type Person = {
  id: string;
  name: string;
  relation: Relation;
  birthday: string | null;
  last_contact: string | null;
  cadence_days: number | null;
  note: string;
  /** Optional, for the call / WhatsApp buttons. Digits, spaces, + ( ) . - only. */
  phone?: string | null;
};
export type PersonInput = Partial<Omit<Person, 'id'>> & { name?: string };
export type Contact = { id: string; day: string; note: string };

export type PromiseStatus = 'open' | 'kept' | 'released';
export type PromiseRow = {
  id: string;
  who: string;
  what: string;
  due: string | null;
  status: PromiseStatus;
  closed_day: string | null;
  created_at: string;
};

export const OCCASION_KINDS = ['birthday', 'anniversary', 'other'] as const;
export type OccasionKind = (typeof OCCASION_KINDS)[number];
export type OccasionRow = { id: string; name: string; kind: string; md: string; year: number | null; person_id: string | null; lead_days: number; note: string };
export type OccasionSoon = {
  id: string;
  source: 'occasion' | 'person';
  name: string;
  kind: string;
  date: string;
  days_until: number;
  person_id: string | null;
  person_name: string | null;
  years: number | null;
  /** Calculated dates are approximate. */
  approx?: boolean;
  note?: string;
};

export type Waiting = { task_id: string; title: string; waiting_for: string; check_on: string; auto: boolean; note?: string };

export type CapsuleView = { id: string; title: string; written_day: string; open_on: string; opened_at: string | null; sealed: boolean; body: string | null };

export type LentRow = {
  id: string;
  thing: string;
  person: string;
  direction: 'lent' | 'borrowed';
  since: string;
  back_by: string | null;
  returned_at: string | null;
  note: string;
};
export type HelpedRow = { id: string; situation: string; thing: string; note: string; created_at: string };

export const people = {
  list: (relation?: Relation) => get<Person[]>('/people' + q({ relation })),
  // The screen asks with screen=1 so Saturday (quiet for pushes) still lists who is due.
  due: (screen = true) =>
    get<(Pick<Person, 'id' | 'name' | 'relation' | 'last_contact' | 'cadence_days' | 'note' | 'phone'> & { days_since: number | null })[]>(
      '/people/due' + q({ screen: screen ? '1' : undefined }),
    ),
  add: (p: PersonInput & { name: string }) => post<Person>('/people', p),
  update: (ref: string, p: PersonInput) => patch<Person>(`/people/${enc(ref)}`, p),
  remove: (ref: string) => del<{ id: string; deleted: boolean }>(`/people/${enc(ref)}`),
  touch: (ref: string, note = '', day?: string) => post<Person>(`/people/${enc(ref)}/touch`, { note, day }),
  contacts: (ref: string, limit = 20) => get<Contact[]>(`/people/${enc(ref)}/contacts` + q({ limit })),

  promises: (status: PromiseStatus | 'all' = 'open') => get<PromiseRow[]>('/promises' + q({ status })),
  addPromise: (b: { who: string; what: string; due?: string | null }) => life.addPromise(b.who, b.what, b.due ?? undefined) as unknown as Promise<PromiseRow>,
  updatePromise: (id: string, b: { who?: string; what?: string; due?: string | null }) => patch<PromiseRow>(`/promises/${enc(id)}`, b),
  keep: (id: string) => post<PromiseRow>(`/promises/${enc(id)}/keep`),
  release: (id: string) => life.releasePromise(id) as unknown as Promise<PromiseRow>,
  reopen: (id: string) => post<PromiseRow>(`/promises/${enc(id)}/reopen`),
  removePromise: (id: string) => del<{ id: string; deleted: boolean }>(`/promises/${enc(id)}`),

  occasions: () => get<OccasionRow[]>('/occasions'),
  occasionsSoon: (within = 60) => get<OccasionSoon[]>('/occasions/soon' + q({ within })),
  addOccasion: (b: { name: string; kind?: string; date?: string; md?: string; year?: number | null; person_id?: string | null; lead_days?: number; note?: string }) =>
    post<OccasionRow>('/occasions', b),
  removeOccasion: (id: string) => del<{ id: string; deleted: boolean }>(`/occasions/${enc(id)}`),

  waiting: () => get<Waiting[]>('/waiting'),
  checkOn: (taskRef: string, b: { day?: string; in_days?: number }) => put<Waiting>(`/waiting/${enc(taskRef)}/check-on`, b),

  capsules: () => life.capsules() as unknown as Promise<CapsuleView[]>,
  capsulesDue: () => get<CapsuleView[]>('/capsules/due'),
  writeCapsule: (b: { body: string; title?: string; in_days?: number; open_on?: string }) =>
    b.in_days !== undefined && !b.open_on
      ? (life.writeCapsule(b.body, b.in_days, b.title) as unknown as Promise<CapsuleView>)
      : post<CapsuleView>('/capsules', b),
  openCapsule: (id: string) => post<CapsuleView>(`/capsules/${enc(id)}/open`),
  removeCapsule: (id: string) => del<{ id: string; deleted: boolean }>(`/capsules/${enc(id)}`),

  lent: (all = false) => (all ? get<LentRow[]>('/lent' + q({ all: '1' })) : (life.lent() as unknown as Promise<LentRow[]>)),
  addLent: (b: { thing: string; person: string; direction: 'lent' | 'borrowed'; back_by?: string; note?: string }) => post<LentRow>('/lent', b),
  returnLent: (id: string) => life.returnLent(id) as unknown as Promise<LentRow>,
  removeLent: (id: string) => del<{ id: string; deleted: boolean }>(`/lent/${enc(id)}`),

  helped: (search?: string) => get<HelpedRow[]>('/helped' + q({ q: search })),
  helpedTop: (n?: number) =>
    n === undefined ? (life.helpedTop() as unknown as Promise<{ thing: string; times: number }[]>) : get<{ thing: string; times: number }[]>('/helped/top' + q({ n })),
  addHelped: (b: { situation: string; thing: string; note?: string }) =>
    b.note ? post<HelpedRow>('/helped', b) : (life.addHelped(b.situation, b.thing) as Promise<HelpedRow>),
  removeHelped: (id: string) => life.removeHelped(id) as Promise<{ id: string; deleted: boolean }>,
};
