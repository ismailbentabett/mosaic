// /calendar: read-only blocks from Google Calendar. Day view (index) = now/next, timer, priorities, strip and timeline.
// Week view (/calendar/week) = 7 api.today(date) calls, one compact timeline per day. Date in ?date=YYYY-MM-DD.
import { ActionIcon, Badge, Button, Grid, Group, SegmentedControl, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronLeft, IconChevronRight, IconRefresh } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { api, asApiError, type CalEvent, type Timer, type TodayData } from '../../api';
import { PLACE_ICON, STROKE } from '../../app/icons';
import { BRAND } from '../../brand';
import { blockDone, currentEvent, nextEvent } from '../../blocks';
import { planSpeech, TODAY_REFRESH } from '../../commands';
import * as f from '../../fmt';
import { useNow, usePageActive } from '../../hooks';
import { ASK_PATH, replace, switchTab } from '../../router';
import { feel } from '../../sound';
import { emit, toast, useRefresh, useStore } from '../../store';
import { lifeYmd } from '../../time';
import { modeNow, openMode, openQuickCapture, openSettings, openVoice } from '../../ui';
import { useLoad } from '../../ui/data';
import { SpeakButton } from '../../ui/Mic';
import { Empty, ErrorState, Loading, Notice, Page, Section } from '../../ui/Page';
import { Focus, Musts, TimerFace } from './Focus';
import { AllDayChips, DayStrip, DayTimeline, nameOf } from './Timeline';

type View = 'day' | 'week';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (d: string, n: number) => dayjs(d).add(n, 'day').format('YYYY-MM-DD');
/** Monday of the week that holds `d`. */
const mondayOf = (d: string) => addDays(d, -((dayjs(d).day() + 6) % 7));
const pathOf = (view: View, date: string, today: string) => `/calendar${view === 'week' ? '/week' : ''}${date === today ? '' : `?date=${date}`}`;

export function CalendarScreen() {
  const view: View = (useParams()['*'] ?? '').startsWith('week') ? 'week' : 'day';
  const [params] = useSearchParams();
  const today = lifeYmd();
  const raw = params.get('date');
  const date = raw && YMD.test(raw) ? raw : today;
  const active = usePageActive();
  const knownMode = useStore(modeNow).mode;

  const step = view === 'week' ? 7 : 1;
  const nav = (v: View, d: string) => {
    feel('tab');
    replace(pathOf(v, d, today));
  };
  const isCurrent = view === 'week' ? mondayOf(date) === mondayOf(today) : date === today;
  const weekFrom = mondayOf(date);

  // Header data the day view lifts up (Read plan). The week view leaves it empty.
  const [speech, setSpeech] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reloadRef = useRef<() => void>(() => undefined);

  const toolbar = (
    <Group justify="space-between" gap="sm" wrap="wrap">
      <SegmentedControl
        size="sm"
        value={view}
        onChange={(v) => nav(v as View, date)}
        data={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
        ]}
        aria-label="Calendar view"
      />
      <Group gap={4} wrap="nowrap">
        <Tooltip label={view === 'week' ? 'Previous week' : 'Previous day'}>
          <ActionIcon variant="subtle" size="lg" aria-label={view === 'week' ? 'Previous week' : 'Previous day'} onClick={() => nav(view, addDays(date, -step))}>
            <IconChevronLeft size={20} stroke={STROKE} />
          </ActionIcon>
        </Tooltip>
        <Button variant={isCurrent ? 'light' : 'default'} size="compact-md" onClick={() => nav(view, today)} disabled={isCurrent}>
          {view === 'week' ? 'This week' : 'Today'}
        </Button>
        <Tooltip label={view === 'week' ? 'Next week' : 'Next day'}>
          <ActionIcon variant="subtle" size="lg" aria-label={view === 'week' ? 'Next week' : 'Next day'} onClick={() => nav(view, addDays(date, step))}>
            <IconChevronRight size={20} stroke={STROKE} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );

  const Mic = PLACE_ICON.mic;
  const Ask = PLACE_ICON.ask;
  const actions = (
    <>
      {knownMode && (
        <Button variant="light" size="compact-sm" radius="xl" onClick={openMode} aria-label={`Mode: ${knownMode}. Change mode.`}>
          {knownMode}
        </Button>
      )}
      {speech && <SpeakButton text={speech} label="Read plan" />}
      <Tooltip label="Voice command">
        <ActionIcon variant="subtle" size="lg" aria-label="Voice command" onClick={openVoice}>
          <Mic size={20} stroke={STROKE} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={BRAND.assistant}>
        <ActionIcon variant="subtle" size="lg" aria-label={BRAND.assistant} onClick={() => switchTab(ASK_PATH)}>
          <Ask size={20} stroke={STROKE} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Refresh">
        <ActionIcon variant="subtle" size="lg" aria-label="Refresh" loading={busy} onClick={() => reloadRef.current()}>
          <IconRefresh size={20} stroke={STROKE} />
        </ActionIcon>
      </Tooltip>
    </>
  );

  const bind = useCallback((reload: () => void, isBusy: boolean, text: string | null) => {
    reloadRef.current = reload;
    setBusy(isBusy);
    setSpeech(text);
  }, []);

  return (
    <Page
      title="Calendar"
      subtitle={view === 'week' ? f.range(weekFrom, addDays(weekFrom, 6)) : f.dayLong(date)}
      icon={PLACE_ICON.calendar}
      wide
      actions={actions}
      toolbar={toolbar}
    >
      <Routes>
        <Route index element={<DayView date={date} today={today} active={active} bind={bind} />} />
        <Route path="day" element={<Navigate to={pathOf('day', date, today)} replace />} />
        <Route path="week" element={<WeekView from={weekFrom} today={today} active={active} bind={bind} onDay={(d) => nav('day', d)} />} />
        <Route path="*" element={<Navigate to="/calendar" replace />} />
      </Routes>
    </Page>
  );
}

