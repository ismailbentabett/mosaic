// Gym › Routines: list, start, create and edit routines (exercise, sets, rep range, rest).
import { ActionIcon, Autocomplete, Button, Group, NavLink, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { STROKE } from '../../app/icons';
import { enc, request } from '../../api';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { replace } from '../../router';
import { feel } from '../../sound';
import { emit, toast, useRefresh } from '../../store';
import { Async, Empty, Section } from '../../ui/Page';
import { Sheet } from '../../ui/Sheet';
import { newId, v2, type Routine } from '../../v2';
import { useActiveWorkout } from './active';
import { parseNum, repRange } from './kit';

type Item = { key: string; exercise: string; sets: string | number; rep_min: string | number; rep_max: string | number; rest_s: string | number };
type Draft = { id: string | null; name: string; items: Item[] };

const blankItem = (): Item => ({ key: newId(), exercise: '', sets: 3, rep_min: 8, rep_max: 12, rest_s: 120 });
const toDraft = (r: Routine): Draft => ({
  id: r.id,
  name: r.name,
  items: r.items.map((i) => ({
    key: newId(),
    exercise: i.exercise_name,
    sets: i.sets,
    rep_min: i.rep_min ?? '',
    rep_max: i.rep_max ?? '',
    rest_s: i.rest_s ?? '',
  })),
});
const optNum = (v: string | number) => {
  if (!String(v).trim()) return undefined;
  const n = Math.round(parseNum(v));
  return Number.isFinite(n) ? n : NaN;
};

export function GymRoutines() {
  const active = usePageActive();
  const routines = useLoad(() => v2.routines(), active, [], { key: 'gym.routines' });
  useRefresh('gym', () => void routines.reload());
  const aw = useActiveWorkout({ active });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (r: Routine) => {
    if (busy) return;
    setBusy(true);
    const w = await act(v2.startWorkout(r.id));
    setBusy(false);
    emit('gym');
    if (!w) return;
    feel('timerStart');
    replace('/life/gym');
  };

  return (
    <>
      <Section
        title="Routines"
        right={
          <Button size="xs" variant="light" leftSection={<IconPlus size={16} stroke={STROKE} />} onClick={() => setDraft({ id: null, name: '', items: [blankItem()] })}>
            New
          </Button>
        }
      >
        <Async state={routines} label="Loading routines" lines={3}>
          {(list) =>
            list.length === 0 ? (
              <Empty title="No routines yet.">A routine lists exercises with sets and reps. Workouts started from it prefill the next set.</Empty>
            ) : (
              <Stack gap={2}>
                {list.map((r) => (
                  <Group key={r.id} gap={4} wrap="nowrap">
                    <NavLink
                      component="button"
                      style={{ flex: 1, minWidth: 0 }}
                      label={r.name}
                      description={
                        r.items.length
                          ? r.items.map((i) => `${i.exercise_name} ${f.num(i.sets)}×${repRange(i.rep_min, i.rep_max)}`).join(' · ')
                          : 'No exercises'
                      }
                      onClick={() => setDraft(toDraft(r))}
                      aria-label={`Edit ${r.name}`}
                    />
                    {!aw.workout && (
                      <ActionIcon color="brand" size="lg" variant="light" aria-label={`Start ${r.name}`} disabled={busy} onClick={() => void start(r)}>
                        <IconPlayerPlay size={18} stroke={STROKE} />
                      </ActionIcon>
                    )}
                  </Group>
                ))}
              </Stack>
            )
          }
        </Async>
      </Section>
      <RoutineSheet draft={draft} onClose={() => setDraft(null)} />
    </>
  );
}

function RoutineSheet({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  return (
    <Sheet opened={!!draft} onClose={onClose} title={draft?.id ? `Edit ${draft.name}` : 'New routine'} tall>
      {draft && <RoutineForm key={draft.id ?? 'new'} initial={draft} onDone={onClose} />}
    </Sheet>
  );
}

function RoutineForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const ex = useLoad(() => v2.exercises(), true, [], { key: 'gym.exercises' });
  const names = useMemo(() => [...new Set((ex.data ?? []).map((e) => e.name))], [ex.data]);
  const setItem = (key: string, p: Partial<Item>) => setD((x) => ({ ...x, items: x.items.map((i) => (i.key === key ? { ...i, ...p } : i)) }));

  const save = async () => {
    if (busy) return;
    const name = d.name.trim();
    if (!name) return toast('Name the routine');
    const items = [];
    for (const i of d.items) {
      const exercise = i.exercise.trim();
      if (!exercise) continue;
      const it = { exercise, sets: optNum(i.sets), rep_min: optNum(i.rep_min), rep_max: optNum(i.rep_max), rest_s: optNum(i.rest_s) };
      if ([it.sets, it.rep_min, it.rep_max, it.rest_s].some((n) => n !== undefined && !Number.isFinite(n))) return toast(`Numbers only for ${exercise}`);
      items.push(it);
    }
    setBusy(true);
    const r = await act(
      d.id
        ? request<Routine>('PUT', `/api/v2/gym/routines/${enc(d.id)}/items`, { items })
        : request<Routine>('POST', '/api/v2/gym/routines', { id: newId(), name, items }),
    );
    setBusy(false);
    emit('gym');
    if (!r) return;
    feel('capture');
    toast(d.id ? `Saved · ${name}` : `Added · ${name}`);
    onDone();
  };

  return (
    <Stack gap="md">
      <TextInput
        label="Name"
        placeholder="Push A"
        value={d.name}
        disabled={!!d.id}
        description={d.id ? 'A routine keeps its name.' : undefined}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setD((x) => ({ ...x, name: v }));
        }}
      />
      {d.items.map((i, n) => (
        <Stack key={i.key} gap={6}>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <Autocomplete
              style={{ flex: 1 }}
              label={`Exercise ${n + 1}`}
              placeholder="Bench press"
              data={names}
              value={i.exercise}
              onChange={(v) => setItem(i.key, { exercise: v })}
              limit={8}
            />
            <ActionIcon
              size="lg"
              variant="subtle"
              color="gray"
              aria-label={`Remove ${i.exercise || `exercise ${n + 1}`}`}
              onClick={() => setD((x) => ({ ...x, items: x.items.filter((y) => y.key !== i.key) }))}
            >
              <IconTrash size={18} stroke={STROKE} />
            </ActionIcon>
          </Group>
          <Group grow gap="xs">
            <NumberInput label="Sets" value={i.sets} onChange={(v) => setItem(i.key, { sets: v })} min={1} max={20} allowDecimal={false} className="num" />
            <NumberInput label="Reps min" value={i.rep_min} onChange={(v) => setItem(i.key, { rep_min: v })} min={1} allowDecimal={false} className="num" />
            <NumberInput label="Reps max" value={i.rep_max} onChange={(v) => setItem(i.key, { rep_max: v })} min={1} allowDecimal={false} className="num" />
            <NumberInput label="Rest (s)" value={i.rest_s} onChange={(v) => setItem(i.key, { rest_s: v })} min={0} max={900} step={15} allowDecimal={false} className="num" />
          </Group>
        </Stack>
      ))}
      <Button variant="default" leftSection={<IconPlus size={16} stroke={STROKE} />} onClick={() => setD((x) => ({ ...x, items: [...x.items, blankItem()] }))}>
        Add exercise
      </Button>
      <Text size="xs" c="dimmed">
        Empty rows are skipped. Defaults: 3 sets, 8–12 reps, 120 s rest.
      </Text>
      <Button onClick={() => void save()} loading={busy}>
        Save routine
      </Button>
    </Stack>
  );
}
