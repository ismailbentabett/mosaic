// Gym › Today: start a session, then log sets with a prefilled form, rest clock and carry-forward note.
import { BarChart } from '@mantine/charts';
import '@mantine/charts/styles.css';
import { Button, Stack, Text } from '@mantine/core';
import { ChartText } from '../../ui/ChartText';
import { useMemo, useRef, useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { feel } from '../../sound';
import { emit, toast, useRefresh } from '../../store';
import { localMinutes, lifeYmd, toMinutes } from '../../time';
import { ErrorState, Loading, Section } from '../../ui/Page';
import { v2 } from '../../v2';
import { useActiveWorkout } from './active';
import { ActiveWorkout } from './ActiveWorkout';
import { prFinishLine, repRange, useDeferredDelete } from './kit';
import { StartSection } from './StartSection';
import { WeekVolume } from './WeekVolume';

export { CHIME_KEY } from './todayStorage';

/** The fixed gym window (never moved). */
const GYM_FROM = '18:00';
const GYM_TO = '20:45';

/** Exercise names for the autocomplete (unique, as Mantine needs). */
function useExerciseNames(active: boolean) {
  const ex = useLoad(() => v2.exercises(), active, [], { key: 'gym.exercises' });
  return useMemo(() => [...new Set((ex.data ?? []).map((e) => e.name))], [ex.data]);
}

export function GymToday() {
  const active = usePageActive();
  const today = lifeYmd();
  const del = useDeferredDelete();
  const aw = useActiveWorkout({ active, hidden: del.hidden });
  const w = aw.workout;
  const history = useLoad(() => v2.workouts(8), active, [], { key: 'gym.recent' });
  const door = useLoad(() => v2.todayRoutine(), active && !w, [!w], { key: 'gym.door' });
  const routines = useLoad(() => v2.routines(), active && !w, [!w], { key: 'gym.routines' });
  useRefresh('gym', () => {
    void history.reload();
    if (!w) {
      void door.reload();
      void routines.reload();
    }
  });
  const names = useExerciseNames(active);
  const exRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const start = async (routine?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await act(v2.startWorkout(routine));
      emit('gym');
      if (!r) return;
      feel('timerStart');
      window.setTimeout(() => exRef.current?.focus(), 150);
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    if (!w || busy) return;
    setBusy(true);
    try {
      const r = await act(v2.finishWorkout(w.id));
      emit('gym');
      if (!r) return;
      feel('allDone');
      const bests = prFinishLine(r.prs);
      toast(`Finished · ${f.plural(r.sets.filter((s) => s.type === 'working').length, 'working set')} · ${f.minutes(r.minutes)}${bests ? ` · ${bests}` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  if (!aw.ready) {
    if (aw.error) return <ErrorState error={aw.error} onRetry={() => void aw.reload()} />;
    return <Loading label="Loading gym" lines={3} />;
  }

  const doneToday = (history.data ?? []).find((h) => h.day === today && h.ended_at);
  const hist = [...(history.data ?? [])].reverse();
  // Before the session: a cue for the fixed slot, not a "Rest" verdict.
  const suggested = door.data?.routine ?? null;
  const first = suggested?.items[0];
  const beforeGym = localMinutes() < toMinutes(GYM_TO);
  const idleTitle = beforeGym ? `Gym at ${GYM_FROM}` : `Gym ${GYM_FROM}–${GYM_TO}`;
  const idleSub = [
    suggested ? suggested.name : null,
    first ? `first set: ${first.exercise_name} ${f.num(first.sets)}×${repRange(first.rep_min, first.rep_max)}` : null,
  ]
    .filter(Boolean)
    .join(' · ') || (beforeGym ? 'Start a workout when you get there.' : 'No session logged today.');

  return (
    <Stack gap="md">
      <Section
        title="Today"
        right={
          <Button
            size="xs"
            variant="light"
            disabled={busy}
            onClick={() => {
              if (w) exRef.current?.focus();
              else if ((routines.data?.length ?? 0) === 0) void start();
              else document.getElementById('gym-start')?.querySelector('button')?.focus();
            }}
          >
            {w ? 'Log set' : 'Start workout'}
          </Button>
        }
      >
        <Text fw={600} size="xl" lineClamp={1}>
          {w ? w.name : doneToday ? doneToday.name : idleTitle}
        </Text>
        <Text size="sm" c="dimmed" className="num">
          {w
            ? `${f.plural(aw.sets.length, 'set')} · since ${f.time(w.started_at)}`
            : doneToday
              ? `${f.plural(doneToday.working_sets, 'working set')} · finished ${f.time(doneToday.ended_at)}`
              : idleSub}
        </Text>
        <WeekVolume active={active} />
        {hist.length > 1 && (
          <>
            <BarChart
              mt="sm"
              h={90}
              data={hist.map((h) => ({ day: f.day(h.day), sets: h.working_sets }))}
              dataKey="day"
              series={[{ name: 'sets', label: 'Working sets', color: 'brand.6' }]}
              withYAxis={false}
              gridAxis="none"
              tickLine="none"
              valueFormatter={(v) => f.num(v)}
              aria-label={`Working sets, last ${f.plural(hist.length, 'workout')}`}
              role="img"
            />
            <ChartText label="Working sets per workout" rows={hist.map((h) => `${f.day(h.day)}: ${h.working_sets}`)} />
            <Text size="xs" c="dimmed">
              Working sets, last {f.plural(hist.length, 'workout')}
            </Text>
          </>
        )}
      </Section>

      {w ? (
        <ActiveWorkout w={w} aw={aw} del={del} names={names} exRef={exRef} busy={busy} onFinish={() => void finish()} active={active} />
      ) : (
        <StartSection routines={routines} door={door.data?.routine ?? null} busy={busy} onStart={(id) => void start(id)} />
      )}
    </Stack>
  );
}
