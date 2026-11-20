import { Alert, Button, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconPencilPlus, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, type ChatSummary } from '../../../api';
import { STROKE } from '../../../app/icons';
import { ago } from '../../../fmt';
import { go } from '../../../router';
import { useStore } from '../../../store';
import { lifeYmd } from '../../../time';
import { useLoad } from '../../../ui/data';
import { Empty, Loading, Page } from '../../../ui/Page';
import { chat, loadChat, newChat } from '../chat';
import { ASK } from './paths';

// ---------- history ----------

export function useChats() {
  const st = useStore(chat);
  const running = !!st.live;
  // Reload when the open chat changes or a reply finishes (titles and order change).
  return useLoad(async () => (await api.chats()).chats, true, [st.chatId, running], { key: 'ask-chats' });
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

/** Today · Yesterday · Previous 7 days · Older, newest first. */
function groupChats(chats: ChatSummary[]) {
  const today = lifeYmd();
  const groups: { label: string; items: ChatSummary[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ];
  for (const c of chats) {
    const n = daysBetween(lifeYmd(c.updatedAt), today);
    groups[n <= 0 ? 0 : n === 1 ? 1 : n <= 7 ? 2 : 3]!.items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}

function ChatList({ onPicked, filter = '' }: { onPicked?: () => void; filter?: string }) {
  const st = useStore(chat);
  const { data, error, loading, reload } = useChats();
  const running = !!st.live;
  const q = filter.trim().toLowerCase();
  const groups = useMemo(() => groupChats((data ?? []).filter((c) => !q || c.title.toLowerCase().includes(q))), [data, q]);
  if (loading && !data) return <Loading label="Loading chats" lines={5} />;
  if (error && !data)
    return (
      <Alert color="gray" variant="light" role="alert">
        <Stack gap="xs" align="flex-start">
          <Text size="sm">Could not load your chats.</Text>
          <Button size="compact-sm" variant="subtle" leftSection={<IconRefresh size={14} stroke={STROKE} />} onClick={() => void reload()}>
            Retry
          </Button>
        </Stack>
      </Alert>
    );
  if (!data || data.length === 0) return <Empty title="No chats yet." />;
  if (groups.length === 0)
    return (
      <Text size="sm" c="dimmed" px="xs" py="sm">
        No chat matches “{filter.trim()}”.
      </Text>
    );
  return (
    <nav aria-label="Chats">
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <div className="ck-group-label" aria-hidden="true">
            {g.label}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {g.items.map((c) => {
              const current = c.id === st.chatId;
              return (
                <li key={c.id}>
                  <UnstyledButton
                    className="ck-chat-row"
                    aria-current={current ? 'true' : undefined}
                    disabled={running}
                    onClick={() => {
                      chat.set({ problem: null });
                      if (!current) void loadChat(c.id);
                      onPicked?.();
                    }}
                  >
                    <span className="ck-chat-title">{c.title}</span>
                    <span className="ck-chat-meta">{ago(c.updatedAt)}</span>
                  </UnstyledButton>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** Desktop rail: New chat, a filter once there are many chats, the grouped list. */
export function Rail({ busy, onNew }: { busy: boolean; onNew: () => void }) {
  const { data } = useChats();
  const [filter, setFilter] = useState('');
  return (
    <aside className="ck-rail" aria-label="Chat history">
      <Button fullWidth variant="default" radius="md" justify="flex-start" leftSection={<IconPencilPlus size={18} stroke={STROKE} />} disabled={busy} onClick={onNew}>
        New chat
      </Button>
      {(data?.length ?? 0) > 6 && (
        <TextInput
          size="sm"
          radius="md"
          aria-label="Search chats"
          placeholder="Search chats"
          leftSection={<IconSearch size={16} stroke={STROKE} />}
          enterKeyHint="search"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
      )}
      <div className="ck-rail-list">
        <ChatList filter={filter} />
      </div>
    </aside>
  );
}

/** Phones: history is its own view. Desktop shows it beside the chat, so this view returns there. */
export function HistoryView() {
  const desktop = useMediaQuery('(min-width: 64em)');
  const st = useStore(chat);
  const busy = !!st.live || st.sending;
  const [filter, setFilter] = useState('');
  if (desktop) return <Navigate to={ASK} replace />;
  return (
    <Page
      title="Chats"
      back={ASK}
      actions={
        <Button
          size="compact-md"
          variant="light"
          leftSection={<IconPlus size={16} stroke={STROKE} />}
          disabled={busy}
          onClick={() => {
            if (newChat()) go(ASK);
          }}
        >
          New chat
        </Button>
      }
    >
      <Stack gap="xs">
        <TextInput
          radius="md"
          aria-label="Search chats"
          placeholder="Search chats"
          leftSection={<IconSearch size={16} stroke={STROKE} />}
          enterKeyHint="search"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
        <ChatList filter={filter} onPicked={() => go(ASK)} />
      </Stack>
    </Page>
  );
}
