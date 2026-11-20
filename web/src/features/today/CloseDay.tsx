import { Button, Card, Group, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { act, useLoad } from '../../hooks';
import { feel } from '../../sound';
import { Section } from '../../ui/Page';
import { v2 } from '../../v2';

export function CloseDay({ closed, message, onDone }: { closed: boolean; message: string | null; onDone: () => void }) {
  const st = useLoad(() => v2.closeDayState(), true, [], { key: 'close-day' });
  const [first, setFirst] = useState('');
  useEffect(() => setFirst(st.data?.tomorrow_first ?? ''), [st.data?.tomorrow_first]);
  if (closed || st.data?.closed) {
    return <Card withBorder radius="lg" padding="sm"><Text fw={600}>Day closed.</Text>{message && <Text size="sm" c="dimmed">{message}</Text>}</Card>;
  }
  // The first thing for tomorrow is optional: an empty box still closes the day.
  const close = async () => {
    if (await act(v2.closeDay(first.trim()), 'Day closed.')) {
      feel('done');
      onDone();
    }
  };
  return (
    <Section title="Close the day">
      <Group wrap="nowrap" gap="xs">
        <TextInput style={{ flex: 1 }} placeholder="First thing tomorrow (optional)" value={first} onChange={(e) => setFirst(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void close()} />
        <Button onClick={() => void close()}>Close day</Button>
      </Group>
    </Section>
  );
}
