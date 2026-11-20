import { Button, Group, NavLink, Pill, Stack, Switch, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { useEffect, useMemo } from 'react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { act, useLoad } from '../../hooks';
import { life } from '../../life';
import { emit } from '../../store';
import { Section } from '../../ui/Page';
import { v2, type Workout } from '../../v2';
import { logSetWithUndo, useActiveWorkout } from './active';
import { CarryForward } from './CarryForward';
import { repRange, setText, useDeferredDelete, useLocalFlag } from './kit';
import { NextNote } from './NextNote';
import { RestClock } from './RestClock';
import { SetForm } from './SetForm';
import { CHIME_KEY, readRest, saveRest } from './todayStorage';

type AW = ReturnType<typeof useActiveWorkout>;
type Del = ReturnType<typeof useDeferredDelete>;

export function ActiveWorkout({
  w,
  aw,
  del,
  names,
  exRef,
  busy,
  onFinish,
  active,
}: {
  w: Workout;
  aw: AW;
  del: Del;
  names: string[];
  exRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  onFinish: () => void;
  active: boolean;
}) {
  const { sets, plan, focus, target } = aw;
  // The server keeps the rest end time; this device keeps a copy so the clock is back after leaving
  // the page even when the server can't be reached.
  const rest = aw.rest ?? (aw.error ? readRest(w.id) : null);
  useEffect(() => {
    if (!aw.error) saveRest(w.id, aw.rest);
  }, [w.id, aw.rest, aw.error]);
  const [chime, setChime] = useLocalFlag(CHIME_KEY, true);
  const forecast = useLoad(() => life.forecast(w.id), active, [w.id, sets.length]);

  const byExercise = useMemo(() => {
    const m = new Map<string, typeof sets>();
    for (const s of sets) m.set(s.exercise_name, [...(m.get(s.exercise_name) ?? []), s]);
    return [...m.entries()];
  }, [sets]);

  // One-tap repeats of this session's sets (last 6 distinct exercise · weight · reps).
  const chips = useMemo(() => {
    const out: { key: string; text: string; run: () => void }[] = [];
    const seen = new Set<string>();
    for (const s of [...sets].reverse()) {
      const k = `${s.exercise_name}|${s.weight ?? ''}|${s.reps ?? ''}`;
      if (seen.has(k) || out.length >= 6) continue;
      seen.add(k);
      out.push({
        key: k,
        text: setText(s.exercise_name, s.weight, s.reps),
        run: () => void logSetWithUndo(w.id, { exercise: s.exercise_name, weight: s.weight, reps: s.reps, type: s.type }),
      });
    }
    return out;
  }, [sets, w.id]);

  return (
    <Section title={w.name} id="gym-now" right={<Text size="sm" c="dimmed" className="num">since {f.time(w.started_at)}</Text>}>
      <Stack gap="md">
        {rest && (
          <RestClock
            key={rest.ends_at}
            endsAt={rest.ends_at}
            label={rest.label}
            chime={chime}
            onClear={() => {
              aw.setData((x) => (x ? { ...x, rest: null } : x));
              void act(v2.clearRest()).then(() => emit('gym'));
            }}
          />
        )}

        {plan && plan.items.length > 0 && (
          <Stack gap={2} aria-label={`${plan.name} plan`}>
            {plan.items.map((i) => {
              const done = aw.doneOf(i.exercise_name);
              const reps = repRange(i.rep_min, i.rep_max);
              const finished = done >= i.sets;
              return (
                <NavLink
                  key={i.exercise_id}
                  component="button"
                  active={i.exercise_name === focus}
                  aria-current={i.exercise_name === focus ? 'step' : undefined}
                  label={i.exercise_name}
                  c={finished ? 'dimmed' : undefined}
                  leftSection={finished ? <IconCheck size={16} stroke={STROKE} /> : undefined}
                  rightSection={
                    <Text size="xs" c="dimmed" className="num">
                      {f.num(Math.min(done, i.sets))}/{f.num(i.sets)} sets{reps && ` · ${reps} reps`}
                    </Text>
                  }
                  onClick={() => aw.setPicked(i.exercise_name)}
                />
              );
            })}
          </Stack>
        )}

        {focus && <CarryForward exercise={focus} active={active} />}

        {chips.length > 0 && (
          <div>
            <Text size="xs" c="dimmed" mb={4}>
              Log again
            </Text>
            <Group gap={6}>
              {chips.map((c) => (
                <Button key={c.key} size="compact-sm" variant="default" className="num" aria-label={`Log again: ${c.text}`} onClick={() => {
                  c.run();
                }}>
                  {c.text}
                </Button>
              ))}
            </Group>
          </div>
        )}

        <SetForm w={w} target={target} names={names} exRef={exRef} onLogged={() => aw.setPicked(null)} />

        {byExercise.length > 0 && (
          <Stack gap="xs">
            {byExercise.map(([name, list]) => (
              <div key={name}>
                <Text size="sm" fw={600} mb={4}>
                  {name}
                </Text>
                <Pill.Group>
                  {list.map((s) => (
                    <Pill
                      key={s.id}
                      size="md"
                      className="num"
                      withRemoveButton
                      removeButtonProps={{ 'aria-label': `Delete set ${f.num(s.idx)} of ${name}` }}
                      onRemove={() => del.remove(s.id, `${name} set ${f.num(s.idx)}`, () => v2.deleteSet(s.id), 'gym')}
                    >
                      {s.weight != null ? f.load(s.weight) : 'Body'} × {s.reps != null ? f.num(s.reps) : f.DASH}
                      {s.type !== 'working' ? ` ${s.type}` : ''}
                    </Pill>
                  ))}
                </Pill.Group>
              </div>
            ))}
          </Stack>
        )}

        {focus && <NextNote exercise={focus} />}

        <Text size="sm" c="dimmed" className="num">
          {f.plural(sets.length, 'set')} · {f.num(w.volume_kg)} kg volume
          {forecast.data?.line ? ` · ${forecast.data.line}` : ''}
        </Text>
        <Group justify="space-between">
          <Switch
            size="sm"
            label="Chime when rest ends"
            description="A push also comes when rest ends, for a locked phone."
            checked={chime}
            onChange={(e) => setChime(e.currentTarget.checked)}
          />
          <Button variant="default" disabled={busy} onClick={onFinish}>
            {busy ? 'Saving…' : 'Finish workout'}
          </Button>
        </Group>
      </Stack>
    </Section>
  );
}
