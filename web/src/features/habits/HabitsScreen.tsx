// Habits: tick today, weekly counts, add, edit, archive. A weekly count, not a chain.
import { ActionIcon, Button, Checkbox, Group, NumberInput, Progress, Stack, Text, TextInput } from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PLACE_ICON, STROKE } from '../../app/icons';
import { act, useLoad, usePageActive } from '../../hooks';
import { asApiError } from '../../api';
import * as f from '../../fmt';
import { feel } from '../../sound';
import { emit, toast, toastUndo, useRefresh } from '../../store';
import { lifeYmd } from '../../time';
import { Async, Empty, Page, Section } from '../../ui/Page';
import { Sheet } from '../../ui/Sheet';
import { v2, type Habit } from '../../v2';
import { commitWrite, parseNum } from '../gym/kit';
import { checkHabit, patchHabit } from './api';

export function HabitsScreen() {
  return (
    <Page title="Habits" icon={PLACE_ICON.habits} back="/life">
      <Routes>
        <Route index element={<Habits />} />
        <Route path="*" element={<Navigate to="/life/habits" replace />} />
      </Routes>
    </Page>
  );
}

const perWeekOk = (n: number) => Number.isInteger(n) && n >= 1 && n <= 7;

function Habits() {
  const active = usePageActive();
  const today = lifeYmd();
  const habits = useLoad(() => v2.habits(), active, [today], { key: `habits.${today}` });
  useRefresh('habits', () => void habits.reload());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<Habit | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const patchLocal = (id: string, p: (h: Habit) => Habit) => habits.setData((xs) => xs?.map((x) => (x.id === id ? p(x) : x)) ?? xs);
  const tick = (on: boolean) => (h: Habit) => ({ ...h, today: on ? 1 : 0, this_week: Math.max(0, h.this_week + (on ? 1 : -1)) });

  const toggle = async (h: Habit) => {
    if (pending.has(h.id)) return;
    const on = !(h.today > 0);
    patchLocal(h.id, tick(on));
    feel(on ? 'done' : 'tap');
    setPending((s) => new Set(s).add(h.id));
    try {
      await checkHabit(h.id, on ? 1 : 0, today);
      emit('habits');
    } catch (e) {
      const err = asApiError(e);
      toast(err.message);
      // Queued on this phone: keep the tick. Anything else: put it back.
      if (err.code !== 'queued') patchLocal(h.id, tick(!on));
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(h.id);
        return n;
      });
    }
  };

  const archive = async (h: Habit) => {
    setEditing(null);
    habits.setData((xs) => xs?.filter((x) => x.id !== h.id) ?? xs);
    feel('tap');
    const r = await act(patchHabit(h.id, { archived: true }));
    if (!r) {
      void habits.reload();
      return;
    }
    emit('habits');
    toastUndo(`Archived · ${h.name}`, () => {
      void act(patchHabit(h.id, { archived: false })).then(() => emit('habits'));
    });
  };

  return (
    <Async state={habits} label="Loading habits" lines={3}>
      {(all) => {
        const list = all.filter((h) => !h.archived);
        const doneToday = list.filter((h) => h.today > 0);
        const week = list.reduce((s, h) => s + Math.min(h.this_week, h.target_per_week), 0);
        const target = list.reduce((s, h) => s + h.target_per_week, 0);
        // Done first, then the rest in their usual order (a plain list, no score for today).
        const ordered = [...doneToday, ...list.filter((h) => h.today <= 0)];
        return (
          <>
            <Section
              title="This week"
              right={
                <Button size="xs" variant="light" leftSection={<IconPlus size={16} stroke={STROKE} />} onClick={() => nameRef.current?.focus()}>
                  Add habit
                </Button>
              }
            >
              {list.length > 0 ? (
                <Stack gap={4}>
                  <Text fz="var(--app-fz-stat)" fw={600} className="num">
                    {f.plural(week, 'tick')}
                  </Text>
                  <Text size="sm" c="dimmed" className="num">
                    {f.num(target)} planned this week
                  </Text>
                  {doneToday.length > 0 && (
                    <Text size="sm" c="dimmed">
                      Done today: {doneToday.map((h) => h.name).join(', ')}
                    </Text>
                  )}
                  <Progress value={target ? (week / target) * 100 : 0} size="sm" aria-label="This week" />
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  No habits yet.
                </Text>
              )}
            </Section>

            <Section title="Today" hint="Tap to tick. Tap again to untick.">
              {list.length === 0 ? (
                <Empty title="No habits yet." icon={PLACE_ICON.habits}>
                  Add one you already half-do. Ticks count per week, nothing carries over.
                </Empty>
              ) : (
                <Stack gap="md">
                  {ordered.map((h) => (
                    <Stack key={h.id} gap={6}>
                      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                        <Checkbox
                          size="md"
                          style={{ flex: 1, minWidth: 0 }}
                          checked={h.today > 0}
                          onChange={() => void toggle(h)}
                          label={h.name}
                          description={<span className="num">{`${f.num(h.this_week)} of ${f.num(h.target_per_week)} this week`}</span>}
                        />
                        <ActionIcon variant="subtle" color="gray" aria-label={`Edit ${h.name}`} onClick={() => setEditing(h)}>
                          <IconPencil size={16} stroke={STROKE} />
                        </ActionIcon>
                      </Group>
                      <Progress
                        value={Math.min(100, (h.this_week / Math.max(1, h.target_per_week)) * 100)}
                        size="xs"
                        aria-label={`${h.name} this week`}
                      />
                    </Stack>
                  ))}
                </Stack>
              )}
            </Section>

            <AddHabit nameRef={nameRef} />

            <Text size="xs" c="dimmed">
              Counts reset each week. A missed day changes nothing.
            </Text>

            <Sheet opened={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.name}` : undefined}>
              {editing && (
                <EditHabit
                  key={editing.id}
                  habit={editing}
                  onSaved={(r) => {
                    patchLocal(r.id, (x) => ({ ...x, name: r.name, target_per_week: r.target_per_week }));
                    setEditing(null);
                  }}
                  onArchive={() => void archive(editing)}
                />
              )}
            </Sheet>
          </>
        );
      }}
    </Async>
  );
}

function AddHabit({ nameRef }: { nameRef: RefObject<HTMLInputElement | null> }) {
  const [name, setName] = useState('');
  const [perWeek, setPerWeek] = useState<string | number>(3);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      toast('Name the habit');
      nameRef.current?.focus();
      return;
    }
    const n = Math.round(parseNum(perWeek));
    if (!perWeekOk(n)) return toast('Times per week: 1 to 7');
    setBusy(true);
    const { done } = await commitWrite(v2.addHabit(name.trim(), n));
    setBusy(false);
    emit('habits');
    if (!done) return;
    feel('capture');
    setName('');
    nameRef.current?.focus();
  };

  return (
    <Section title="Add a habit">
      <form onSubmit={add} aria-label="Add a habit">
        <Stack gap="sm">
          <TextInput
            ref={nameRef}
            label="Habit"
            placeholder="Read 10 pages"
            autoComplete="off"
            enterKeyHint="done"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <NumberInput label="Times per week" value={perWeek} onChange={setPerWeek} min={1} max={7} step={1} allowDecimal={false} clampBehavior="strict" className="num" />
          <Button type="submit" loading={busy}>
            Add habit
          </Button>
        </Stack>
      </form>
    </Section>
  );
}

function EditHabit({ habit, onSaved, onArchive }: { habit: Habit; onSaved: (h: Habit) => void; onArchive: () => void }) {
  const [name, setName] = useState(habit.name);
  const [perWeek, setPerWeek] = useState<string | number>(habit.target_per_week);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return toast('Name the habit');
    const n = Math.round(parseNum(perWeek));
    if (!perWeekOk(n)) return toast('Times per week: 1 to 7');
    setBusy(true);
    const r = await act(patchHabit(habit.id, { name: name.trim(), target_per_week: n }));
    setBusy(false);
    if (!r) return;
    emit('habits');
    feel('capture');
    toast(`Saved · ${r.name}`);
    onSaved(r);
  };

  return (
    <form onSubmit={save} aria-label={`Edit ${habit.name}`}>
      <Stack gap="sm">
        <TextInput label="Habit" value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" />
        <NumberInput label="Times per week" value={perWeek} onChange={setPerWeek} min={1} max={7} step={1} allowDecimal={false} clampBehavior="strict" className="num" />
        <Button type="submit" loading={busy}>
          Save
        </Button>
        <Button variant="subtle" color="gray" onClick={onArchive} disabled={busy}>
          Archive
        </Button>
        <Text size="xs" c="dimmed">
          Archiving hides the habit and keeps its history.
        </Text>
      </Stack>
    </form>
  );
}
