import { Card, Collapse, Group, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { useState } from 'react';
import { type CalEvent } from '../../api';
import { DayTimeline } from '../calendar/Timeline';

export function TimelineSection({ events, now }: { events: CalEvent[]; now: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Card withBorder radius="lg" padding="sm">
      <UnstyledButton onClick={() => setOpen((o) => !o)} w="100%" aria-expanded={open}>
        <Group justify="space-between">
          <Text fw={600}>Day timeline</Text>
          <IconChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>
        <div style={{ marginTop: 8 }}>
          <DayTimeline events={events} now={now} compact emptyText="No events today." />
        </div>
      </Collapse>
    </Card>
  );
}
