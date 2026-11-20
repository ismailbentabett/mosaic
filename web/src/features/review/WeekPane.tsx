import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { PLACE_ICON } from '../../app/icons';
import * as f from '../../fmt';
import { grades, type AreaGrade, type GradeFact, type WeekChange } from '../../grades';
import { act, useLoad, usePageActive } from '../../hooks';
import { emit, toast, useRefresh } from '../../store';
import { Async, Link, Section } from '../../ui/Page';
import { AreaRow } from './AreaRow';
import { Hint, parseNum, useAsk } from './kit';
import { QuietAreas } from './QuietAreas';
import { useWeekNav, WeekNav } from './weekNav';

/* ---------- Week facts + one change ---------- */

export function WeekPane() {
  const active = usePageActive();
  const nav = useWeekNav();
  const w = useLoad(() => grades.week(nav.week), active, [nav.week], { key: `grades-week:${nav.week ?? 'now'}` });
  useRefresh(['goals', 'tasks', 'habits', 'gym', 'food', 'money'], () => void w.reload());
  const [askNode, ask] = useAsk();

  const editChange = (week: string, c: WeekChange | null) =>
    ask({
      title: 'One change',
      label: 'The one change you will try next week',
      initial: c?.text ?? '',
      hint: 'One slot, one habit. Plain words.',
      save: 'Save',
      onSave: async (v) => {
        if (!v.trim()) {
          toast('Write the change, or close this');
          return false;
        }
        if ((await act(grades.setChange(week, v.trim()), 'Change saved')) === null) return false;
        void w.reload();
        return true;
      },
    });
  const acceptChange = async (week: string) => {
    if ((await act(grades.setChange(week), 'Change saved')) !== null) void w.reload();
  };

  const setTarget = (area: AreaGrade, fact: GradeFact) =>
    ask({
      title: 'Weekly target',
      label: `Weekly target for “${fact.label}”`,
      initial: String(fact.target),
      numeric: true,
      hint: fact.unit ? `In ${fact.unit}. Your own number; the count is shown next to it.` : 'Your own number; the count is shown next to it.',
      save: 'Save',
      onSave: async (v) => {
        const n = parseNum(v);
        if (n === null || n <= 0) {
          toast('Type a number above 0');
          return false;
        }
        const ok = await act(grades.setTarget(area.key, fact.key, n), 'Target saved');
        if (ok === null) return false;
        void w.reload();
        emit('goals');
        return true;
      },
    });

  return (
    <>
      {askNode}
      <Async state={w} lines={5}>
        {(d) => (
          <>
            <Section
              title="Week"
              icon={PLACE_ICON.review}
              right={
                <WeekNav
                  label={`${f.range(d.week_start, d.week_end)}${d.so_far ? ' · so far' : ''}`}
                  isCurrent={nav.isCurrent}
                  onShift={(n) => nav.shift(d.week_start, n)}
                />
              }
            >
              <Stack gap={6}>
                {d.facts.length === 0 ? (
                  <Text fw={600}>{d.line}</Text>
                ) : (
                  d.facts.map((x) => (
                    <Text key={x} fw={600} className="num">
                      {x}
                    </Text>
                  ))
                )}
                <Hint>
                  {f.plural(d.active_days, 'active day')} · Saturday rests
                  {d.day_rating_count > 0 ? ` · ${f.plural(d.day_rating_count, 'day')} rated` : ''}
                </Hint>
              </Stack>
            </Section>
            {d.change && (
              <Section title={d.change.accepted ? 'Your change' : 'One change'}>
                <Paper withBorder radius="md" p="sm">
                  <Text size="sm">{d.change.text}</Text>
                </Paper>
                <Group gap={6} mt="sm">
                  {!d.change.accepted && (
                    <Button size="compact-sm" onClick={() => void acceptChange(d.week_start)}>
                      Accept
                    </Button>
                  )}
                  <Button size="compact-sm" variant="subtle" onClick={() => editChange(d.week_start, d.change)}>
                    Edit
                  </Button>
                </Group>
              </Section>
            )}
            <Section title="Areas" hint="Tap one to see the inputs">
              <Stack gap={4}>
                {d.areas.map((a) => (
                  <AreaRow key={a.key} area={a} onTarget={(fact) => setTarget(a, fact)} />
                ))}
              </Stack>
              <Hint>Counts against your own weekly targets. Tap an area to see the inputs and change a target.</Hint>
            </Section>
            {nav.isCurrent && <QuietAreas active={active} />}
          </>
        )}
      </Async>
      <Section title="Savings what-if">
        <Text size="sm">
          See how a weekly amount moves a savings goal: <Link className="tap" to="/life/goals/whatif">Goals · What-if</Link>
        </Text>
      </Section>
    </>
  );
}
