// Review endpoints beyond grades.ts/v2.ts/life.ts: office/shop closed days.
// Shape mirrors app/api/src/modules/habitat/store.ts closedDays().
import { q, request } from '../../api';

const P = '/api/v2';

export type ClosedReason = { name: string; kind: 'national' | 'weekly' | 'extra'; estimate: boolean; shifted?: boolean };
export type ClosedDay = { day: string; reasons: ClosedReason[]; estimate: boolean };

export const reviewX = {
  /** Fridays, Saturdays, national days between from and to (max 400 days). */
  closedDays: (from: string, to: string) => request<ClosedDay[]>('GET', `${P}/closed-days${q({ from, to })}`),
};
