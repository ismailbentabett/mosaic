import { SegmentedControl, Stack, Text } from '@mantine/core';
import { IconListCheck } from '@tabler/icons-react';
import { useState } from 'react';
import { grades, type DoneRange } from '../../grades';
import { useLoad, usePageActive } from '../../hooks';
import { useRefresh } from '../../store';
import { Async, Empty, Section } from '../../ui/Page';
import { Hint } from './kit';

/* ---------- Done list ---------- */

const DONE_LABEL: Record<DoneRange, string> = { day: 'Done today', week: 'Done this week', month: 'Done this month' };

export function DonePane() {
  const active = usePageActive();
  const [range, setRange] = useState<DoneRange>('week');
  const list = useLoad(() => grades.doneLog(range), active, [range], { key: `done-log:${range}` });
  useRefresh(['tasks', 'gym', 'habits', 'food', 'money'], () => void list.reload());
  return (
    <>
      <SegmentedControl
        value={range}
        onChange={(v) => setRange(v as DoneRange)}
        data={[
          { value: 'day', label: 'Today' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
        aria-label="Done range"
        fullWidth
      />
      <Async state={list} lines={4}>
        {(d) => (
          <Section title={DONE_LABEL[d.range]} icon={IconListCheck}>
            <Text fw={600} mb="sm">
              {d.month_line}
            </Text>
            {d.entries.length === 0 ? (
              <Empty title="Nothing logged in this range.">That is fine. It means nothing.</Empty>
            ) : (
              <Stack gap={6}>
                {d.entries.map((e, i) => (
                  <Text key={`${e.day}-${i}`} size="sm">
                    {e.line}
                  </Text>
                ))}
              </Stack>
            )}
            <Hint>A record of what got done. Nothing here is a score.</Hint>
          </Section>
        )}
      </Async>
    </>
  );
}
