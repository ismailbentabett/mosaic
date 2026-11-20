// Today: one screen that answers "what now?".
// Top level: header (date, weather), the Now card, the priorities, one ambient line, a quiet "Bad day?" link.
// Everything else (habits, timeline, needs-you, glance) sits under "More of today", closed by default.
// All clock logic goes through time.ts.
import { Button, Card, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconLifebuoy } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type Timer } from '../../api';
import { PLACE_ICON } from '../../app/icons';
import { act, useLoad, useNow, usePageActive } from '../../hooks';
import { go } from '../../router';
import { emit, useRefresh } from '../../store';
import { localMinutes } from '../../time';
import { ErrorState, Loading, Page, Section } from '../../ui/Page';
import { v2, type Habit, type V2Task } from '../../v2';
import { isMust } from '../tasks/TaskEditor';
import { CloseDay } from './CloseDay';
import { DayRating } from './DayRating';
import { Glance } from './Glance';
import { HabitsRow } from './HabitsRow';
import { Ambient, Header } from './Header';
import { MustRow } from './MustRow';
import { NeedsYou } from './NeedsYou';
import { NowCard } from './NowCard';
import { ReEntry } from './ReEntry';
import { RescuePanel } from './RescuePanel';
import { TimelineSection } from './TimelineSection';
import { DAY_START, EVENING_FROM, same } from './util';

const MORE_KEY = 'today.more';

function readMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeMore(open: boolean) {
  try {
    localStorage.setItem(MORE_KEY, open ? '1' : '0');
  } catch {
    /* storage blocked: the disclosure still works for this visit */
  }
}

export function Today() {
  const active = usePageActive();
  const snap = useLoad(() => v2.life(), active, [], { key: 'life' });
  const day = useLoad(() => api.today(), active, [], { key: 'today' });
  const musts = useLoad(() => v2.tasks('today'), active, [], { key: 'today-tasks' });
  const reloadAll = useCallback(() => {
    snap.reload();
    day.reload();
    musts.reload();
  }, [snap, day, musts]);
  useRefresh(['tasks', 'money', 'food', 'gym', 'body', 'habits', 'goals', 'blocks'], reloadAll);

  const now = useNow(active, 30_000);
  const [timer, setTimer] = useState<Timer | null | undefined>(undefined);
  useEffect(() => setTimer(undefined), [day.data]);
  const t = timer === undefined ? (day.data?.timer ?? null) : timer;
  const [more, setMore] = useState(readMore);
  const toggleMore = () => setMore((o) => (writeMore(!o), !o));

  if (snap.loading && !snap.data) return <Page title="Today"><Loading /></Page>;
  if (snap.error && !snap.data) return <Page title="Today"><ErrorState error={snap.error} onRetry={snap.reload} /></Page>;
  const s = snap.data!;
  const events = day.data?.events ?? [];
  const mins = localMinutes(now);
  const evening = mins >= EVENING_FROM || mins < DAY_START;
  const what = s.tasks?.what_now ?? null;
  const taskList: V2Task[] = Array.isArray(musts.data) ? musts.data : ((musts.data as { tasks?: V2Task[] } | null)?.tasks ?? []);
  // priorities exclude the task already on the Now card.
  const mustTasks = taskList.filter(isMust).filter((m) => m.id !== what?.task.id).slice(0, 3);
  // First thing (from last night) only when it is not already the Now task or a priority.
  const firstThing = s.first_thing && !same(s.first_thing, what?.task.title) && !mustTasks.some((m) => same(m.title, s.first_thing)) ? s.first_thing : null;
  const away = s.days_away && !('error' in s.days_away) && s.days_away.days >= 2 ? s.days_away : null;
  const startRescue = async () => {
    const r = await act(v2.rescue(), 'Small day on. Back to normal at 04:00.');
    if (r) {
      emit('blocks');
      reloadAll();
    }
  };

  return (
    <Page title="Today" bare>
      <Stack gap="lg">
        <Header mode={s.mode} timer={t} active={active} rescue={!!s.rescue} onRescue={() => void startRescue()} />
        {away && !t && <ReEntry lastAt={away.last_at} now={now} what={what} onTimer={setTimer} />}
        {firstThing && (
          <Card withBorder radius="lg" padding="sm">
            <Text size="xs" c="dimmed" tt="uppercase" fw={650}>First thing (from last night)</Text>
            <Text fw={600}>{firstThing}</Text>
          </Card>
        )}
        <NowCard mode={s.mode} events={events} now={now} timer={t} active={active} what={what} onTimer={setTimer} onChange={reloadAll} />
        {s.rescue && <RescuePanel active={active} onEnd={reloadAll} />}
        <Section title="Priorities" hint="Max 3" icon={PLACE_ICON.tasks} right={<Button size="sm" variant="subtle" onClick={() => go('/tasks')}>All tasks</Button>}>
          {mustTasks.length === 0 ? (
            <Text size="sm" c="dimmed">{what && taskList.some((m) => m.id === what.task.id && isMust(m)) ? 'The priority for now is on the card above.' : 'No priorities set for today.'}</Text>
          ) : (
            <Stack gap={6}>
              {mustTasks.map((m) => <MustRow key={m.id} task={m} onChange={reloadAll} />)}
            </Stack>
          )}
        </Section>
        <Ambient s={s} events={events} now={now} />
        {!s.rescue && s.mode !== 'Zero' && (
          <Button variant="subtle" color="gray" size="sm" leftSection={<IconLifebuoy size={16} />} style={{ alignSelf: 'flex-start' }} onClick={() => void startRescue()}>
            Bad day?
          </Button>
        )}
        {evening && <DayRating />}
        {evening && <CloseDay closed={!!s.closed} message={s.closed?.message ?? null} onDone={reloadAll} />}
        <Card withBorder radius="lg" padding="sm">
          <UnstyledButton onClick={toggleMore} w="100%" className="tap" aria-expanded={more} aria-controls="today-more">
            <Group justify="space-between">
              <Text fw={600}>More of today</Text>
              <IconChevronDown size={18} style={{ transform: more ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
            </Group>
          </UnstyledButton>
          <Collapse expanded={more}>
            <Stack gap="lg" mt="md" id="today-more">
              <HabitsRow habits={(s.habits as unknown as Habit[]) ?? []} onChange={() => emit('habits')} />
              <TimelineSection events={events} now={now} />
              <NeedsYou active={active && more} />
              <Glance s={s} />
              {s.note && <Text size="sm" c="dimmed">{s.note}</Text>}
            </Stack>
          </Collapse>
        </Card>
      </Stack>
    </Page>
  );
}

export default Today;
