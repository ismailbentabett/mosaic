// Pieces shared by Search, Notes and Ideas: debounced search, search failure, hit row,
// the side note reader and a one-line form.
import { Alert, Badge, Box, Button, Group, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconExternalLink, IconPencil, IconRefresh, IconX } from '@tabler/icons-react';
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, asApiError, type ApiError } from '../../api';
import { STROKE } from '../../app/icons';
import { sessionLost } from '../../auth';
import { copy } from '../../copy';
import { ago } from '../../fmt';
import { go } from '../../router';
import { useRefresh } from '../../store';
import { useLoad } from '../../ui/data';
import { Highlight } from '../../ui/Highlight';
import { Md } from '../../ui/Md';
import { Empty, ErrorState, Loading } from '../../ui/Page';
import { noteLink, noteSource, noteTitle, obsidianHref } from './notesUtil';

/** Debounced search: 200 ms, runs at 2+ characters, late answers dropped. `retry` runs it again. */
export function useSearch<T>(query: string, run: (q: string) => Promise<T>) {
  const [state, setState] = useState<{ q: string; data: T | null; error: ApiError | null; loading: boolean }>({
    q: '',
    data: null,
    error: null,
    loading: false,
  });
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const runRef = useRef(run);
  runRef.current = run;
  const term = query.trim();
  useEffect(() => {
    const n = ++seq.current;
    if (term.length < 2) {
      setState({ q: '', data: null, error: null, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const h = window.setTimeout(() => {
      runRef.current(term).then(
        (data) => {
          if (n === seq.current) setState({ q: term, data, error: null, loading: false });
        },
        (e) => {
          if (n === seq.current) setState({ q: term, data: null, error: asApiError(e), loading: false });
        },
      );
    }, 200);
    return () => window.clearTimeout(h);
  }, [term, attempt]);
  return { ...state, on: term.length >= 2, retry: () => setAttempt((a) => a + 1) };
}

/** Why a search failed, with one fix. Signed out: sign in again. */
export function SearchFail({ error, onFix }: { error: ApiError; onFix: () => void }) {
  const auth = error.status === 401 || error.code === 'unauthorized';
  const offline = error.code === 'offline' || error.code === 'unreachable';
  const text = auth
    ? 'Sign in again, then search.'
    : offline
      ? `${copy.error.unreachable}. Check the connection.`
      : error.code === 'client'
        ? 'Something went wrong on this device. Try again.'
        : error.message;
  return (
    <Alert role="alert" variant="light" color={offline ? 'gray' : 'yellow'} title="Search did not load." icon={<IconAlertTriangle size={18} stroke={STROKE} />}>
      <Text size="sm">{text}</Text>
      <Button mt="sm" size="xs" variant="default" leftSection={<IconRefresh size={14} stroke={STROKE} />} onClick={() => (auth ? sessionLost() : onFix())}>
        {auth ? 'Sign in' : copy.error.retry}
      </Button>
    </Alert>
  );
}

const ROW_BORDER = '1px solid var(--mantine-color-default-border)';

/** List inside a flush Section: rows separated by hairlines, no nested cards. */
export function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <Box component="ul" m={0} p={0} aria-label={label} style={{ listStyle: 'none' }}>
      {children}
    </Box>
  );
}

/** One plain row (li) with a top hairline. */
export function Row({ children, px = 'md', py = 'sm' }: { children: ReactNode; px?: string; py?: string }) {
  return (
    <Box component="li" px={px} py={py} style={{ borderTop: ROW_BORDER }}>
      {children}
    </Box>
  );
}

type HitProps = {
  title: string;
  snippet?: string;
  query?: string;
  source?: string;
  when?: string;
  meta?: string;
  conflict?: boolean;
  selected?: boolean;
  onOpen: () => void;
  id?: string;
};

/** One search hit: title and snippet with the query marked, a source badge, when, and a value on the right. */
export const HitRow = forwardRef<HTMLButtonElement, HitProps>(function HitRow(
  { title, snippet, query, source, when, meta, conflict, selected, onOpen, id },
  ref,
) {
  return (
    <Box component="li" style={{ borderTop: ROW_BORDER }}>
      <UnstyledButton
        ref={ref}
        id={id}
        onClick={onOpen}
        aria-current={selected || undefined}
        w="100%"
        px="md"
        py="sm"
        style={{ display: 'block', background: selected ? 'var(--mantine-primary-color-light)' : undefined }}
      >
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text fw={600} size="sm" lineClamp={1}>
              <Highlight text={title} query={query} />
            </Text>
            {snippet && (
              <Text size="sm" c="dimmed" lineClamp={2}>
                <Highlight text={snippet} query={query} />
              </Text>
            )}
            {(source || when || conflict) && (
              <Group gap={6} mt={4}>
                {source && (
                  <Badge size="xs" variant="light" color="gray">
                    {source}
                  </Badge>
                )}
                {conflict && (
                  <Badge size="xs" variant="light" color="yellow">
                    Sync conflict
                  </Badge>
                )}
                {when && (
                  <Text size="xs" c="dimmed">
                    {when}
                  </Text>
                )}
              </Group>
            )}
          </Box>
          {meta && (
            <Text size="sm" className="num" style={{ flexShrink: 0 }}>
              {meta}
            </Text>
          )}
        </Group>
      </UnstyledButton>
    </Box>
  );
});

/** Read-only note beside a list on desktop. Focus moves to its heading when it opens. */
export function NoteReader({ path, onClose }: { path: string; onClose?: () => void }) {
  const note = useLoad(() => api.noteFile(path), true, [path]);
  useRefresh('notes', note.reload);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    head.current?.focus();
  }, [path]);
  const missing = note.error?.status === 404;
  return (
    <Stack gap="sm" aria-label="Note preview">
      <Group gap={6}>
        <Badge size="sm" variant="light" color="gray">
          {noteSource(path)}
        </Badge>
        {note.data && (
          <Text size="xs" c="dimmed">
            Changed {ago(note.data.mtime)}
          </Text>
        )}
      </Group>
      <Title order={2} size="h3" ref={head} tabIndex={-1} style={{ outline: 'none' }}>
        {noteTitle(path)}
      </Title>
      <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
        {path}
      </Text>
      <Group gap="xs">
        <Button size="xs" leftSection={<IconPencil size={14} stroke={STROKE} />} onClick={() => go(noteLink(path))}>
          Open to edit
        </Button>
        <Button size="xs" variant="default" component="a" href={obsidianHref(path)} leftSection={<IconExternalLink size={14} stroke={STROKE} />}>
          Open in Obsidian
        </Button>
        {onClose && (
          <Button size="xs" variant="subtle" color="gray" leftSection={<IconX size={14} stroke={STROKE} />} onClick={onClose}>
            Close
          </Button>
        )}
      </Group>
      {missing ? (
        <Empty title="This note does not exist yet.">Open it to add the first line.</Empty>
      ) : note.error && !note.data ? (
        <ErrorState error={note.error} onRetry={note.reload} />
      ) : !note.data ? (
        <Loading label="Loading note" lines={6} />
      ) : note.data.content.trim() ? (
        <Md src={note.data.content} lead />
      ) : (
        <Text size="sm" c="dimmed">
          This note is empty.
        </Text>
      )}
    </Stack>
  );
}

/** One text field and one button. `onSubmit` returns true to clear the field. */
export function LineForm({
  label,
  placeholder,
  button,
  onSubmit,
  maxLength,
  hideLabel,
  id,
}: {
  label: string;
  placeholder?: string;
  button: string;
  onSubmit: (text: string) => Promise<boolean>;
  maxLength?: number;
  hideLabel?: boolean;
  id?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t || busy) return;
        setBusy(true);
        try {
          if (await onSubmit(t)) setText('');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          id={id}
          data-draft
          style={{ flex: 1, minWidth: 0 }}
          label={hideLabel ? undefined : label}
          aria-label={hideLabel ? label : undefined}
          placeholder={placeholder}
          value={text}
          maxLength={maxLength}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <Button type="submit" loading={busy} disabled={!text.trim()}>
          {button}
        </Button>
      </Group>
    </form>
  );
}
