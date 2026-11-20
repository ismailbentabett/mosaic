import { Button, Card, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad } from '../../hooks';
import { life } from '../../life';
import { feel } from '../../sound';
import { toast } from '../../store';
import { Section } from '../../ui/Page';
import { v2, type Ask } from '../../v2';
import { Blur } from '../money/blur';

// ---------------------------------------------------------------- needs you

type Need = { key: string; text: string; sub?: string; action?: { label: string; run: () => Promise<void> } };

export function NeedsYou({ active }: { active: boolean }) {
  const safe = <T,>(p: Promise<T>, fb: T) => p.catch(() => fb);
  const load = useLoad(
    async () => {
      const [asks, promises, people, occasions, waiting, capsules, habitat] = await Promise.all([
        safe(v2.asks(1), [] as Awaited<ReturnType<typeof v2.asks>>),
        safe(life.promisesSoon(), []),
        safe(life.peopleDue(), []),
        safe(life.occasionsSoon(), []),
        safe(life.waitingDue(), []),
        safe(life.capsulesDue(), []),
        safe(life.habitat(), null),
      ]);
      return { asks, promises, people, occasions, waiting, capsules, habitat };
    },
    active,
    [],
    { key: 'needs-you' },
  );
  const [opened, setOpened] = useState<{ title: string; body: string } | null>(null);
  const [askVal, setAskVal] = useState('');
  if (!load.data) return null;
  const d = load.data;
  const items: Need[] = [];
  const asks: Ask[] = Array.isArray(d.asks) ? (d.asks as unknown as Ask[]) : [];
  for (const p of d.promises) items.push({ key: `p${p.id}`, text: `Promise to ${p.who}: ${p.what}`, sub: p.due ? `Due ${f.day(p.due).replace(/^(Today|Tomorrow|Yesterday)$/, (w) => w.toLowerCase())}` : 'No date', action: { label: 'Kept', run: async () => { if (await act(life.keepPromise(p.id))) { feel('done'); load.reload(); } } } });
  for (const p of d.people) items.push({ key: `pe${p.id}`, text: `Talk to ${p.name}`, sub: `${p.days_since} days since`, action: { label: 'Talked', run: async () => { if (await act(life.touch(String(p.id)))) { toast(`Noted: ${p.name}`); load.reload(); } } } });
  for (const o of d.occasions) items.push({ key: `o${o.id}`, text: `${o.name}${o.years ? ` (${o.years})` : ''}`, sub: o.days_until <= 0 ? 'today' : o.days_until === 1 ? 'tomorrow' : `in ${f.plural(o.days_until, 'day')}` });
  for (const w of d.waiting) items.push({ key: `w${w.id}`, text: `Check: ${w.title}`, sub: w.waiting_for ?? undefined });
  for (const c of d.capsules) items.push({ key: `c${c.id}`, text: 'A note from past you', sub: c.title, action: { label: 'Open', run: async () => { const r = await act(life.openCapsule(c.id)); if (r) setOpened(r); } } });
  const shown = items.slice(0, asks.length ? 4 : 5);
  const ask = asks[0];
  const h = d.habitat;
  if (!ask && shown.length === 0 && !h) return null;

  const answer = async (v: string) => {
    if (!ask || !v.trim()) return;
    if (await act(v2.answerAsk(ask.key ?? String(ask.id), v.trim()))) {
      setAskVal('');
      load.reload();
    }
  };

  return (
    <Section title="Needs you" icon={IconChevronRight}>
      <Stack gap={8}>
        {h?.free_to_spend && (
          <Text size="sm">
            Free to spend this week: <Blur inline><b className="num">{f.money(h.free_to_spend.free, h.free_to_spend.currency)}</b></Blur>
            {h.free_to_spend.estimate ? ' (estimate)' : ''}
          </Text>
        )}
        {h?.experiment && <Text size="sm" c="dimmed">Experiment: {String((h.experiment as { name?: string }).name ?? h.experiment)}</Text>}
        {h?.lent_open?.count ? <Text size="sm" c="dimmed">{h.lent_open.lent ? `${f.plural(h.lent_open.lent, 'item')} lent out` : ''}{h.lent_open.lent && h.lent_open.borrowed ? ' · ' : ''}{h.lent_open.borrowed ? `${f.plural(h.lent_open.borrowed, 'item')} borrowed` : ''}</Text> : null}
        {ask && (
          <Card withBorder radius="md" padding="sm">
            <Text fw={600} size="sm">{ask.question}</Text>
            {ask.why && <Text size="xs" c="dimmed">{ask.why}</Text>}
            {ask.answer_type === 'choice' && ask.options ? (
              <Group gap={6} mt={6}>{ask.options.map((o) => <Button key={o} size="compact-sm" variant="light" onClick={() => void answer(o)}>{o}</Button>)}</Group>
            ) : (
              <Group gap={6} mt={6} wrap="nowrap">
                <TextInput size="sm" aria-label={ask.question ?? 'Answer'} enterKeyHint="send" style={{ flex: 1 }} value={askVal} onChange={(e) => setAskVal(e.currentTarget.value)} inputMode={ask.answer_type === 'number' ? 'decimal' : undefined} onKeyDown={(e) => e.key === 'Enter' && void answer(askVal)} />
                <Button size="compact-sm" onClick={() => void answer(askVal)}>Save</Button>
              </Group>
            )}
            {/* Every ask, choice ones included, can wait (Later = 3 days) or be skipped (90 days). */}
            <Group gap={6} mt={4}>
              <Button size="compact-sm" variant="subtle" color="gray" onClick={() => void act(v2.skipAsk(ask.key ?? String(ask.id), 3)).then(load.reload)}>Later</Button>
              <Button size="compact-sm" variant="subtle" color="gray" onClick={() => void act(v2.skipAsk(ask.key ?? String(ask.id), 90)).then(load.reload)}>Skip</Button>
            </Group>
          </Card>
        )}
        {shown.map((n) => (
          <Group key={n.key} justify="space-between" wrap="nowrap" gap="xs">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} truncate>{n.text}</Text>
              {n.sub && <Text size="xs" c="dimmed">{n.sub}</Text>}
            </div>
            {n.action && <Button size="compact-sm" variant="light" onClick={() => void n.action!.run()}>{n.action.label}</Button>}
          </Group>
        ))}
        {opened && (
          <Card withBorder radius="md" padding="sm">
            <Text fw={600}>{opened.title}</Text>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{opened.body}</Text>
            <Button size="compact-sm" variant="subtle" mt={6} onClick={() => setOpened(null)}>Close</Button>
          </Card>
        )}
      </Stack>
    </Section>
  );
}
