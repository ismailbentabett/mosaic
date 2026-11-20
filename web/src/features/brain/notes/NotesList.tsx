import { Alert, Box, Button, Grid, Group, Stack, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconCalendar, IconPin, IconPlus, IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api, type RecentNotes, type SearchResult } from '../../../api';
import { PLACE_ICON, STROKE } from '../../../app/icons';
import { copy } from '../../../copy';
import { ago, num, plural } from '../../../fmt';
import { usePageActive } from '../../../hooks';
import { go } from '../../../router';
import { useRefresh } from '../../../store';
import { openQuickCapture } from '../../../ui';
import { useLoad } from '../../../ui/data';
import { Empty, ErrorState, Loading, Page, Section } from '../../../ui/Page';
import { HitRow, NoteReader, Rows, SearchFail, useSearch } from '../parts';
import { folderOf, noteDay, noteLink, noteSource, noteTitle } from '../notesUtil';
import { NoteRow } from './NoteRow';
import { DESKTOP, NOTES } from './paths';

// ---------- list ----------

export function NotesList() {
  const active = usePageActive();
  const wide = useMediaQuery(DESKTOP) ?? false;
  const [query, setQuery] = useState('');
  const [reader, setReader] = useState<string | null>(null);
  const recent = useLoad<RecentNotes>(() => api.notesRecent(), active, [], { key: 'notes-recent' });
  const conflicts = useLoad(() => api.conflicts().then((r) => r.conflicts.length), active, [], { key: 'notes-conflicts' });
  useRefresh('notes', () => {
    void recent.reload();
    void conflicts.reload();
  });
  const res = useSearch<SearchResult[]>(query, (q) => api.notesSearch(q).then((r) => r.results));

  useEffect(() => {
    if (!wide) setReader(null);
  }, [wide]);

  const open = (path: string) => {
    if (wide) setReader(path);
    else go(noteLink(path));
  };

  const conflictCount = conflicts.data ?? 0;
  const r = recent.data;

  const list = (
    <Stack gap="md">
      <TextInput
        id="notes-search"
        type="search"
        leftSection={<IconSearch size={16} stroke={STROKE} />}
        placeholder="Search the vault"
        aria-label="Search notes"
        value={query}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.preventDefault();
            setQuery('');
          }
        }}
      />

      {conflictCount > 0 && (
        <Alert role="status" variant="light" color="yellow" icon={<IconAlertTriangle size={18} stroke={STROKE} />} p="sm">
          <Group justify="space-between" gap="xs">
            <Text size="sm">
              {plural(conflictCount, 'sync conflict')} {conflictCount === 1 ? 'needs' : 'need'} a decision.
            </Text>
            <Button size="xs" variant="default" onClick={() => go(`${NOTES}/conflicts`)}>
              Resolve
            </Button>
          </Group>
        </Alert>
      )}

      {res.on ? (
        <>
          <Text size="sm" c="dimmed" role="status" aria-live="polite">
            {res.loading ? 'Searching' : res.data ? plural(res.data.length, 'match', 'matches') : ''}
          </Text>
          {res.error ? (
            <SearchFail error={res.error} onFix={res.retry} />
          ) : !res.data ? (
            <Loading label="Searching" />
          ) : res.data.length === 0 ? (
            <Empty
              title={copy.empty.search}
              icon={IconSearch}
              action={
                <Button size="xs" variant="default" leftSection={<IconPlus size={14} stroke={STROKE} />} onClick={() => openQuickCapture('note', query.trim())}>
                  Capture
                </Button>
              }
            >
              Try a shorter word, or capture it as a new note.
            </Empty>
          ) : (
            <Section flush>
              <Rows label="Matches">
                {res.data.map((h) => (
                  <HitRow
                    key={`${h.path}:${h.line}`}
                    title={h.title}
                    snippet={h.snippet}
                    query={res.q}
                    source={noteSource(h.path)}
                    when={noteDay(h.path) ?? (folderOf(h.path) || 'vault')}
                    meta={`line ${num(h.line)}`}
                    selected={reader === h.path}
                    onOpen={() => open(h.path)}
                  />
                ))}
              </Rows>
            </Section>
          )}
        </>
      ) : !r ? (
        recent.error ? <ErrorState error={recent.error} onRetry={recent.reload} /> : <Loading label="Loading notes" lines={6} />
      ) : (
        <>
          <Section flush>
            <Rows label="Today">
              <NoteRow
                icon={<IconCalendar size={18} stroke={STROKE} aria-hidden="true" />}
                title={
                  <>
                    Today's log <Text span c="dimmed" size="sm" fw={400}>{noteTitle(r.today.path)}</Text>
                  </>
                }
                sub={r.today.exists ? 'Open it to read or add a line.' : 'Not started yet. Captured notes land here.'}
                selected={reader === r.today.path}
                onOpen={() => open(r.today.path)}
              />
            </Rows>
          </Section>

          {r.pinned.length > 0 && (
            <Section title="Pinned" icon={IconPin} flush>
              <Rows label="Pinned">
                {r.pinned.map((p) => (
                  <NoteRow key={p.path} title={p.title || noteTitle(p.path)} sub={folderOf(p.path) || 'vault'} selected={reader === p.path} onOpen={() => open(p.path)} />
                ))}
              </Rows>
            </Section>
          )}

          {r.notes.length === 0 ? (
            <Empty title={copy.empty.notes} icon={PLACE_ICON.notes}>
              Your first capture as a note starts today's log.
            </Empty>
          ) : (
            <Section title="Recently changed" hint={num(r.notes.length)} flush>
              <Rows label="Recently changed">
                {r.notes.map((n) => (
                  <NoteRow
                    key={n.path}
                    title={n.title || noteTitle(n.path)}
                    sub={folderOf(n.path) || 'vault'}
                    right={ago(n.mtime)}
                    selected={reader === n.path}
                    onOpen={() => open(n.path)}
                  />
                ))}
              </Rows>
            </Section>
          )}
        </>
      )}
    </Stack>
  );

  return (
    <Page
      title="Notes"
      icon={PLACE_ICON.notes}
      back="/brain"
      wide={wide}
      actions={
        <Button size="xs" variant="default" leftSection={<IconPlus size={14} stroke={STROKE} />} onClick={() => openQuickCapture('note')}>
          Capture
        </Button>
      }
    >
      {wide ? (
        <Grid gap="lg">
          <Grid.Col span={5}>{list}</Grid.Col>
          <Grid.Col span={7}>
            <Box pos="sticky" top="calc(var(--app-shell-header-offset, 0px) + 16px)">
              <Section>
                {reader ? (
                  <NoteReader path={reader} onClose={() => setReader(null)} />
                ) : (
                  <Empty title="Pick a note" icon={PLACE_ICON.notes}>
                    It opens here.
                  </Empty>
                )}
              </Section>
            </Box>
          </Grid.Col>
        </Grid>
      ) : (
        list
      )}
    </Page>
  );
}
