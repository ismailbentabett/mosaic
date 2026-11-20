import { BarChart } from '@mantine/charts';
import '@mantine/charts/styles.css';
import { Group, Progress, Stack, Text } from '@mantine/core';
import { ChartText } from '../../ui/ChartText';
import * as f from '../../fmt';
import { grades, type WeekGrades } from '../../grades';
import { useLoad, usePageActive } from '../../hooks';
import { useRefresh } from '../../store';
import { Async, Section } from '../../ui/Page';
import { DayRateCard } from './DayRate';
import { Hint } from './kit';

/* ---------- Day ratings + patterns ---------- */

export function DaysPane() {
  const active = usePageActive();
  const w = useLoad(() => grades.week(), active, [], { key: 'grades-week:now' });
  const p = useLoad(() => grades.patterns(), active, [], { key: 'rating-patterns' });
  useRefresh('goals', () => {
    void w.reload();
    void p.reload();
  });
  return (
    <>
      <DayRateCard active={active} />
      <Async state={w} lines={3}>
        {(d) => <RatingsChart d={d} />}
      </Async>
      <Async state={p} lines={3}>
        {(d) => (
          <Section title="Good days vs hard days">
            {d.patterns.length === 0 ? (
              <Text size="sm" c="dimmed">
                {d.line} <span className="num">{f.num(d.days)}</span> of <span className="num">{f.num(d.needed)}</span> rated days.
              </Text>
            ) : (
              <Stack gap="md">
                {d.line && <Text size="sm">{d.line}</Text>}
                {d.patterns.map((x) => (
                  <Stack key={x.key} gap={4}>
                    <Text size="sm">{x.line}</Text>
                    <Group gap={6} wrap="nowrap">
                      <Text size="xs" c="dimmed" w={40}>
                        Good
                      </Text>
                      <Progress value={x.good_share * 100} size="sm" radius="xl" color="teal" style={{ flex: 1 }} aria-label={`Good days ${f.pct(x.good_share)}`} />
                      <Text size="xs" className="num" w={40} ta="right">
                        {f.pct(x.good_share)}
                      </Text>
                    </Group>
                    <Group gap={6} wrap="nowrap">
                      <Text size="xs" c="dimmed" w={40}>
                        Hard
                      </Text>
                      <Progress value={x.hard_share * 100} size="sm" radius="xl" color="gray" style={{ flex: 1 }} aria-label={`Hard days ${f.pct(x.hard_share)}`} />
                      <Text size="xs" className="num" w={40} ta="right">
                        {f.pct(x.hard_share)}
                      </Text>
                    </Group>
                  </Stack>
                ))}
              </Stack>
            )}
            <Hint>Shows what tends to appear together. It does not claim a cause.</Hint>
          </Section>
        )}
      </Async>
    </>
  );
}

function RatingsChart({ d }: { d: WeekGrades }) {
  if (d.day_ratings.length === 0) return null;
  const data = d.day_ratings.map((r) => ({ day: f.day(r.day), rating: r.rating }));
  return (
    <Section title="This week, how days felt" hint={d.day_rating_avg !== null ? `avg ${f.fixed(d.day_rating_avg, 1)}/5` : undefined}>
      <BarChart
        h={120}
        data={data}
        dataKey="day"
        series={[{ name: 'rating', label: 'Rating', color: 'blue.6' }]}
        yAxisProps={{ domain: [0, 5] }}
        withYAxis={false}
        gridAxis="none"
        tickLine="none"
        aria-label="Day ratings this week"
        role="img"
      />
      <ChartText label="Day ratings" rows={data.map((r) => `${r.day}: ${r.rating} of 5`)} />
    </Section>
  );
}
