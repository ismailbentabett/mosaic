// The active workout and the next set to log. Used by the Gym screen and by QuickAdd.
import { useEffect, useMemo, useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { feel } from '../../sound';
import { emit, toastUndo, useRefresh } from '../../store';
import { v2, type GymSet, type Routine, type RoutineItem } from '../../v2';
import { prToastLine, setText } from './kit';

export type SetTarget = { exercise: string; weight: number | null; reps: number | null; why?: string };

const NO_HIDDEN: ReadonlySet<string> = new Set();

/**
 * Active workout, its routine plan, and the set to prefill next.
 * Focus = picked, else the last exercise while it still has sets left, else the first unfinished
 * plan item, else the last set's exercise. Target = repeat the last set of the focus, else the
 * server's suggestion for it, else the routine's low rep count.
 */
export function useActiveWorkout(opts: { active?: boolean; hidden?: ReadonlySet<string>; deload?: boolean } = {}) {
  const deload = !!opts.deload;
  const pageActive = usePageActive();
  const active = opts.active ?? pageActive;
  const hidden = opts.hidden ?? NO_HIDDEN;
  const cur = useLoad(() => v2.active(), active, [], { key: 'gym.active' });
  const workout = cur.data?.workout ?? null;
  const rest = cur.data?.rest ?? null;
  const routineId = workout?.routine_id ?? null;
  // Routines only matter for a routine workout; shares its cache with the Routines tab.
  const routines = useLoad<Routine[]>(() => v2.routines(), active && !!routineId, [routineId], { key: 'gym.routines' });
  useRefresh('gym', () => {
    void cur.reload();
    if (routineId) void routines.reload();
  });

  const sets = useMemo(() => (workout?.sets ?? []).filter((s) => !hidden.has(s.id)), [workout, hidden]);
  const plan: Routine | null = (routineId && routines.data?.find((r) => r.id === routineId)) || null;
  const doneOf = (name: string) => sets.filter((s) => s.exercise_name === name && s.type !== 'warmup').length;

  const [picked, setPicked] = useState<string | null>(null);
  // A new workout starts with nothing picked.
  useEffect(() => setPicked(null), [workout?.id]);

  const lastSet: GymSet | undefined = sets[sets.length - 1];
  const lastItem = plan?.items.find((i) => i.exercise_name === lastSet?.exercise_name);
  const focus: string | null =
    picked ??
    (lastItem && doneOf(lastItem.exercise_name) < lastItem.sets ? lastItem.exercise_name : undefined) ??
    plan?.items.find((i) => doneOf(i.exercise_name) < i.sets)?.exercise_name ??
    lastSet?.exercise_name ??
    null;
  const focusItem: RoutineItem | undefined = plan?.items.find((i) => i.exercise_name === focus);
  const lastOfFocus = focus ? [...sets].reverse().find((s) => s.exercise_name === focus) : undefined;

  const [hint, setHint] = useState<{ for: string; deload: boolean; next: SetTarget } | null>(null);
  useEffect(() => {
    if (!workout || !focus || lastOfFocus || (hint?.for === focus && hint.deload === deload)) return;
    let alive = true;
    v2.nextSet(focus, focusItem?.rep_min, focusItem?.rep_max, deload)
      .then((n) => alive && setHint({ for: focus, deload, next: { exercise: focus, weight: n.weight, reps: n.reps, why: n.why } }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [workout, focus, lastOfFocus, hint?.for, hint?.deload, deload, focusItem?.rep_min, focusItem?.rep_max]);

  const target: SetTarget | null = !workout || !focus
    ? null
    : lastOfFocus
      ? { exercise: focus, weight: lastOfFocus.weight, reps: lastOfFocus.reps }
      : hint?.for === focus
        ? hint.next
        : { exercise: focus, weight: null, reps: focusItem?.rep_min ?? null };

  return {
    workout,
    rest,
    sets,
    plan,
    focus,
    focusItem,
    target,
    /** Alias of `target`: the set QuickAdd should offer. */
    next: target,
    picked,
    setPicked,
    doneOf,
    /** True once the first load returned (the workout may still be null: no session). */
    ready: cur.data !== null,
    loading: cur.loading,
    error: cur.error,
    reload: cur.reload,
    setData: cur.setData,
  };
}

/** Log one set with feedback: emit, a done sound and an Undo toast. Null when it failed. */
export async function logSetWithUndo(
  workoutId: string,
  s: { exercise: string; weight?: number | null; reps?: number | null; type?: GymSet['type'] },
): Promise<GymSet | null> {
  const r = await act(
    v2.logSet({ workout_id: workoutId, exercise: s.exercise, weight: s.weight ?? undefined, reps: s.reps ?? undefined, type: s.type }),
  );
  emit('gym');
  if (!r) return null;
  const best = prToastLine(r.prs);
  feel(best ? 'allDone' : 'done');
  toastUndo(`${best ?? 'Set'} · ${setText(s.exercise, s.weight, s.reps)}`, () => {
    void act(v2.deleteSet(r.id)).then(() => emit('gym'));
  });
  return r;
}

/** "Bench press · 60 kg × 8" for a one-line preview (QuickAdd). */
export const targetText = (t: SetTarget | null) => (t ? `${t.exercise} · ${t.weight != null ? f.load(t.weight) : 'body'} × ${f.num(t.reps)}` : '');
