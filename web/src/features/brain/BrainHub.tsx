// Brain hub: one search box and a tile per place (Search, Notes, Ask, Ideas, Cards, Documents).
// Each tile carries one live line. A tile whose data fails to load shows its plain description.
import { Button, Group, Paper, SimpleGrid, Stack, Text, TextInput, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconChevronRight, IconPlus, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../../api';
import { PLACE_ICON, STROKE, type AppIcon } from '../../app/icons';
import { BRAND } from '../../brand';
import { ago, day, num, plural } from '../../fmt';
import { usePageActive } from '../../hooks';
import { go } from '../../router';
import { feel } from '../../sound';
import { useRefresh } from '../../store';
import { openQuickCapture } from '../../ui';
import { useLoad } from '../../ui/data';
import { Page } from '../../ui/Page';
import { v2, type Doc } from '../../v2';
import { local } from './notesUtil';

function recentSearches(): string[] {
  try {
    const v = JSON.parse(local.get('mosaic.brain.recent') ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** An ended paper (not renewed) shows first: it is never hidden behind the next upcoming one. */
function nextExpiry(docs: Doc[]): string {
  if (!docs.length) return 'No documents yet';
  const dated = docs
    .filter((d) => d.expires_on && d.days_left !== null && !d.renewed && d.state !== 'renewed')
    .sort((a, b) => a.days_left! - b.days_left!);
  const next = dated[0];
  if (!next) return plural(docs.length, 'document');
  if (next.line) return next.line;
  if (next.days_left! < 0) return `${next.name}: ended ${day(next.expires_on).toLowerCase()}`;
  if (next.days_left === 0) return `${next.name}: ends today`;
  return `${next.name}: ${plural(next.days_left!, 'day')} left`;
}

/** Run names in plain words (the nightly run is titled "Nightly plan", command runs "/plan-tomorrow"). */
const RUN_WORDS: Record<string, string> = {
  'nightly plan': "tomorrow's plan",
  'plan-tomorrow': "tomorrow's plan",
  'what-now': 'what now',
  'weekly-review': 'weekly review',
  'friday-review': 'Friday review',
  'deliverability-check': 'inbox check',
  'money-check': 'money check',
  'add-to-inbox': 'add to Inbox',
  'zero-day': 'zero day',
  'fresh-start': 'fresh start',
};

/** A chat title as a person would say it: "/plan-tomorrow" -> "tomorrow's plan". */
export function chatWords(title: string | null | undefined): string {
  const t = (title ?? '').trim();
  if (!t) return 'untitled chat';
  const key = t.toLowerCase().replace(/^\//, '').split(/\s/)[0];
  if (RUN_WORDS[t.toLowerCase()]) return RUN_WORDS[t.toLowerCase()];
  if (t.startsWith('/')) return RUN_WORDS[key] ?? key.replace(/-/g, ' ');
  return t;
}

type Tile = { id: string; label: string; icon: AppIcon; path: string; line: string; fallback: string };

export function BrainHub() {
  const active = usePageActive();
  const [q, setQ] = useState('');
  const notes = useLoad(() => api.notesRecent(), active, [], { key: 'notes-recent' });
  const chats = useLoad(() => api.chats(), active, [], { key: 'brain-chats' });
  const ideas = useLoad(() => v2.tasks('someday'), active, [], { key: 'plan-ideas' });
  const cards = useLoad(() => v2.cardQueue(), active, [], { key: 'cards-queue' });
  const docs = useLoad(() => v2.documents(), active, [], { key: 'documents' });
  useRefresh('notes', () => void notes.reload());
  useRefresh('tasks', () => void ideas.reload());

  const recent = recentSearches();
  const lastChat = chats.data?.chats[0];
  const tiles: Tile[] = [
    {
      id: 'search',
      label: 'Search',
      icon: PLACE_ICON.search,
      path: '/brain/search',
      line: recent.length ? `Recent: ${recent.slice(0, 2).join(', ')}` : '',
      fallback: 'Notes, tasks, money, food, workouts',
    },
    {
      id: 'notes',
      label: 'Notes',
      icon: PLACE_ICON.notes,
      path: '/brain/notes',
      line: notes.data
        ? `${notes.data.today.exists ? "Today's log started" : "Today's log not started"} · ${num(notes.data.notes.length)} recent`
        : '',
      fallback: 'The vault: logs, docs, ideas',
    },
    {
      id: 'ask',
      label: BRAND.assistant,
      icon: PLACE_ICON.ask,
      path: '/chat',
      line: lastChat ? `Last: ${chatWords(lastChat.title)}, ${ago(lastChat.updatedAt)}` : chats.data ? 'No chats yet' : '',
      fallback: 'Talk about your notes and plans',
    },
    {
      id: 'ideas',
      label: 'Ideas',
      icon: PLACE_ICON.ideas,
      path: '/brain/ideas',
      line: ideas.data ? (ideas.data.length ? `${plural(ideas.data.length, 'idea')} parked` : 'Nothing parked') : '',
      fallback: 'Someday, brain dump, questions',
    },
    {
      id: 'cards',
      label: 'Cards',
      icon: PLACE_ICON.cards,
      path: '/brain/cards',
      line: cards.data ? (cards.data.due > 0 ? `${num(cards.data.due)} due now` : cards.data.total ? 'Nothing due now' : 'No cards yet') : '',
      fallback: 'Flashcards, spaced review',
    },
    {
      id: 'documents',
      label: 'Documents',
      icon: PLACE_ICON.documents,
      path: '/brain/documents',
      line: docs.data ? nextExpiry(docs.data) : '',
      fallback: 'Papers that expire',
    },
  ];

  return (
    <Page
      title="Brain"
      icon={PLACE_ICON.brain}
      actions={
        <Button size="sm" variant="light" leftSection={<IconPlus size={16} stroke={STROKE} />} onClick={() => openQuickCapture('note')}>
          Capture
        </Button>
      }
    >
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const t = q.trim();
          go(t ? `/brain/search?q=${encodeURIComponent(t)}` : '/brain/search');
        }}
      >
        <TextInput
          id="brain-search"
          type="search"
          size="md"
          aria-label="Search everything"
          placeholder="Search notes, tasks, money, food, workouts"
          leftSection={<IconSearch size={18} stroke={STROKE} />}
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQ('');
          }}
        />
      </form>
      <SimpleGrid cols={{ base: 2, md: 3 }} spacing="sm" component="nav" aria-label="Brain places">
        {tiles.map((t) => (
          <UnstyledButton
            key={t.id}
            h="100%"
            onClick={() => {
              feel('tap');
              go(t.path);
            }}
            aria-label={`${t.label}. ${t.line || t.fallback}`}
          >
            <Paper withBorder radius="md" p="sm" h="100%">
              <Stack gap={8}>
                <Group justify="space-between" wrap="nowrap">
                  <ThemeIcon variant="light" size={34} radius="md">
                    <t.icon size={19} stroke={STROKE} />
                  </ThemeIcon>
                  <IconChevronRight size={16} stroke={STROKE} color="var(--mantine-color-dimmed)" />
                </Group>
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text fw={600} size="sm" truncate>
                    {t.label}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={2} className="num">
                    {t.line || t.fallback}
                  </Text>
                </Stack>
              </Stack>
            </Paper>
          </UnstyledButton>
        ))}
      </SimpleGrid>
    </Page>
  );
}
