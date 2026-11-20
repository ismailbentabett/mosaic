// Life hub: one card per module. Each card shows one plain line of what was done, no due badges or
// to-go counts (critique #37). Loads the life snapshot first (one quick call), then the module extras in
// parallel; any extra that fails just leaves its card on the snapshot line. The subtitle is this month's done line.
import { Badge, Card, Group, SimpleGrid, Skeleton, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { LIFE } from '../../app/navItems';
import { PLACE_ICON, STROKE, type AppIcon } from '../../app/icons';
import * as f from '../../fmt';
import { grades, type DoneLog, type GoalTree, type WeekGrades } from '../../grades';
import { useLoad, usePageActive } from '../../hooks';
import { life, type HabitatToday, type LastDone, type PersonDue } from '../../life';
import { useRefresh } from '../../store';
import { lifeYmd } from '../../time';
import { ErrorState, Page } from '../../ui/Page';
import { v2, type LifeSnapshot } from '../../v2';
import { Blur } from '../money/blur';
import { moneySummaryLine } from '../money/summary';

type Extras = {
  habitat: HabitatToday | null;
  people: PersonDue[] | null;
  week: WeekGrades | null;
  goals: GoalTree | null;
  lastDone: LastDone[] | null;
  done: DoneLog | null;
};

const safe = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export function LifeHub() {
  const active = usePageActive();
  const today = lifeYmd();
  const snap = useLoad(() => v2.life(), active, [today], { key: `life.${today}` });
  const extras = useLoad<Extras>(
    async () => {
      const [habitat, people, week, goals, lastDone, done] = await Promise.all([
        safe(life.habitat()),
        safe(life.peopleDue()),
        safe(grades.week()),
        safe(grades.tree()),
        safe(life.lastDone()),
        safe(grades.doneLog('week')),
      ]);
      return { habitat, people, week, goals, lastDone, done };
    },
    active,
    [today],
    { key: `life.extras.${today}` },
  );
  useRefresh(['money', 'food', 'gym', 'body', 'habits', 'goals', 'tasks', 'car'], () => {
    void snap.reload();
    void extras.reload();
  });

  if (snap.error && !snap.data) {
    return (
      <Page title="Life" icon={LIFE_ICON}>
        <ErrorState error={snap.error} onRetry={() => void snap.reload()} />
      </Page>
    );
  }

  const s = snap.data;
  const x = extras.data;
  const cards = s ? buildCards(s, x) : null;

  return (
    <Page title="Life" subtitle={x?.done?.month_line || undefined} icon={LIFE_ICON}>
      <SimpleGrid cols={{ base: 2, md: 3, xl: 4 }} spacing="sm" verticalSpacing="sm">
        {LIFE.map((n) => {
          const c = cards?.[n.id];
          return (
            <ModuleCard key={n.id} to={n.path} icon={n.icon} label={n.label} loading={!s} badge={c?.badge} tone={c?.tone}>
              {c?.line ?? <Text size="xs" c="dimmed">Open {n.label.toLowerCase()}</Text>}
            </ModuleCard>
          );
        })}
      </SimpleGrid>
    </Page>
  );
}

const LIFE_ICON = PLACE_ICON.life;

type CardInfo = { line: ReactNode; badge?: string | null; tone?: 'due' | 'live' | 'warn' };

/** One plain line per module from the snapshot plus whatever extras loaded. Badges only for live state. */
function buildCards(s: LifeSnapshot, x: Extras | null): Record<string, CardInfo> {
  const out: Record<string, CardInfo> = {};

  // Money: free to spend this week, else spend + runway.
  const fts = x?.habitat?.free_to_spend;
  const runway = s.money?.runway;
  out.money = {
    line:
      fts && fts.free !== null ? (
        <Line>
          <Blur inline>
            <b className="num">{f.money(fts.free, fts.currency ?? 'USD')}</b>
          </Blur>{' '}
          free to spend{fts.estimate ? ' (estimate)' : ''}
        </Line>
      ) : (
        <Line>{moneySummaryLine(s.money) || 'No records this week'}</Line>
      ),
    badge: runway?.under_8_weeks ? 'Runway' : null,
    tone: runway?.under_8_weeks ? 'warn' : undefined,
  };

  // Food: kcal left against target, water.
  const eaten = s.food?.total?.kcal ?? 0;
  const water = s.food?.water_ml ?? 0;
  out.food = {
    line: (
      <Line>
        <b className="num">{f.kcal(eaten)}</b> logged today
        <Dim> · {f.ml(water)} water</Dim>
      </Line>
    ),
  };

  // Gym: live workout, rest timer, or last session.
  const g = s.gym;
  if (g?.active) {
    out.gym = { line: <Line>{g.active.name} · <b className="num">{f.plural(g.active.working_sets, 'set')}</b></Line>, badge: 'Live', tone: 'live' };
  } else {
    out.gym = {
      line: (
        <Line>
          <b className="num">{f.plural(g?.workouts_7d ?? 0, 'session')}</b> this week
          {g?.last ? <Dim> · last {f.day(g.last.day)}</Dim> : null}
        </Line>
      ),
    };
  }

  // Body: last weight and 7-day change.
  const b = s.body;
  out.body = {
    line: b?.last_weight ? (
      <Line>
        <b className="num">{f.kg(b.last_weight.kg)}</b>
        {b.change_7d !== null && <Dim> · {f.kgSigned(b.change_7d)} in 7d</Dim>}
      </Line>
    ) : (
      <Line>No weigh-in yet</Line>
    ),
  };

  // Habits: done today out of active.
  const habits = (s.habits ?? []).filter((h) => !h.archived);
  const doneToday = habits.filter((h) => h.today > 0).length;
  out.habits = {
    line: habits.length ? (
      <Line>
        <b className="num">{f.plural(doneToday, 'habit')}</b> done today
      </Line>
    ) : (
      <Line>No habits yet</Line>
    ),
  };

  // People: who is due a call.
  const due = x?.people ?? [];
  out.people = {
    line: due.length ? <Line>Next to call: {due.slice(0, 2).map((p) => p.name).join(', ')}</Line> : <Line>Family and friends</Line>,
  };

  // Goals: next milestone / next step.
  const nextUp = x?.goals?.next_up;
  const activeGoals = x?.goals?.count ?? (s.goals ?? []).filter((g2) => g2.status === 'active').length;
  out.goals = {
    line: nextUp ? (
      <Line>
        {nextUp.goal}: <Dim>{nextUp.next}</Dim>
      </Line>
    ) : (
      <Line>{activeGoals ? f.plural(activeGoals, 'active goal') : 'No goals yet'}</Line>
    ),
  };

  // Review: this week's plain facts; the Done log lives inside Review.
  const w = x?.week;
  out.review = {
    line: <Line>{w?.facts.length ? w.facts.slice(0, 2).join(', ') : 'Week facts and the done log'}</Line>,
  };

  // Home: chores past their usual gap, lent things.
  const overdue = (x?.lastDone ?? []).filter((l) => l.line && l.days_since !== null).sort((a, b2) => (b2.days_since ?? 0) - (a.days_since ?? 0));
  const lent = x?.habitat?.lent_open;
  out.home = {
    line: overdue[0] ? (
      <Line>
        {overdue[0].name}
        <Dim> · {f.plural(overdue[0].days_since ?? 0, 'day')} ago</Dim>
      </Line>
    ) : lent?.count ? (
      <Line>{f.plural(lent.count, 'item')} lent or borrowed</Line>
    ) : (
      <Line>Chores and things</Line>
    ),
  };

  // Car: km and what is next; without a car, the fund and watched listings.
  const c = s.car;
  if (c?.car) {
    out.car = {
      line: (
        <Line>
          {c.km != null ? <b className="num">{f.num(c.km)} km</b> : c.car}
          {c.next ? <Dim> · {c.next}</Dim> : null}
        </Line>
      ),
    };
  } else if (c) {
    out.car = {
      line: (
        <Line>
          {c.fund?.progress != null ? `Car fund ${f.pct(c.fund.progress)}` : 'Next car'}
          {c.listings ? <Dim> · {f.plural(c.listings, 'listing')} watched</Dim> : null}
        </Line>
      ),
    };
  }

  return out;
}

function Line({ children }: { children: ReactNode }) {
  return (
    <Text fz={{ base: 'xs', sm: 'sm' }} lineClamp={2}>
      {children}
    </Text>
  );
}

function Dim({ children }: { children: ReactNode }) {
  return (
    <Text span c="dimmed" inherit>
      {children}
    </Text>
  );
}

const TONE_COLOR = { due: 'brand', live: 'signal', warn: 'yellow' } as const;

function ModuleCard({
  to,
  icon: Icon,
  label,
  children,
  badge,
  tone = 'due',
  loading,
}: {
  to: string;
  icon: AppIcon;
  label: string;
  children: ReactNode;
  badge?: string | null;
  tone?: CardInfo['tone'];
  loading?: boolean;
}) {
  return (
    <UnstyledButton component={RouterLink} to={to} aria-label={label} className="hub-card" h="100%">
      <Card withBorder radius="lg" padding="sm" h="100%">
        <Stack gap={8}>
          {/* Icon and status on top, name and line under it: fits two columns on a phone. */}
          <Group justify="space-between" wrap="nowrap" gap={6}>
            <ThemeIcon variant="light" radius="md" size={34} style={{ flexShrink: 0 }}>
              <Icon size={19} stroke={STROKE} />
            </ThemeIcon>
            {badge ? (
              <Badge size="sm" variant="light" color={TONE_COLOR[tone]} style={{ flexShrink: 1, minWidth: 0 }}>
                {badge}
              </Badge>
            ) : (
              <IconChevronRight size={16} stroke={STROKE} style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
            )}
          </Group>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={600} truncate>
              {label}
            </Text>
            {loading ? <Skeleton height={12} width="70%" radius="sm" /> : children}
          </Stack>
        </Stack>
      </Card>
    </UnstyledButton>
  );
}
