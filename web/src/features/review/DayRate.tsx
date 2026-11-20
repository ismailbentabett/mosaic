// Rate the day, close the day, and what tomorrow starts with.
// Stable export: DayRateCard (Today shows it after 20:00). It renders its own Sections: do not wrap it in another Section.
import { Button, Chip, Group, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconDoorExit, IconMoodSmile } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import * as f from '../../fmt';
import { grades, type DayRating } from '../../grades';
import { act, useLoad, usePageActive } from '../../hooks';
import { emit, toast, useRefresh } from '../../store';
import { hm } from '../../time';
import { Section } from '../../ui/Page';
import { v2, type CloseDay } from '../../v2';
import { Hint } from './kit';

export const FACES = ['', 'Rough', 'Meh', 'OK', 'Good', 'Great'];
export const TAG_LABEL: Record<string, string> = {
  launch_used: 'Used Kickoff',
  gym: 'Gym',
  late_start: 'Late start',
  family_event: 'Family event',
  power_cut: 'Power cut',
  outside: 'Outside',
};
/** Tags arrive as an array or a JSON string. */
export const tagList = (t: unknown): string[] => {
  if (Array.isArray(t)) return t as string[];
  try {
    const a: unknown = JSON.parse(String(t ?? '[]'));
    return Array.isArray(a) ? (a as string[]) : [];
  } catch {
    return [];
  }
};

/** App clock (time.ts), whatever the device says. Late = 20:00–04:00. */
export const isLate = () => {
  const hour = Number(hm(Date.now()).slice(0, 2));
  return hour >= 20 || hour < 4;
};

/** 1–5 rating with an optional note and tags. No Section around it: callers place it. */
export function DayRatingBody({ active, day }: { active: boolean; day?: string }) {
  const r = useLoad(() => grades.dayRating(day), active, [day], { key: `day-rating:${day ?? 'today'}` });
  const [note, setNote] = useState('');
  const cur = r.data?.rating ?? null;
  const tagsNow = tagList(r.data?.tags);
  const set = (v: DayRating) => r.setData(v);

  const toggleTag = async (t: string) => {
    if (cur === null) return;
    const next = tagsNow.includes(t) ? tagsNow.filter((x) => x !== t) : [...tagsNow, t];
    const v = await act(grades.rateDay(cur, r.data?.note || '', day, next));
    if (v) set(v);
  };
  const rate = async (n: number) => {
    if (cur === n) {
      const prev = r.data;
      if ((await act(grades.clearDayRating(day))) !== null) {
        set(null);
        emit('goals');
        toast('Cleared', {
          action: prev
            ? {
                label: 'Undo',
                run: () =>
                  void act(grades.rateDay(prev.rating, prev.note, day, tagList(prev.tags))).then((v) => {
                    if (v) set(v);
                  }),
              }
            : undefined,
        });
      }
      return;
    }
    const v = await act(grades.rateDay(n, note || r.data?.note || '', day, tagsNow));
    if (v) {
      set(v);
      emit('goals');
    }
  };
  const saveNote = async (e: FormEvent) => {
    e.preventDefault();
    if (cur === null || !note.trim()) return;
    const v = await act(grades.rateDay(cur, note.trim(), day, tagsNow), 'Note saved');
    if (v) {
      set(v);
      setNote('');
    }
  };

  return (
    <Stack gap="sm" role="group" aria-label="Rate today">
      <Text size="sm" fw={600}>
        How was today?
      </Text>
      <Group gap={6} grow wrap="nowrap">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            variant={cur === n ? 'filled' : 'default'}
            aria-pressed={cur === n}
            onClick={() => void rate(n)}
            px={4}
            h={56}
            styles={{ label: { flexDirection: 'column', gap: 2 } }}
          >
            <Text span className="num" fw={650} size="md" lh={1}>
              {n}
            </Text>
            <Text span size="xs" lh={1}>
              {FACES[n]}
            </Text>
          </Button>
        ))}
      </Group>
      {cur !== null && (
        <form onSubmit={(e) => void saveNote(e)}>
          <Group gap="xs" wrap="nowrap">
            <TextInput
              aria-label="Note for today"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.currentTarget.value)}
              placeholder={r.data?.note || 'One line about today (optional)'}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Button type="submit" variant="light" disabled={!note.trim()}>
              Save
            </Button>
          </Group>
        </form>
      )}
      {cur !== null && (
        <Group gap={6} role="group" aria-label="What was in today">
          {Object.keys(TAG_LABEL).map((t) => (
            <Chip key={t} size="xs" checked={tagsNow.includes(t)} onChange={() => void toggleTag(t)}>
              {TAG_LABEL[t]}
            </Chip>
          ))}
        </Group>
      )}
      <Hint>Private. Feeds the week view; skipping a day leaves no mark. Tags let the app spot patterns after 40 days.</Hint>
    </Stack>
  );
}

