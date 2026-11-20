import { Alert, Box, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useState } from 'react';
import { type ChatFile } from '../../../api';
import { STROKE } from '../../../app/icons';
import { copy } from '../../../copy';
import { useStore } from '../../../store';
import { chat, loadChat } from '../chat';

/** Inline problem under the last message: what failed, Details, Retry, Reload chat. */
export function ProblemBlock({ busy, onRetry }: { busy: boolean; onRetry: (text: string, files?: ChatFile[]) => void }) {
  const st = useStore(chat);
  const [details, setDetails] = useState(false);
  const p = st.problem;
  if (!p) return null;
  return (
    <Alert color={p.tone === 'warn' ? 'yellow' : 'gray'} variant="light" radius="lg" mt="md" role={p.tone === 'warn' ? 'alert' : 'status'}>
      <Stack gap="xs">
        <Text size="sm">{p.text}</Text>
        {p.detail && (
          <Box>
            <UnstyledButton onClick={() => setDetails((v) => !v)} aria-expanded={details}>
              <Text size="xs" c="dimmed" td="underline">
                {copy.error.details}
              </Text>
            </UnstyledButton>
            {details && (
              <Text size="xs" c="dimmed" mt={4} style={{ overflowWrap: 'anywhere' }}>
                {p.detail}
              </Text>
            )}
          </Box>
        )}
        <Group gap="xs">
          {p.retry && (
            <Button size="compact-sm" variant="light" leftSection={<IconRefresh size={14} stroke={STROKE} />} disabled={busy} onClick={() => onRetry(p.retry!, p.retryFiles)}>
              Retry
            </Button>
          )}
          {p.reload && st.chatId && (
            <Button size="compact-sm" variant="subtle" leftSection={<IconRefresh size={14} stroke={STROKE} />} onClick={() => void loadChat(st.chatId!)}>
              Reload chat
            </Button>
          )}
        </Group>
      </Stack>
    </Alert>
  );
}
