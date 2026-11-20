import { Badge, Chip, Group, Stack, Text } from '@mantine/core';
import { IconCalendarOff } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { useLoad, usePageActive } from '../../hooks';
import { lifeYmd } from '../../time';
import { Async, Empty, Section } from '../../ui/Page';
import { reviewX, type ClosedDay } from './client';
import { addDaysYmd, Hint } from './kit';

/* ---------- Closed days ---------- */

const KIND_LABEL: Record<string, string> = { national: 'National', weekly: 'Weekend', extra: 'Extra' };

export function ClosedPane() {
  const active = usePageActive();
  const [weekends, setWeekends] = useState(false);
  const from = lifeYmd();
  const to = addDaysYmd(from, 60);
  const c = useLoad(() => reviewX.closedDays(from, to), active, [from], { key: `closed-days:${from}` });
  return (
    <Section
      title="Closed days, next 60"
      icon={IconCalendarOff}
      right={
        <Chip size="xs" checked={weekends} onChange={setWeekends}>
          Weekends
        </Chip>
      }
    >
      <Async state={c} lines={5}>
        {(days) => {
          const rows: ClosedDay[] = days
            .map((d) => ({ ...d, reasons: weekends ? d.reasons : d.reasons.filter((r) => r.kind !== 'weekly') }))
            .filter((d) => d.reasons.length > 0);
          return rows.length === 0 ? (
            <Empty title="No closed days ahead.">{weekends ? '' : 'Fridays and Saturdays are hidden.'}</Empty>
          ) : (
            <Stack gap="sm">
              {rows.map((d) => (
                <Group key={d.day} justify="space-between" wrap="nowrap" align="flex-start">
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600}>
                      {d.reasons.map((r) => r.name).join(' · ')}
                    </Text>
                    <Text size="xs" c="dimmed" className="num">
                      {f.dayFull(d.day)} · {f.until(d.day)}
                      {d.reasons.some((r) => r.shifted) ? ' · shifted' : ''}
                    </Text>
                  </Stack>
                  <Group gap={4} wrap="nowrap">
                    {Array.from(new Set(d.reasons.map((r) => r.kind))).map((k) => (
                      <Badge key={k} size="xs" variant="light" color="gray">
                        {KIND_LABEL[k] ?? k}
                      </Badge>
                    ))}
                    {d.estimate && (
                      <Badge size="xs" variant="outline" color="yellow">
                        estimate
                      </Badge>
                    )}
                  </Group>
                </Group>
              ))}
            </Stack>
          );
        }}
      </Async>
      <Hint>Some dates are estimates.</Hint>
    </Section>
  );
}
