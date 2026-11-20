import { Button, Chip, Group, Stack, Text, Textarea } from '@mantine/core';
import { useEffect, useState } from 'react';
import { grades } from '../../grades';
import { act, useLoad } from '../../hooks';
import { emit } from '../../store';
import { Section } from '../../ui/Page';

const RATINGS = ['Rough', 'Meh', 'OK', 'Good', 'Great'];
const TAGS: [string, string][] = [
  ['launch_used', '🚀 Used Kickoff'],
  ['gym', '🏋️ Gym'],
  ['late_start', '⏰ Late start'],
  ['family_event', '👪 Family event'],
  ['power_cut', '🔌 Power cut'],
  ['outside', '🌤️ Outside'],
];
const tagList = (t: unknown): string[] => {
  if (Array.isArray(t)) return t as string[];
  if (typeof t === 'string' && t) {
    try {
      const v = JSON.parse(t);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
};

export function DayRating() {
  const r = useLoad(() => grades.dayRating(), true, [], { key: 'day-rating' });
  const [note, setNote] = useState('');
  const cur = (r.data as { rating?: number | null; note?: string; tags?: unknown } | null) ?? null;
  const rating = cur?.rating ?? null;
  const tags = tagList(cur?.tags);
  useEffect(() => setNote(cur?.note ?? ''), [cur?.note]);
  const rate = async (n: number) => {
    if (n === rating) {
      if (await act(grades.clearDayRating())) r.reload();
      return;
    }
    const x = await act(grades.rateDay(n, note, undefined, tags));
    if (!x) return;
    emit('goals');
    r.setData(x);
  };
  const toggleTag = async (t: string) => {
    if (!rating) return;
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    const x = await act(grades.rateDay(rating, note, undefined, next));
    if (x) r.setData(x);
  };
  return (
    <Section title="Rate the day" hint="Optional">
      <Group gap={6}>
        {RATINGS.map((l, i) => (
          <Button key={l} size="sm" aria-pressed={rating === i + 1} variant={rating === i + 1 ? 'filled' : 'light'} onClick={() => void rate(i + 1)}>{l}</Button>
        ))}
      </Group>
      {rating && (
        <Stack gap={6} mt="sm">
          <Group gap={6}>{TAGS.map(([k, l]) => <Chip key={k} size="sm" checked={tags.includes(k)} onChange={() => void toggleTag(k)}>{l}</Chip>)}</Group>
          <Textarea size="sm" autosize minRows={1} maxLength={300} aria-label="Note about the day" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} onBlur={() => note !== (cur?.note ?? '') && void act(grades.rateDay(rating, note, undefined, tags))} />
        </Stack>
      )}
      <Text size="xs" c="dimmed" mt={6}>Optional. Private. Skipping a day leaves no mark. Tags let the app spot patterns after 40 days.</Text>
    </Section>
  );
}