type Bind = (reload: () => void, busy: boolean, speech: string | null) => void;

function NotConnected() {
  return (
    <Section>
      <Empty title="Google not connected. Open Settings, then Connect Google." icon={PLACE_ICON.calendar} action={<Button onClick={() => openSettings('google')}>Connect Google</Button>}>
        Blocks come from your calendar. Connect once and they show here.
      </Empty>
    </Section>
  );
}

/** One day. On today: focus (now or next), timer, priorities. Any day: all-day chips, strip, timeline. */
function DayView({ date, today, active, bind }: { date: string; today: string; active: boolean; bind: Bind }) {
  const isToday = date === today;
  const wide = useMediaQuery('(min-width: 62em)') ?? false;
  const load = useLoad(() => api.today(isToday ? undefined : date), active, [date], { key: `cal-day-${date}` });
  const { data, error, loading, refreshing, reload, setData } = load;
  const now = useNow(active, 1000);
  const [timer, setTimer] = useState<Timer | null | undefined>(undefined);
  const lastLoad = useRef(Date.now());

  // The server copy of the timer and mode win on each load.
  useEffect(() => {
    if (!data) return;
    lastLoad.current = Date.now();
    setTimer(data.timer);
    modeNow.set({ mode: data.mode });
  }, [data]);

  // Every minute, on TODAY_REFRESH (voice "start timer" and friends). Becoming visible reloads through `active`.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void reload(), 60000);
    const onAsk = () => void reload();
    window.addEventListener(TODAY_REFRESH, onAsk);
    return () => {
      clearInterval(id);
      window.removeEventListener(TODAY_REFRESH, onAsk);
    };
  }, [active, reload]);

  const selfEmit = useRef(false);
  useRefresh(['blocks', 'tasks'], () => {
    if (active && !selfEmit.current) void reload();
  });

  const events = data?.events ?? [];
  const cur = isToday ? (events.length ? currentEvent(events, now) : (data?.now ?? null)) : null;
  const nxt = isToday ? (events.length ? nextEvent(events, now) : (data?.next ?? null)) : null;
  const focus = cur ?? nxt;
  const isNow = !!cur;

  // When the current block ends, refresh (tasks may have changed); at most once a minute.
  useEffect(() => {
    if (active && cur && Date.parse(cur.end) - now < 1000 && Date.now() - lastLoad.current > 60000) {
      lastLoad.current = Date.now();
      void reload();
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lift Refresh and Read plan into the page header.
  const speech = data && data.connected.google && isToday ? planSpeech(data, Math.floor(now / 60000) * 60000) : null;
  useEffect(() => bind(() => void reload(), refreshing || loading, speech), [bind, reload, refreshing, loading, speech]);

  const startTimer = async () => {
    const label = focus?.task ?? (focus ? nameOf(focus) : 'Focus');
    // The block's own minutes (never more than 50), linked to its app task so the sprint is logged against it.
    const min = Math.max(5, Math.min(50, focus?.minutes ?? 50));
    feel('timerStart');
    try {
      setTimer(await api.startTimer(min, label, focus?.taskId ?? null));
      toast(`Timer started: ${f.minutes(min)}`);
    } catch (e) {
      toast(asApiError(e).message);
    }
  };
  const cancelTimer = async () => {
    const prev = timer;
    setTimer(null);
    try {
      await api.stopTimer();
    } catch (e) {
      setTimer(prev);
      toast(asApiError(e).message);
    }
  };
  const toggleMust = async (ev: CalEvent, done: boolean) => {
    const patch = (d: boolean) =>
      setData(
        (c) =>
          c && {
            ...c,
            musts: c.musts.map((m) => (m.id === ev.id ? { ...m, taskDone: d } : m)),
            events: c.events.map((m) => (m.id === ev.id ? { ...m, taskDone: d } : m)),
          },
      );
    patch(done);
    if (done) {
      const allDone = !!data && data.musts.every((m) => m.id === ev.id || blockDone(m));
      feel(allDone ? 'allDone' : 'done');
    } else feel('undo');
    try {
      await api.mustDone(ev.id, done);
      selfEmit.current = true;
      try {
        emit('tasks');
      } finally {
        selfEmit.current = false;
      }
    } catch (e) {
      patch(!done);
      toast(asApiError(e).message);
    }
  };

  if (loading) return <Loading label={isToday ? 'Loading today' : 'Loading day'} lines={6} />;
  if (!data) return error ? <ErrorState error={error} onRetry={() => void reload()} /> : <Loading label="Loading day" lines={6} />;

  const hasTimed = events.some((e) => !e.allDay);
  const timerOnly =
    isToday && timer ? (
      <Section title="Focus timer">
        <TimerFace timer={timer} now={now} onCancel={cancelTimer} />
      </Section>
    ) : null;

  const head = (
    <>
      <AllDayChips events={events} />
      {data.warnings.length > 0 && (
        <Notice tone="warn">
          {data.warnings.map((w, i) => (
            <span key={i} style={{ display: 'block' }}>
              {w}
            </span>
          ))}
        </Notice>
      )}
      {error && <Notice>Could not refresh: {error.message}</Notice>}
    </>
  );

  if (!data.connected.google) {
    return (
      <Stack gap="md">
        {head}
        {timerOnly}
        <NotConnected />
      </Stack>
    );
  }

  const blocks = events.filter((e) => e.kind === 'block' && !e.allDay).length;
  const timelineCard = (
    <Section title="Day" hint={<span className="num">{f.plural(blocks, 'block')}</span>}>
      <DayTimeline data={data} now={now} emptyText={isToday ? 'Nothing on the calendar today' : 'Nothing on the calendar this day'} />
    </Section>
  );

  const main = (
    <Stack gap="md">
      {hasTimed && <DayStrip date={data.date} events={events} now={now} />}
      {isToday &&
        (focus ? (
          <Focus ev={focus} isNow={isNow} now={now} timer={timer} onTimer={() => void startTimer()} onCancel={() => void cancelTimer()} />
        ) : (
          <>
            {timerOnly}
            <Section>
              <Empty title="Nothing else on the calendar today" action={<Button variant="default" onClick={() => openQuickCapture()}>Capture</Button>}>
                Capture anything on your mind, then wind down.
              </Empty>
            </Section>
          </>
        ))}
      {isToday ? <Musts musts={data.musts} onToggle={(ev, d) => void toggleMust(ev, d)} /> : <MustsReadOnly musts={data.musts} />}
    </Stack>
  );

  if (wide && hasTimed) {
    return (
      <Stack gap="md">
        {head}
        <Grid gap="lg" align="flex-start">
          <Grid.Col span={6}>{main}</Grid.Col>
          <Grid.Col span={6}>{timelineCard}</Grid.Col>
        </Grid>
      </Stack>
    );
  }
  return (
    <Stack gap="md">
      {head}
      {main}
      {hasTimed && timelineCard}
    </Stack>
  );
}

/** Another day's priorities: a quiet summary, no ticking (ticks belong to today). */
function MustsReadOnly({ musts }: { musts: CalEvent[] }) {
  if (!musts.length) return null;
  const done = musts.filter((m) => blockDone(m)).length;
  return (
    <Text size="sm" c="dimmed" className="num">
      {f.plural(musts.length, 'priority', 'priorities')}, {f.num(done)} done
    </Text>
  );
}

/** Seven days from Monday. One api.today call per day; a failed day shows its own message. */
function WeekView({ from, today, active, bind, onDay }: { from: string; today: string; active: boolean; bind: Bind; onDay: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const load = useLoad(
    async () => {
      const rs = await Promise.allSettled(days.map((d) => api.today(d === today ? undefined : d)));
      return rs.map((r) => (r.status === 'fulfilled' ? r.value : null));
    },
    active,
    [from],
    { key: `cal-week-${from}` },
  );
  const { data, error, loading, refreshing, reload } = load;
  const now = useNow(active, 60000);
  useRefresh(['blocks', 'tasks'], () => {
    if (active) void reload();
  });
  useEffect(() => bind(() => void reload(), refreshing || loading, null), [bind, reload, refreshing, loading]);

  if (loading) return <Loading label="Loading week" lines={8} />;
  if (!data) return error ? <ErrorState error={error} onRetry={() => void reload()} /> : <Loading label="Loading week" lines={8} />;

  const got = data.filter((d): d is TodayData => !!d);
  if (got.length && got.every((d) => !d.connected.google)) return <NotConnected />;
  if (!got.length) return <ErrorState error={{ code: 'unreachable', message: 'Could not load this week.' } as never} onRetry={() => void reload()} />;

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
      {days.map((d, i) => {
        const day = data[i] ?? null;
        const blocks = day ? day.events.filter((e) => e.kind === 'block' && !e.allDay).length : 0;
        const musts = day?.musts ?? [];
        const mustsDone = musts.filter((m) => blockDone(m)).length;
        const isToday = d === today;
        return (
          <Section
            key={d}
            title={f.dayFull(d)}
            hint={day ? <span className="num">{blocks ? f.plural(blocks, 'block') : 'No blocks'}</span> : undefined}
            onTitleClick={() => onDay(d)}
            right={
              <Group gap={4} wrap="nowrap">
                {musts.length > 0 && (
                  <Badge size="sm" variant="light" color="gray" className="num" aria-label={`${f.num(mustsDone)} of ${f.plural(musts.length, 'priority', 'priorities')} done`}>
                    {f.num(mustsDone)}/{f.num(musts.length)}
                  </Badge>
                )}
                {isToday && (
                  <Badge size="sm" variant="filled">
                    Today
                  </Badge>
                )}
              </Group>
            }
          >
            {day ? (
              <Stack gap={6}>
                <AllDayChips events={day.events.filter((e) => e.allDay && e.kind === 'banner')} />
                <DayTimeline data={day} now={now} compact emptyText="Nothing on the calendar" />
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                Could not load this day.{' '}
                <Button variant="subtle" size="compact-sm" onClick={() => void reload()}>
                  Retry
                </Button>
              </Text>
            )}
          </Section>
        );
      })}
    </SimpleGrid>
  );
}
