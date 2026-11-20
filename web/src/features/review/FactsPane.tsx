import { Group, Stack, Text } from '@mantine/core';
import * as f from '../../fmt';
import { useLoad, usePageActive } from '../../hooks';
import { life } from '../../life';
import { useRefresh } from '../../store';
import { Async, Section } from '../../ui/Page';
import { Hint } from './kit';
import { useWeekNav, WeekNav } from './weekNav';

/* ---------- Week facts ---------- */

export function FactsPane() {
  const active = usePageActive();
  const nav = useWeekNav();
  const w = useLoad(() => life.weekFacts(nav.week), active, [nav.week], { key: `week-facts:${nav.week ?? 'now'}` });
  useRefresh(['tasks', 'habits', 'gym', 'food', 'money'], () => void w.reload());
  return (
    <Async state={w} lines={6}>
      {(d) => {
        const rows: [string, string][] = [
          ['Tasks done', f.num(d.tasks_done)],
          ['Focus', f.minutes(d.focus_minutes)],
          ['Habit check-ins', f.num(d.habit_checks)],
          ['Workouts', f.num(d.gym_workouts)],
          ['Expenses logged', f.num(d.expenses)],
          ['Days with food logged', f.num(d.food_days_logged)],
          ['Personal spend', f.usd(d.spend_personal_usd, 0)],
          ['Promises kept', f.num(d.promises_kept)],
        ];
        return (
          <Section
            title={`Week of ${f.dayFull(d.week_start)}`}
            right={<WeekNav label={f.range(d.week_start, d.week_end)} isCurrent={nav.isCurrent} onShift={(n) => nav.shift(d.week_start, n)} />}
          >
            <Stack gap={6}>
              {rows.map(([label, v]) => (
                <Group key={label} justify="space-between" wrap="nowrap">
                  <Text size="sm">{label}</Text>
                  <Text size="sm" fw={600} className="num">
                    {v}
                  </Text>
                </Group>
              ))}
            </Stack>
            <Hint>Facts only. Nothing here is a score.</Hint>
          </Section>
        );
      }}
    </Async>
  );
}
