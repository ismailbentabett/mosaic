import { Group, Text } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import { lifeYmd } from '../../time';
import { IconBtn } from '../../ui/Page';
import { addDaysYmd } from './kit';

/* ---------- shared: week navigation ---------- */

/** undefined = the current week. A step into the future returns to the current week. */
export function useWeekNav() {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const today = lifeYmd();
  const shift = (from: string, n: number) => {
    const next = addDaysYmd(from, 7 * n);
    setWeek(addDaysYmd(next, 6) >= today || next > today ? undefined : next);
  };
  const pick = (weekStart: string) => setWeek(addDaysYmd(weekStart, 6) >= today ? undefined : weekStart);
  return { week, shift, pick, isCurrent: week === undefined };
}

export function WeekNav({ label, isCurrent, onShift }: { label: string; isCurrent: boolean; onShift: (n: number) => void }) {
  return (
    <Group gap={4} wrap="nowrap">
      <IconBtn icon={IconChevronLeft} label="Previous week" variant="subtle" size="md" onClick={() => onShift(-1)} />
      <Text size="sm" className="num" style={{ whiteSpace: 'nowrap' }}>
        {label}
      </Text>
      <IconBtn icon={IconChevronRight} label="Next week" variant="subtle" size="md" disabled={isCurrent} onClick={() => onShift(1)} />
    </Group>
  );
}
