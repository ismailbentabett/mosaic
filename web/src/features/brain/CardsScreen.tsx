// Flashcards: spaced review of the due queue and a two-step add (draft, then check and save).
import { Box, Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconEye, IconTrash } from '@tabler/icons-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PLACE_ICON, STROKE } from '../../app/icons';
import { num, plural } from '../../fmt';
import { usePageActive } from '../../hooks';
import { feel } from '../../sound';
import { toast, toastUndo } from '../../store';
import { act, useLoad } from '../../ui/data';
import { Empty, ErrorState, Loading, Page, Section } from '../../ui/Page';
import { v2, type Card, type CardDraft } from '../../v2';
import { LineForm } from './parts';

const GRADES: { g: 1 | 2 | 3 | 4; label: string }[] = [
  { g: 1, label: 'Again' },
  { g: 2, label: 'Hard' },
  { g: 3, label: 'Good' },
  { g: 4, label: 'Easy' },
];
const GENDER: Record<string, string> = { m: 'masculine (le / un)', f: 'feminine (la / une)' };
const UNDO_MS = 7000;

export function CardsScreen() {
  const active = usePageActive();
  const q = useLoad(() => v2.cardQueue(), active, [], { key: 'cards-queue' });
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  // A deleted card waits out the undo window before the delete is sent.
  const pending = useRef<{ id: string; timer: number } | null>(null);
  const showBtn = useRef<HTMLButtonElement>(null);

  const flush = () => {
    const p = pending.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.current = null;
    void act(v2.deleteCard(p.id));
  };
  useEffect(() => flush, []);

  const d = q.data;
  const card: Card | undefined = d?.cards[0];

  const grade = async (g: 1 | 2 | 3 | 4) => {
    if (!card || busy) return;
    setBusy(true);
    const r = await act(v2.reviewCard(card.id, g));
    setBusy(false);
    if (!r) return;
    feel('tap');
    setShown(false);
    setReviewed((n) => n + 1);
    q.setData((x) => (x ? { ...x, cards: x.cards.slice(1), due: Math.max(0, x.due - (card.reps ? 1 : 0)) } : x));
    if (d && d.cards.length <= 1) void q.reload();
    window.setTimeout(() => showBtn.current?.focus(), 0);
  };

  const remove = (c: Card) => {
    flush();
    setShown(false);
    q.setData((x) => (x ? { ...x, cards: x.cards.filter((y) => y.id !== c.id), total: Math.max(0, x.total - 1) } : x));
    const timer = window.setTimeout(() => {
      pending.current = null;
      void act(v2.deleteCard(c.id)).then(() => void q.reload());
    }, UNDO_MS);
    pending.current = { id: c.id, timer };
    toastUndo('Card deleted', () => {
      if (pending.current?.id === c.id) {
        window.clearTimeout(pending.current.timer);
        pending.current = null;
      }
      void q.reload();
    });
  };

  return (
    <Page
      title="Cards"
      subtitle={
        d ? (
          <span className="num">
            {plural(d.total, 'card')} · {num(d.due)} due · {num(d.new)} new
            {reviewed > 0 ? ` · ${num(reviewed)} reviewed now` : ''}
          </span>
        ) : undefined
      }
      icon={PLACE_ICON.cards}
      back="/brain"
    >
      {q.error && !d && <ErrorState error={q.error} onRetry={() => void q.reload()} />}
      {!d && !q.error && <Loading label="Loading cards" lines={3} />}
      {d &&
        (card ? (
          <Section title="Review" hint={num(d.cards.length)}>
            <Stack gap="md" aria-live="polite">
              <Text lang="fr" fz="var(--app-fz-card)" fw={600} ta="center" py="md">
                {card.front}
              </Text>
              {shown ? (
                <>
                  <Paper withBorder={false} bg="var(--mantine-color-default-hover)" p="md" radius="md">
                    <Stack gap={4} align="center">
                      <Text size="lg" ta="center">
                        {card.back}
                      </Text>
                      {card.gender && (
                        <Text size="sm" c="dimmed">
                          {GENDER[card.gender]}
                        </Text>
                      )}
                      {card.example && (
                        <Text size="sm" c="dimmed" lang="fr" ta="center" fs="italic">
                          {card.example}
                        </Text>
                      )}
                    </Stack>
                  </Paper>
                  <Group grow gap="xs" role="group" aria-label="How well did you know it">
                    {GRADES.map((x) => (
                      <Button key={x.g} variant={x.g === 3 ? 'light' : 'default'} disabled={busy} onClick={() => void grade(x.g)}>
                        {x.label}
                      </Button>
                    ))}
                  </Group>
                </>
              ) : (
                <Button ref={showBtn} size="md" leftSection={<IconEye size={18} stroke={STROKE} />} onClick={() => setShown(true)}>
                  Show
                </Button>
              )}
              <Group justify="flex-end">
                <Button
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  leftSection={<IconTrash size={14} stroke={STROKE} />}
                  onClick={() => remove(card)}
                >
                  Delete card
                </Button>
              </Group>
            </Stack>
          </Section>
        ) : (
          <Empty title={d.total ? 'Nothing due now.' : 'No cards yet.'} icon={PLACE_ICON.cards}>
            {d.total ? 'Come back later. Or add a word.' : 'Add a word you met today.'}
          </Empty>
        ))}
      <Section title="Add a card">
        <CardAdd onAdded={() => void q.reload()} />
      </Section>
    </Page>
  );
}

