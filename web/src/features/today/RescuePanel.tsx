import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { api } from '../../api';
import { act, useLoad } from '../../hooks';
import { emit } from '../../store';
import { v2 } from '../../v2';

// ---------------------------------------------------------------- end of day

/** Rescue (Zero for one life-day). Ends at 04:00 by itself unless kept. */
export function RescuePanel({ active, onEnd }: { active: boolean; onEnd: () => void }) {
  const items = useLoad(() => v2.badDay(), active, [], { key: 'badday' });
  const m = useLoad(() => api.mode(), active, [], { key: 'mode' });
  const info = m.data?.rescue ?? null;
  const kept = !!m.data && !info;
  const keep = async () => {
    if (await act(v2.keepRescue(), 'Kept. Zero stays until you end it.')) m.reload();
  };
  return (
    <Card withBorder radius="lg" padding="md" bg="var(--mantine-color-orange-light)">
      <Text fw={650}>Small day</Text>
      <Text size="sm" c="dimmed" mb={6}>
        Only these count today. {kept ? 'Kept: stays until you end it.' : `Ends at 04:00${info?.after ? `, back to ${info.after}` : ''}.`}
      </Text>
      <Stack gap={4}>{(items.data?.items ?? []).map((i) => <Text key={i} size="sm">• {i}</Text>)}</Stack>
      <Group gap="xs" mt="sm">
        {!kept && <Button size="compact-sm" variant="subtle" onClick={() => void keep()}>Keep tomorrow too</Button>}
        <Button size="compact-sm" variant="subtle" color="gray" onClick={() => void act(v2.endRescue(), 'Back to normal').then(() => { emit('blocks'); onEnd(); })}>End small day</Button>
      </Group>
    </Card>
  );
}
