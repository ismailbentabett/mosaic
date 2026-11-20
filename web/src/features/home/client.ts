// Home endpoints beyond life.ts: last-done edits, the experiment list and starting one.
// Shapes mirror app/api/src/modules/habitat/store.ts.
import { enc, request } from '../../api';
import type { Experiment, LastDone } from '../../life';

const P = '/api/v2';
const get = <T>(path: string) => request<T>('GET', P + path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', P + path, body);
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', P + path, body);
const del = <T>(path: string) => request<T>('DELETE', P + path);

export type LastDoneX = LastDone & { note?: string | null; last_at?: string | null };
export type ExperimentX = Omit<Experiment, 'line'> & { line: string | null; outcome_note?: string | null; ended_at?: string | null };

export const homeX = {
  addLastDone: (name: string, note?: string) => post<LastDoneX>('/last-done', { name, note }),
  renameLastDone: (id: string, name: string, note?: string) => patch<LastDoneX>(`/last-done/${enc(id)}`, { name, note }),
  removeLastDone: (id: string) => del<{ id: string; deleted: boolean }>(`/last-done/${enc(id)}`),
  experiments: () => get<{ running: ExperimentX | null; all: ExperimentX[] }>('/experiments'),
  /** 1–60 days. Only one runs at a time; the server answers with a conflict otherwise. */
  startExperiment: (b: { name: string; hypothesis?: string; days: number }) => post<ExperimentX>('/experiments', b),
};
