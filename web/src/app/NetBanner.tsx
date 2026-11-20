import { ActionIcon, Anchor, Badge, Box, Button, Group, Indicator, Stack, Text, Tooltip } from '@mantine/core';
import { IconCloudOff, IconRefresh } from '@tabler/icons-react';
import { useState } from 'react';
import { copy } from '../copy';
import { num, plural, time } from '../fmt';
import { deadLetters, discardDead, retryDead, type OutboxItem } from '../outbox';
import { statusStore } from '../status';
import { net, useStore } from '../store';
import { openSettings } from '../ui';
import { Sheet } from '../ui/Sheet';
import { STROKE } from './icons';

/** One quiet line under the header while offline, unreachable, sending or holding refused writes. */
export function NetBanner() {
  const n = useStore(net);
  const waiting = n.queued + n.outbox;
  const unsent = n.deadLetters > 0 ? <UnsentLink count={n.deadLetters} /> : null;

  if (n.online && n.reachable) {
    if (waiting === 0 && !unsent) return null;
    return (
      <Bar tone="quiet">
        {waiting > 0 && <span>Sending {plural(waiting, 'saved change')}…</span>} {unsent}
      </Bar>
    );
  }
  const parts = [n.online ? `${copy.error.unreachable}. Changes will sync.` : copy.offline];
  if (n.cachedAt) parts.push(`Data from ${time(n.cachedAt)}.`);
  if (waiting > 0) parts.push(`${plural(waiting, 'change')} waiting.`);
  return (
    <Bar tone="warn">
      <IconCloudOff size={16} stroke={STROKE} style={{ flexShrink: 0 }} />
      <span>{parts.join(' ')}</span> {unsent}
    </Bar>
  );
}

function Bar({ tone, children }: { tone: 'quiet' | 'warn'; children: React.ReactNode }) {
  return (
    <Box
      role="status"
      px="md"
      py={6}
      style={{
        borderBottom: '1px solid var(--mantine-color-default-border)',
        background: tone === 'warn' ? 'var(--mantine-color-yellow-light)' : 'var(--app-surface)',
      }}
    >
      <Group gap={8} justify="center" wrap="nowrap">
        <Text size="xs" c={tone === 'warn' ? 'yellow.9' : 'dimmed'} component="div" style={{ display: 'flex', gap: 'var(--mantine-spacing-xs)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          {children}
        </Text>
      </Group>
    </Box>
  );
}

/** Writes the server refused for good. Each can be tried again or let go; nothing disappears on its own. */
function UnsentLink({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const load = () => void deadLetters().then(setItems);
  return (
    <>
      <Anchor
        component="button"
        type="button"
        size="xs"
        fw={600}
        onClick={() => {
          load();
          setOpen(true);
        }}
      >
        Unsent ({num(count)})
      </Anchor>
      <Sheet opened={open} onClose={() => setOpen(false)} title="Unsent">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            The server did not accept these. Try again after fixing the cause, or let one go.
          </Text>
          {items.length === 0 && (
            <Text size="sm" c="dimmed">
              Nothing left.
            </Text>
          )}
          {items.map((x) => (
            <Box key={x.id} p="sm" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-md)' }}>
              <Text size="sm" fw={600}>
                {x.label}
              </Text>
              {x.error && (
                <Text size="xs" c="dimmed" mt={2}>
                  {x.error}
                </Text>
              )}
              <Group gap="xs" mt="xs">
                <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void retryDead(x.id).then(load)}>
                  Try again
                </Button>
                <Button size="xs" variant="subtle" color="gray" onClick={() => void discardDead(x.id).then(load)}>
                  Let go
                </Button>
              </Group>
            </Box>
          ))}
        </Stack>
      </Sheet>
    </>
  );
}

/** Server health: a coloured dot; details in Settings › Status. */
export function StatusDot({ withLabel }: { withLabel?: boolean }) {
  const { data, error } = useStore(statusStore);
  let color = 'gray';
  let text = 'Checking status';
  let short = '…';
  if (data) {
    const bad = data.checks.find((c) => c.level !== 'ok' || !c.ok);
    color = data.overall === 'ok' ? 'teal' : data.overall === 'warn' ? 'yellow' : 'red';
    text = data.overall === 'ok' ? 'All systems good' : (bad?.label ?? 'Check status');
    short = data.overall === 'ok' ? 'OK' : 'Check';
  } else if (error) {
    color = 'red';
    text = error.code === 'offline' || error.code === 'unreachable' ? 'Server unreachable' : 'Status unknown';
    short = 'Check';
  }
  if (withLabel) {
    return (
      <Badge
        component="button"
        type="button"
        variant="light"
        color={color}
        leftSection={<Dot color={color} />}
        onClick={() => openSettings('status')}
        aria-label={`${text}. Open details.`}
        style={{ cursor: 'pointer' }}
      >
        {text}
      </Badge>
    );
  }
  return (
    <Tooltip label={text}>
      <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => openSettings('status')} aria-label={`${text}. Open details.`}>
        <Indicator color={color} size={9} position="middle-center" processing={!data && !error} zIndex={1}>
          <Box w={9} h={9} />
        </Indicator>
        <span className="sr-only">{short}</span>
      </ActionIcon>
    </Tooltip>
  );
}

function Dot({ color }: { color: string }) {
  return <Box w={8} h={8} style={{ borderRadius: 99, background: `var(--mantine-color-${color}-filled)` }} />;
}
