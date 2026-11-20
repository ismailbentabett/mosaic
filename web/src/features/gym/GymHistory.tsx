// Gym › History: past workouts by day; tap one to see its sets.
import { NavLink, Stack, Text } from '@mantine/core';
import { useMemo, useState } from 'react';
import { PLACE_ICON } from '../../app/icons';
import { copy } from '../../copy';
import * as f from '../../fmt';
import { useLoad, usePageActive } from '../../hooks';
import { useRefresh } from '../../store';
import { Async, Empty, Section } from '../../ui/Page';
import { Sheet } from '../../ui/Sheet';
import { v2, type WorkoutRow } from '../../v2';

const duration = (h: WorkoutRow) =>
  h.ended_at ? f.minutes((Date.parse(h.ended_at) - Date.parse(h.started_at)) / 60000) : 'in progress';

export function GymHistory() {
  const active = usePageActive();
  const history = useLoad(() => v2.workouts(30), active, [], { key: 'gym.history' });
  useRefresh('gym', () => void history.reload());
  const [open, setOpen] = useState<WorkoutRow | null>(null);

  return (
    <>
      <Async state={history} label="Loading workouts" lines={4}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title={copy.empty.gym} icon={PLACE_ICON.gym}>
              Start a workout to log the first set.
            </Empty>
          ) : (
            <Stack gap="md">
              {groupByDay(rows).map(([day, list]) => (
                <Section key={day} title={f.dayFull(day)} hint={['Today', 'Yesterday'].includes(f.day(day)) ? f.day(day) : undefined}>
                  <Stack gap={2}>
                    {list.map((h) => (
                      <NavLink
                        key={h.id}
                        component="button"
                        label={h.name}
                        description={`${f.time(h.started_at)} · ${duration(h)}`}
                        rightSection={
                          <Text size="sm" className="num">
                            {f.plural(h.working_sets, 'set')}
                          </Text>
                        }
                        onClick={() => setOpen(h)}
                      />
                    ))}
                  </Stack>
                </Section>
              ))}
            </Stack>
          )
        }
      </Async>
      <Sheet opened={!!open} onClose={() => setOpen(null)} title={open?.name}>
        {open && <WorkoutDetail row={open} />}
      </Sheet>
    </>
  );
}

function groupByDay(rows: WorkoutRow[]): [string, WorkoutRow[]][] {
  const m = new Map<string, WorkoutRow[]>();
  for (const r of rows) m.set(r.day, [...(m.get(r.day) ?? []), r]);
  return [...m.entries()];
}

function WorkoutDetail({ row }: { row: WorkoutRow }) {
  const w = useLoad(() => v2.workout(row.id), true, [row.id]);
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof w.data>['sets']>();
    for (const s of w.data?.sets ?? []) m.set(s.exercise_name, [...(m.get(s.exercise_name) ?? []), s]);
    return [...m.entries()];
  }, [w.data]);
  return (
    <Async state={w} label="Loading workout" lines={3}>
      {(d) => (
        <Stack gap="sm">
          <Text size="sm" c="dimmed" className="num">
            {f.dayFull(d.day)} · {f.time(d.started_at)} · {duration(d)} · {f.num(d.volume_kg)} kg volume
          </Text>
          {groups.length === 0 && <Text size="sm">{copy.empty.gym}</Text>}
          {groups.map(([name, sets]) => (
            <div key={name}>
              <Text size="sm" fw={600}>
                {name}
              </Text>
              <Text size="sm" c="dimmed" className="num">
                {sets
                  .map((s) => `${s.weight != null ? f.load(s.weight) : 'body'} × ${s.reps != null ? f.num(s.reps) : f.DASH}${s.type !== 'working' ? ` ${s.type}` : ''}`)
                  .join(' · ')}
              </Text>
            </div>
          ))}
          {d.notes && <Text size="sm">{d.notes}</Text>}
        </Stack>
      )}
    </Async>
  );
}
