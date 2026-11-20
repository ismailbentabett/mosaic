// Search: one box over the vault and everything tracked. ?q= stays in the URL.
// Desktop: a note hit opens beside the list; other hits open their place.
import { Box, Button, Chip, Grid, Group, Text, TextInput, VisuallyHidden } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconNotes, IconPlus, IconSearch, IconSparkles, IconTrash } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { v2, type BrainHit, type BrainSearch } from '../../v2';
import { PLACE_ICON, STROKE } from '../../app/icons';
import { copy } from '../../copy';
import { day, kcal, money, plural } from '../../fmt';
import { usePageActive, usePageSearch } from '../../hooks';
import { ASK_PATH, go, replace } from '../../router';
import { openQuickCapture } from '../../ui';
import { Empty, Loading, Page, Section } from '../../ui/Page';
import { HitRow, NoteReader, Rows, SearchFail, useSearch } from './parts';
import { KIND_ORDER, kindOf, local, noteDay, noteSource } from './notesUtil';

const RECENT_KEY = 'mosaic.brain.recent';
const RECENT_MAX = 8;
const DESKTOP = '(min-width: 64em)';

function readRecent(): string[] {
  try {
    const v = JSON.parse(local.get(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
const writeRecent = (list: string[]) => local.set(RECENT_KEY, list.length ? JSON.stringify(list) : null);

/** Value shown on the right of a hit (amount, kcal, status). */
function metaOf(kind: string, h: BrainHit): string | undefined {
  if (kind === 'record' && h.amount != null) return `${h.income ? '+' : ''}${money(h.amount, h.currency)}${h.income ? ' in' : ''}`;
  if (kind === 'food' && h.kcal != null) return `${kcal(h.kcal)} per 100 g`;
  if (h.status) return h.status === 'done' ? 'Done' : h.status === 'open' ? 'Open' : h.status;
  return undefined;
}

/** Snippet without a leading heading line, whitespace squeezed. */
function snipOf(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const out = s.replace(/^\s*#[^\n]*\n/, '').replace(/\s+/g, ' ').trim();
  return out || undefined;
}

const looksLikeNote = (s: string) => /\.md$/i.test(s) || s.includes('/');

export function SearchScreen() {
  const active = usePageActive();
  const params = new URLSearchParams(usePageSearch());
  const urlQ = params.get('q');
  const urlFocus = params.get('focus');
  const wide = useMediaQuery(DESKTOP) ?? false;

  const [q, setQ] = useState(urlQ ?? '');
  const qRef = useRef(q);
  qRef.current = q;
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [reader, setReader] = useState<string | null>(null);
  const readerBox = useRef<HTMLDivElement>(null);
  const hitRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const res = useSearch<BrainSearch>(q, (t) => v2.brain(t));

  // URL -> state (deep links, back/forward).
  useEffect(() => {
    if (urlQ !== null && urlQ !== qRef.current) setQ(urlQ);
  }, [urlQ]);

  // ?focus=<note path>: open that note (beside the list on desktop), then drop it from the URL.
  useEffect(() => {
    if (!active || !urlFocus) return;
    const t = qRef.current.trim();
    if (looksLikeNote(urlFocus)) {
      if (wide) setReader(urlFocus);
      else {
        go(kindOf('note').href(urlFocus));
        return;
      }
    }
    replace(t ? `/brain/search?q=${encodeURIComponent(t)}` : '/brain/search');
  }, [active, urlFocus, wide]);

  // Narrow window: the reader closes.
  useEffect(() => {
    if (!wide) setReader(null);
  }, [wide]);

  const onQuery = (v: string) => {
    setQ(v);
    if (active) {
      const t = v.trim();
      replace(t ? `/brain/search?q=${encodeURIComponent(t)}` : '/brain/search');
    }
  };

  const remember = (term: string) => {
    const t = term.trim();
    if (t.length < 2) return;
    setRecent((list) => {
      const next = [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_MAX);
      writeRecent(next);
      return next;
    });
  };
  const clearRecent = () => {
    writeRecent([]);
    setRecent([]);
  };

  const openHit = (kind: string, h: BrainHit) => {
    remember(q);
    if (kind === 'note' && wide) {
      setReader(h.id);
      return;
    }
    go(kindOf(kind).href(h.id));
  };

  const closeReader = () => {
    const path = reader;
    setReader(null);
    if (path) window.requestAnimationFrame(() => hitRefs.current.get(path)?.focus({ preventScroll: true }));
  };

  const data = res.data;
  const kinds = data ? [...KIND_ORDER.filter((k) => data.results[k]?.length), ...Object.keys(data.results).filter((k) => !KIND_ORDER.includes(k) && data.results[k]?.length)] : [];

  const places = (
    <Group gap="xs">
      <Button size="xs" variant="default" leftSection={<IconNotes size={14} stroke={STROKE} />} onClick={() => go('/brain/notes')}>
        All notes
      </Button>
      <Button size="xs" variant="default" leftSection={<IconSparkles size={14} stroke={STROKE} />} onClick={() => go(ASK_PATH)}>
        Ask
      </Button>
      <Button size="xs" variant="default" leftSection={<IconPlus size={14} stroke={STROKE} />} onClick={() => openQuickCapture()}>
        Capture
      </Button>
    </Group>
  );

  const results = !res.on ? (
    <>
      {recent.length > 0 && (
        <Section
          title="Recent searches"
          right={
            <Button size="compact-sm" variant="subtle" color="gray" leftSection={<IconTrash size={12} stroke={STROKE} />} onClick={clearRecent}>
              Clear
            </Button>
          }
        >
          <Group gap={6}>
            {recent.map((r) => (
              <Chip key={r} size="sm" checked={false} onChange={() => onQuery(r)}>
                {r}
              </Chip>
            ))}
          </Group>
        </Section>
      )}
      {places}
      <Text size="sm" c="dimmed">
        Type two letters or more. One search covers your notes and everything you track. Press / to search from anywhere.
      </Text>
    </>
  ) : (
    <>
      <Text size="sm" c="dimmed" role="status" aria-live="polite">
        {res.loading ? 'Searching' : data ? plural(data.total, 'result') : ''}
      </Text>
      {res.error ? (
        <SearchFail error={res.error} onFix={res.retry} />
      ) : !data ? (
        <Loading label="Searching" />
      ) : data.total === 0 || !kinds.length ? (
        <Empty
          title={copy.empty.search}
          icon={IconSearch}
          action={
            <Button size="xs" variant="default" leftSection={<IconPlus size={14} stroke={STROKE} />} onClick={() => openQuickCapture('note', q.trim())}>
              Capture
            </Button>
          }
        >
          Try a shorter word, or capture it now.
        </Empty>
      ) : (
        kinds.map((k) => {
          const kind = kindOf(k);
          const hits = data.results[k] ?? [];
          return (
            <Section key={k} title={kind.label} hint={String(hits.length)} flush>
              <Rows label={kind.label}>
                {hits.map((h) => {
                  const meta = metaOf(k, h);
                  return (
                    <HitRow
                      key={h.id}
                      ref={(el) => {
                        if (k === 'note') hitRefs.current.set(h.id, el);
                      }}
                      title={h.title}
                      snippet={meta ? undefined : snipOf(h.snippet)}
                      query={res.q}
                      source={k === 'note' ? noteSource(h.id) : kind.badge}
                      when={h.day ? day(h.day) : k === 'note' ? noteDay(h.id) : undefined}
                      meta={meta}
                      conflict={h.conflict}
                      selected={k === 'note' && reader === h.id}
                      onOpen={() => openHit(k, h)}
                    />
                  );
                })}
              </Rows>
            </Section>
          );
        })
      )}
    </>
  );

  return (
    <Page title="Search" icon={PLACE_ICON.search} back="/brain" wide={wide && !!reader}>
      <TextInput
        id="brain-search"
        type="search"
        size="md"
        leftSection={<IconSearch size={18} stroke={STROKE} />}
        placeholder="Search notes, tasks, money, food, workouts"
        aria-label="Search everything"
        value={q}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(e) => onQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') remember(e.currentTarget.value);
          if (e.key === 'Escape' && q) {
            e.preventDefault();
            onQuery('');
          }
        }}
      />
      {wide && reader ? (
        <Grid gap="lg">
          <Grid.Col span={5}>
            <Box component="section" aria-label="Results" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mantine-spacing-md)' }}>
              {results}
            </Box>
          </Grid.Col>
          <Grid.Col span={7}>
            <Box ref={readerBox} pos="sticky" top="calc(var(--app-shell-header-offset, 0px) + 16px)">
              <Section>
                <VisuallyHidden component="h2">Preview</VisuallyHidden>
                <NoteReader path={reader} onClose={closeReader} />
              </Section>
            </Box>
          </Grid.Col>
        </Grid>
      ) : (
        results
      )}
    </Page>
  );
}
