import { Button, Group, SimpleGrid, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconExternalLink, IconPencil } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api, asApiError, type NoteFile } from '../../../api';
import { STROKE } from '../../../app/icons';
import { feel } from '../../../sound';
import { ago } from '../../../fmt';
import { emit, toast, toastUndo, useRefresh } from '../../../store';
import { Md } from '../../../ui/Md';
import { Empty, ErrorState, Loading, Section } from '../../../ui/Page';
import { noteTitle, obsidianHref } from '../notesUtil';
import { Compare } from './Compare';

type Clash = { theirs: string; theirsMtime: string; mine: string };

export function NoteBody({ path }: { path: string }) {
  const [file, setFile] = useState<NoteFile | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<ReturnType<typeof asApiError> | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [clash, setClash] = useState<Clash | null>(null);
  const [append, setAppend] = useState('');
  const [appending, setAppending] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const next = await api.noteFile(path);
      setFile(next);
      setMissing(false);
    } catch (e) {
      const err = asApiError(e);
      if (err.status === 404) {
        setMissing(true);
        setFile(null);
      } else setError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useRefresh('notes', () => {
    if (!editing) void load();
  });

  const save = async (content: string, baseMtime: string) => {
    setSaving(true);
    try {
      const r = await api.saveNote(path, content, baseMtime);
      setFile({ path, content, mtime: r.mtime });
      setEditing(false);
      setClash(null);
      feel('tap');
      toast('Note saved');
      emit('notes');
    } catch (e) {
      const err = asApiError(e);
      if (err.status === 409 && err.body) {
        setClash({ theirs: String(err.body.content ?? ''), theirsMtime: String(err.body.mtime ?? ''), mine: content });
      } else toast(err.message);
    } finally {
      setSaving(false);
    }
  };

  const doAppend = async () => {
    const t = append.trim();
    if (!t) return;
    setAppending(true);
    try {
      await api.appendNote(path, t);
      setAppend('');
      feel('tap');
      toast('Added to note');
      emit('notes');
      await load();
    } catch (err) {
      toast(asApiError(err).message);
    } finally {
      setAppending(false);
    }
  };

  /** Leaving the editor with changes: discard, with Undo to get them back. */
  const cancelEdit = () => {
    setEditing(false);
    if (!file || draft === file.content) return;
    const kept = draft;
    toastUndo('Changes discarded', () => {
      setDraft(kept);
      setEditing(true);
    });
  };

  return (
    <Stack component="article" gap="md" aria-labelledby="note-title">
      <Section>
        <Stack gap={6}>
          <Title order={2} size="h3" id="note-title">
            {noteTitle(path)}
          </Title>
          <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
            {path}
            {file && `, changed ${ago(file.mtime)}`}
          </Text>
          <Group gap="xs" mt={4}>
            <Button size="xs" variant="default" component="a" href={obsidianHref(path)} leftSection={<IconExternalLink size={14} stroke={STROKE} />}>
              Open in Obsidian
            </Button>
            {file && !editing && (
              <Button
                size="xs"
                leftSection={<IconPencil size={14} stroke={STROKE} />}
                onClick={() => {
                  setDraft(file.content);
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            )}
          </Group>
        </Stack>
      </Section>

      {!file && !missing && !error && <Loading label="Loading note" lines={8} />}
      {error && <ErrorState error={error} onRetry={() => void load()} />}
      {missing && <Empty title="This note does not exist yet.">Add a line below and it will be created.</Empty>}

      {clash && (
        <Section title="This note changed somewhere else while you edited.">
          <Text size="sm" c="dimmed" mb="sm">
            Pick the version to keep. The other one is discarded.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Stack gap="xs">
              <Text fw={600} size="sm" component="h4" m={0}>
                Yours
              </Text>
              <Compare text={clash.mine} />
              <Button disabled={saving} onClick={() => void save(clash.mine, clash.theirsMtime)}>
                Keep mine
              </Button>
            </Stack>
            <Stack gap="xs">
              <Text fw={600} size="sm" component="h4" m={0}>
                Theirs (on the server)
              </Text>
              <Compare text={clash.theirs} />
              <Button
                variant="default"
                onClick={() => {
                  setFile({ path, content: clash.theirs, mtime: clash.theirsMtime });
                  setEditing(false);
                  setClash(null);
                }}
              >
                Keep theirs
              </Button>
            </Stack>
          </SimpleGrid>
        </Section>
      )}

      {file && editing && !clash && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft, file.mtime);
          }}
        >
          <Stack gap="sm">
            <Textarea
              id="note-editor"
              data-draft
              aria-label="Note text"
              autosize
              minRows={10}
              spellCheck
              value={draft}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 'var(--mantine-font-size-sm)' } }}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault();
                  void save(draft, file.mtime);
                }
              }}
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="subtle" color="gray" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || draft === file.content}>
                {saving ? 'Saving…' : 'Save note'}
              </Button>
            </Group>
          </Stack>
        </form>
      )}

      {file && !editing && (
        <Section>
          {file.content.trim() ? (
            <Md src={file.content} lead />
          ) : (
            <Text size="sm" c="dimmed">
              This note is empty.
            </Text>
          )}
        </Section>
      )}

      {(file || missing) && !editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void doAppend();
          }}
        >
          <Stack gap="xs">
            <Textarea
              id="note-append"
              data-draft
              label="Add to this note"
              placeholder="Goes under today's date heading."
              autosize
              minRows={2}
              value={append}
              onChange={(e) => setAppend(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button type="submit" variant="default" disabled={appending || !append.trim()}>
                {appending ? 'Adding…' : 'Add'}
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
