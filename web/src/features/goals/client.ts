// Goal endpoints that grades.ts does not cover: links to habits/projects and milestone edits.
// Shapes mirror app/api/src/modules/grades/store.ts.
import { enc, request } from '../../api';
import type { GoalLink, Milestone } from '../../grades';

const P = '/api/v2';

export type LinkKind = 'habit' | 'project';

export const goalsX = {
  /** ref = habit/project id or name. Returns the goal's links after the change. */
  link: (goalId: string, kind: LinkKind, ref: string) => request<GoalLink[]>('POST', `${P}/goals2/${enc(goalId)}/links`, { kind, ref }),
  unlink: (goalId: string, kind: LinkKind, ref: string) =>
    request<GoalLink[]>('DELETE', `${P}/goals2/${enc(goalId)}/links/${enc(kind)}/${enc(ref)}`),
  updateMilestone: (id: string, f: { name?: string; due?: string | null }) => request<Milestone>('PATCH', `${P}/milestones/${enc(id)}`, f),
};

/** Letter colour: calm, no red. Nothing is an F. */
export const letterColor = (l: string | null | undefined): string =>
  l === 'A' ? 'teal' : l === 'B' ? 'blue' : l === 'C' ? 'yellow' : 'gray';