function CardAdd({ onAdded }: { onAdded: () => void }) {
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [gender, setGender] = useState<'' | 'm' | 'f'>('');
  const [example, setExample] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async (text: string) => {
    const d = await act(v2.draftCard(text));
    if (!d) return false;
    setDraft(d);
    setFront(d.front);
    setBack(d.back);
    setGender(d.gender ?? '');
    setExample('');
    return true;
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!front.trim() || !back.trim()) {
      toast('Front and back are both needed');
      return;
    }
    setBusy(true);
    const r = await act(v2.addCard({ front: front.trim(), back: back.trim(), gender: gender || null, deck: draft?.deck, example: example.trim() || undefined }));
    setBusy(false);
    if (r) {
      feel('capture');
      toast(r.duplicate ? 'Already a card. Kept the old one.' : 'Card added');
      setDraft(null);
      setExample('');
      onAdded();
    }
  };

  if (!draft) {
    return <LineForm id="card-new" label="New card" placeholder='"window = fenster" or just "window"' button="Draft" onSubmit={start} maxLength={200} />;
  }
  return (
    <form onSubmit={save}>
      <Stack gap="sm">
        {draft.note && (
          <Text size="sm" c="dimmed">
            {draft.note}
          </Text>
        )}
        <TextInput label="Front" autoComplete="off" value={front} onChange={(e) => setFront(e.currentTarget.value)} />
        <TextInput
          label={`Meaning${draft.needs_back ? ' (type it)' : ''}`}
          autoComplete="off"
          autoFocus={draft.needs_back}
          value={back}
          onChange={(e) => setBack(e.currentTarget.value)}
        />
        <Select
          label="Gender"
          allowDeselect={false}
          data={[
            { value: 'none', label: 'Not a noun / unsure' },
            { value: 'm', label: 'Masculine' },
            { value: 'f', label: 'Feminine' },
          ]}
          value={gender || 'none'}
          onChange={(v) => setGender((v === 'm' || v === 'f' ? v : '') as '' | 'm' | 'f')}
        />
        <TextInput label="Example (optional)" lang="fr" autoComplete="off" value={example} onChange={(e) => setExample(e.currentTarget.value)} />
        <Box>
          <Group gap="xs">
            <Button type="submit" loading={busy}>
              Add card
            </Button>
            <Button variant="default" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </Group>
        </Box>
      </Stack>
    </form>
  );
}
