import { Button, Group, Stack, Text } from '@mantine/core';
import { IconZzz } from '@tabler/icons-react';
import { useState } from 'react';
import { grades } from '../../grades';
import { act, useLoad } from '../../hooks';
import { emit } from '../../store';
import { Section } from '../../ui/Page';

export function QuietAreas({ active }: { active: boolean }) {
  const q = useLoad(() => grades.quiet(), active, [], { key: 'areas-quiet' });
  const [all, setAll] = useState(false);
  const [gone, setGone] = useState<string[]>([]);
  const start = async (key: string, option: string) => {
    if ((await act(grades.quietStart(key, option), 'Added to tasks')) !== null) {
      emit('tasks');
      setGone((g) => [...g, key]);
    }
  };
  const dismiss = async (key: string) => {
    if ((await act(grades.quietDismiss(key), 'Hidden for 4 weeks')) !== null) setGone((g) => [...g, key]);
  };
  const areas = (q.data?.areas ?? []).filter((a) => !gone.includes(a.key));
  if (areas.length === 0) return null;
  const shown = all ? areas : areas.slice(0, 2);
  return (
    <Section title="Quiet lately" icon={IconZzz}>
      <Stack gap="md">
        {shown.map((a) => (
          <Stack key={a.key} gap={6}>
            <Text fw={600}>{a.name}</Text>
            <Text size="sm" c="dimmed">
              {a.line}
            </Text>
            <Group gap={6}>
              {a.options.map((o) => (
                <Button key={o} size="compact-sm" variant="light" onClick={() => void start(a.key, o)}>
                  {o}
                </Button>
              ))}
              <Button size="compact-sm" variant="subtle" color="gray" onClick={() => void dismiss(a.key)}>
                Not now
              </Button>
            </Group>
          </Stack>
        ))}
        {areas.length > 2 && (
          <Group>
            <Button size="compact-sm" variant="subtle" onClick={() => setAll((v) => !v)}>
              {all ? 'Show 2' : `${areas.length - 2} more`}
            </Button>
          </Group>
        )}
      </Stack>
    </Section>
  );
}
