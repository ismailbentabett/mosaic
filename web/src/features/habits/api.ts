// Habit writes the shared v2 client does not cover yet: an offline-safe check, edit and archive.
import { ApiError, asApiError, enc, request } from '../../api';
import { sendOrQueue } from '../../outbox';
import { newId, type Habit } from '../../v2';

/** Tick (count 1) or untick (count 0) a habit for a day. Queued on this phone when offline. */
export const checkHabit = (id: string, count: number, day: string) =>
  sendOrQueue<Habit>('POST', `/api/v2/habits/${enc(id)}/check`, { id: newId(), count, day });

export type HabitPatch = Partial<{ name: string; target_per_week: number; archived: boolean }>;

/**
 * Rename, change the weekly target, archive or restore (`PATCH /api/v2/habits/:ref`).
 * An older server without the route answers 404/405; that shows a plain message and nothing changes.
 */
export async function patchHabit(id: string, p: HabitPatch): Promise<Habit> {
  try {
    return await request<Habit>('PATCH', `/api/v2/habits/${enc(id)}`, p);
  } catch (e) {
    const err = asApiError(e);
    if (err.status === 404 || err.status === 405) throw new ApiError('unsupported', 'Editing habits needs a server update. Nothing changed.', err.status);
    throw err;
  }
}
