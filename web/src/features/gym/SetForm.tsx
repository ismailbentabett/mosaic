import { Autocomplete, Button, Group, NumberInput, Stack, Text } from '@mantine/core';
import { useEffect, useState, type FormEvent } from 'react';
import { act } from '../../hooks';
import { feel } from '../../sound';
import { emit, toast, toastUndo } from '../../store';
import { v2, type Workout } from '../../v2';
import { type SetTarget } from './active';
import { commitWrite, parseNum, prToastLine, setText } from './kit';

/**
 * Controlled set form. Prefill follows the target (repeat the last set of the focused exercise,
 * else the suggestion) whenever the target or the set count changes.
 */
export function SetForm({
  w,
  target,
  names,
  exRef,
  onLogged,
}: {
  w: Workout;
  target: SetTarget | null;
  names: string[];
  exRef: React.RefObject<HTMLInputElement | null>;
  onLogged: () => void;
}) {
  const [exercise, setExercise] = useState(target?.exercise ?? '');
  const [weight, setWeight] = useState<string | number>(target?.weight ?? '');
  const [reps, setReps] = useState<string | number>(target?.reps ?? '');
  const [busy, setBusy] = useState(false);
  const sig = `${w.id}:${w.sets.length}:${target?.exercise ?? ''}:${target?.weight ?? ''}:${target?.reps ?? ''}`;
  useEffect(() => {
    setExercise(target?.exercise ?? '');
    setWeight(target?.weight ?? '');
    setReps(target?.reps ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ex = exercise.trim();
    if (!ex) {
      toast('Name the exercise');
      exRef.current?.focus();
      return;
    }
    const wt = String(weight).trim() ? parseNum(weight) : undefined;
    const rp = String(reps).trim() ? Math.round(parseNum(reps)) : undefined;
    if ((wt !== undefined && !Number.isFinite(wt)) || (rp !== undefined && !Number.isFinite(rp))) {
      toast('Weight and reps must be numbers');
      return;
    }
    // Only pull focus back when the keyboard was already up; a button tap keeps it down.
    const typing = document.activeElement instanceof HTMLInputElement;
    setBusy(true);
    const { r, done } = await commitWrite(v2.logSet({ workout_id: w.id, exercise: ex, weight: wt, reps: rp }));
    setBusy(false);
    emit('gym');
    if (!done) return;
    const best = prToastLine(r?.prs);
    feel(best ? 'allDone' : 'done');
    if (r) {
      toastUndo(best ? `${best} · ${setText(ex, wt, rp)}` : `Set · ${setText(ex, wt, rp)}`, () => {
        void act(v2.deleteSet(r.id)).then(() => emit('gym'));
      });
    }
    onLogged();
    if (typing) exRef.current?.focus();
  };

  return (
    <form onSubmit={submit} aria-label="Log a set">
      <Stack gap="sm">
        <Autocomplete
          ref={exRef}
          label="Exercise"
          placeholder="Bench press"
          data={names}
          value={exercise}
          onChange={setExercise}
          autoComplete="off"
          enterKeyHint="next"
          limit={8}
        />
        <Group grow gap="sm" align="flex-start">
          <NumberInput label="Weight (kg)" placeholder="60" value={weight} onChange={setWeight} step={2.5} min={0} decimalScale={2} inputMode="decimal" className="num" />
          <NumberInput label="Reps" placeholder="8" value={reps} onChange={setReps} step={1} min={0} allowDecimal={false} inputMode="numeric" className="num" />
        </Group>
        <Button type="submit" fullWidth loading={busy}>
          Log set
        </Button>
        {target?.why && target.exercise === exercise && (
          <Text size="sm" c="dimmed">
            {target.why}
          </Text>
        )}
      </Stack>
    </form>
  );
}
