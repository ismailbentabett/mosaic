import { type Rest } from '../../v2';

export const CHIME_KEY = 'mosaic.gym.chime';
/** Last rest end time seen, so the clock is back at once when the page returns (the server keeps the real one). */
export const REST_KEY = 'mosaic.gym.rest';

export type SavedRest = { workout_id: string; ends_at: string; label: string };
export function readRest(workoutId: string): Rest {
  try {
    const r = JSON.parse(localStorage.getItem(REST_KEY) ?? 'null') as SavedRest | null;
    return r && r.workout_id === workoutId && Date.parse(r.ends_at) > Date.now() ? { ends_at: r.ends_at, label: r.label } : null;
  } catch {
    return null;
  }
}
export function saveRest(workoutId: string, rest: Rest) {
  try {
    if (rest) localStorage.setItem(REST_KEY, JSON.stringify({ workout_id: workoutId, ...rest }));
    else localStorage.removeItem(REST_KEY);
  } catch {
    /* storage blocked: the server copy still drives the clock */
  }
}
