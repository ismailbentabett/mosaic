// Gym › Exercises: search the catalogue; one exercise shows its chart, PRs, last session and next set.
import { LineChart } from '@mantine/charts';
import '@mantine/charts/styles.css';
import { Button, Group, NavLink, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconChevronLeft, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { STROKE } from '../../app/icons';
import { enc, request } from '../../api';
import * as f from '../../fmt';
import { life } from '../../life';
import { useLoad, usePageActive } from '../../hooks';
import { replace } from '../../router';
import { feel } from '../../sound';
import { useRefresh } from '../../store';
import { Async, Empty, Notice, Section } from '../../ui/Page';
import { v2, type GymSet, type NextSet } from '../../v2';
import { prLabel, prValue } from './kit';

type HistoryDay = { day: string; top_weight: number | null; best_e1rm: number | null; volume: number; sets: number };
type Pr = { exercise_id: string; kind: string; value: number; set_id: string; at: string; exercise_name: string };
type LastSet = { type: GymSet['type']; weight: number | null; reps: number | null; seconds: number | null; distance: number | null; rpe: number | null };
type ExerciseHistory = {
  history: HistoryDay[];
  prs: Pr[];
  last: { exercise: string; day: string; sets: LastSet[] } | null;
  next: NextSet | null;
};

// PR labels come from kit.prLabel (server kinds: heaviest, e1rm, volume; reps@<kg> is never listed).

export function GymExercises() {
  const active = usePageActive();
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q.trim(), 250);
  const list = useLoad(() => v2.exercises(dq || undefined), active, [dq], { key: dq ? undefined : 'gym.exercises' });

  return (
    <Section title="Exercises" hint="Tap one for its history">
      <Stack gap="sm">
        <TextInput
          placeholder="Search exercises"
          aria-label="Search exercises"
          leftSection={<IconSearch size={16} stroke={STROKE} />}
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Async state={list} label="Loading exercises" lines={4}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty title={dq ? `Nothing matches "${dq}".` : 'No exercises yet.'}>Logging a set adds its exercise here.</Empty>
            ) : (
              <Stack gap={2}>
                {rows.map((e) => (
                  <NavLink
                    key={e.id}
                    component="button"
                    label={e.name}
                    description={[e.equipment, e.primary_muscles.join(', ')].filter(Boolean).join(' · ') || e.kind}
                    onClick={() => {
                      feel('tap');
                      replace(`/life/gym/exercises/${enc(e.id)}`);
                    }}
                  />
                ))}
              </Stack>
            )
          }
        </Async>
      </Stack>
    </Section>
  );
}

export function GymExercise() {
  const { ref = '' } = useParams();
  const active = usePageActive();
  const h = useLoad(() => request<ExerciseHistory>('GET', `/api/v2/gym/exercises/${enc(ref)}/history`), active && !!ref, [ref]);
  useRefresh('gym', () => void h.reload());
  const name = h.data?.last?.exercise ?? h.data?.next?.exercise ?? h.data?.prs[0]?.exercise_name ?? null;
  const note = useLoad(() => life.carryForward(name ?? ''), active && !!name, [name]);

  return (
    <Stack gap="md">
      <Group>
        <Button variant="subtle" size="compact-sm" leftSection={<IconChevronLeft size={16} stroke={STROKE} />} onClick={() => replace('/life/gym/exercises')}>
          All exercises
        </Button>
      </Group>
      <Async state={h} label="Loading history" lines={5}>
        {(d) => {
          const prs = d.prs.filter((p) => !p.kind.startsWith('reps@'));
          const chart = [...d.history].reverse().map((x) => ({ day: f.day(x.day), top: x.top_weight, e1rm: x.best_e1rm }));
          return (
            <>
              <Section title={name ?? 'Exercise'} hint={d.history.length ? f.plural(d.history.length, 'session') : undefined}>
                {chart.length < 2 ? (
                  <Text size="sm" c="dimmed">
                    {chart.length ? 'One session so far. The chart starts at two.' : 'No sets logged for this exercise.'}
                  </Text>
                ) : (
                  <LineChart
                    h={180}
                    data={chart}
                    dataKey="day"
                    series={[
                      { name: 'top', label: 'Top set', color: 'brand.6' },
                      { name: 'e1rm', label: 'Estimated 1RM', color: 'blue.6' },
                    ]}
                    curveType="monotone"
                    connectNulls
                    withLegend
                    tickLine="none"
                    gridAxis="y"
                    unit=" kg"
                    valueFormatter={(v) => f.num(v)}
                    aria-label={`Top set and estimated 1RM, ${f.plural(chart.length, 'session')}`}
                    role="img"
                  />
                )}
              </Section>

              {d.next && (
                <Section title="Next set">
                  <Text size="lg" fw={600} className="num">
                    {d.next.weight != null ? f.load(d.next.weight) : 'body'} × {f.num(d.next.reps)}
                  </Text>
                  {d.next.why && (
                    <Text size="sm" c="dimmed">
                      {d.next.why}
                    </Text>
                  )}
                </Section>
              )}

              {note.data?.note && <Notice>Last time you wrote: {note.data.note}</Notice>}

              {d.last && (
                <Section title="Last session" hint={f.dayFull(d.last.day)}>
                  <Text size="sm" className="num">
                    {d.last.sets
                      .map(
                        (s) =>
                          `${s.weight != null ? f.load(s.weight) : 'body'} × ${s.reps != null ? f.num(s.reps) : s.seconds != null ? f.secs(s.seconds) : f.DASH}${s.type !== 'working' ? ` ${s.type}` : ''}${s.rpe != null ? ` @${f.num(s.rpe)}` : ''}`,
                      )
                      .join(' · ')}
                  </Text>
                </Section>
              )}

              {prs.length > 0 && (
                <Section title="Personal records">
                  <Stack gap={4}>
                    {prs.map((p) => (
                      <Group key={`${p.kind}-${p.set_id}`} justify="space-between" wrap="nowrap">
                        <Text size="sm">{prLabel(p.kind)}</Text>
                        <Text size="sm" className="num">
                          {prValue(p.kind, p.value)} · {f.day(p.at.slice(0, 10))}
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                </Section>
              )}

              {d.history.length > 0 && (
                <Section title="Sessions">
                  <Stack gap={4}>
                    {d.history.map((x) => (
                      <Group key={x.day} justify="space-between" wrap="nowrap">
                        <Text size="sm">{f.day(x.day)}</Text>
                        <Text size="sm" c="dimmed" className="num">
                          {x.top_weight != null ? f.load(x.top_weight) : 'body'} · {f.plural(x.sets, 'set')} · {f.num(x.volume)} kg
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                </Section>
              )}
            </>
          );
        }}
      </Async>
    </Stack>
  );
}