/** Close the day: one line for tomorrow, then nothing else asks for attention. */
export function CloseDayBody({ active }: { active: boolean }) {
  const st = useLoad(() => v2.closeDayState(), active, [], { key: 'close-day' });
  const up = useLoad(() => v2.tasks('upcoming'), active, [], { key: 'tasks:upcoming' });
  useRefresh('tasks', () => void up.reload());
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CloseDay | null>(null);
  const closed = result ?? st.data?.closed ?? null;
  const late = isLate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!first.trim()) return void toast('One line for tomorrow');
    setBusy(true);
    const r = await act(v2.closeDay(first.trim(), note.trim() || undefined));
    setBusy(false);
    if (r) {
      setResult(r);
      void st.reload();
    }
  };

  const line = st.data?.tomorrow_first ?? closed?.first_thing ?? null;
  const task = up.data?.[0];
  const tomorrow = (
    <Stack gap={2}>
      {line || task ? (
        <>
          <Text size="xs" c="dimmed">
            Tomorrow starts with
          </Text>
          <Text fw={600}>{line ?? task?.title}</Text>
          {!line && task?.est_minutes ? <Hint>{f.mins(task.est_minutes)}</Hint> : null}
        </>
      ) : (
        <Hint>Nothing set for tomorrow. The nightly plan fills it.</Hint>
      )}
    </Stack>
  );

  if (closed) {
    return (
      <Stack gap="xs">
        <Text fw={600}>Day closed.</Text>
        {closed.first_thing && (
          <Text size="sm">
            <Text span c="dimmed">
              First thing tomorrow:{' '}
            </Text>
            {closed.first_thing}
          </Text>
        )}
        {(result?.message ?? closed.message) && <Hint>{result?.message ?? closed.message}</Hint>}
        {!closed.first_thing && tomorrow}
      </Stack>
    );
  }
  if (!open && !late) {
    return (
      <Stack gap="xs">
        {tomorrow}
        <Group>
          <UnstyledButton onClick={() => setOpen(true)}>
            <Text size="sm" c="blue">
              Close the day
            </Text>
          </UnstyledButton>
        </Group>
      </Stack>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Stack gap="sm">
        <TextInput
          label="First thing tomorrow"
          value={first}
          onChange={(e) => setFirst(e.currentTarget.value)}
          maxLength={120}
          autoComplete="off"
          placeholder="Open the project doc"
        />
        <TextInput
          label="Anything to leave here (optional)"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          maxLength={300}
          autoComplete="off"
        />
        <Group gap="xs">
          <Button type="submit" loading={busy}>
            Close day
          </Button>
          {!late && (
            <Button variant="subtle" color="gray" onClick={() => setOpen(false)}>
              Later
            </Button>
          )}
        </Group>
        {tomorrow}
      </Stack>
    </form>
  );
}

/** Stable export for Today: rate today + close the day + tomorrow's first thing. Two Sections; never wrap it in a Section. */
export function DayRateCard({ active, day }: { active?: boolean; day?: string }) {
  const pageActive = usePageActive();
  const on = active ?? pageActive;
  return (
    <Stack gap="md">
      <Section title="Rate today" icon={IconMoodSmile}>
        <DayRatingBody active={on} day={day} />
      </Section>
      {!day && (
        <Section title="Close the day" icon={IconDoorExit}>
          <CloseDayBody active={on} />
        </Section>
      )}
    </Stack>
  );
}
