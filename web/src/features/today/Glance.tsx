import { Badge, Button, Card, Group, SimpleGrid, Text, UnstyledButton } from '@mantine/core';
import { IconDroplet, IconPlus } from '@tabler/icons-react';
import { PLACE_ICON, STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { act } from '../../hooks';
import { go } from '../../router';
import { emit } from '../../store';
import { Section } from '../../ui/Page';
import { v2 } from '../../v2';
import { Blur } from '../money/blur';

// ---------------------------------------------------------------- glance

export function GlanceCard({ label, icon: Icon, value, sub, to, warn, children }: { label: string; icon: typeof IconPlus; value: React.ReactNode; sub?: React.ReactNode; to: string; warn?: boolean; children?: React.ReactNode }) {
  return (
    <Card withBorder radius="lg" padding="sm">
      <UnstyledButton onClick={() => go(to)} w="100%">
        <Group gap={6} mb={4}>
          <Icon size={16} stroke={STROKE} />
          <Text size="xs" c="dimmed" tt="uppercase" fw={650}>{label}</Text>
          {warn && <Badge size="xs" color="yellow" variant="light">check</Badge>}
        </Group>
        <Text fw={650} size="lg" className="num">{value}</Text>
        {sub && <Text size="xs" c="dimmed">{sub}</Text>}
      </UnstyledButton>
      {children}
    </Card>
  );
}

export function Glance({ s }: { s: NonNullable<Awaited<ReturnType<typeof v2.life>>> }) {
  const c = s.tasks.counts;
  const food = s.food;
  const left = food.target ? Math.round(food.target.kcal - food.total.kcal) : null;
  const water = async () => {
    if (await act(v2.water(250), '+250 ml water')) emit('food');
  };
  return (
    <Section title="At a glance">
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
        <GlanceCard label="Tasks" icon={PLACE_ICON.tasks} to="/tasks" value={`${c.today} today`} sub={`${c.inbox} in Inbox · ${c.waiting} waiting`} />
        <GlanceCard label="Money" icon={PLACE_ICON.money} to="/life/money" warn={s.money.runway?.under_8_weeks} value={<Blur inline>{f.usd(s.money.week.spend_usd)}</Blur>} sub={s.money.runway?.runway_weeks != null ? `Runway ${Math.round(s.money.runway.runway_weeks)} weeks` : 'spent this week'} />
        <GlanceCard label="Food" icon={PLACE_ICON.food} to="/life/food" value={left !== null ? `${f.num(left)} kcal left` : `${f.num(Math.round(food.total.kcal))} kcal`} sub={`Water ${f.num(food.water_ml)} ml`}>
          <Button size="compact-sm" variant="light" mt={6} leftSection={<IconDroplet size={14} />} onClick={() => void water()}>+250 ml</Button>
        </GlanceCard>
        <GlanceCard label="Gym" icon={PLACE_ICON.gym} to="/life/gym" value={s.gym.active ? 'Workout running' : s.gym.rest ? 'Rest day' : `${s.gym.workouts_7d} this week`} sub={s.gym.last ? `Last: ${s.gym.last.name}` : undefined} />
        <GlanceCard label="Body" icon={PLACE_ICON.body} to="/life/body" value={s.body.last_weight ? `${s.body.last_weight.kg} kg` : '—'} sub={s.body.change_7d != null ? `${s.body.change_7d > 0 ? '+' : ''}${s.body.change_7d} kg in 7 days` : undefined} />
        <GlanceCard label="Goals" icon={PLACE_ICON.goals} to="/life/goals" value={`${(s.goals as unknown[]).length} active`} />
      </SimpleGrid>
    </Section>
  );
}
