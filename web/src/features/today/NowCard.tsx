import { ActionIcon, Badge, Button, Card, Group, Menu, Stack, Text } from '@mantine/core';
import { IconCheck, IconDots, IconPlayerPlay, IconPlayerTrackNext, IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { api, type CalEvent, type Timer } from '../../api';
import { STROKE } from '../../app/icons';
import { currentEvent, splitEmoji } from '../../blocks';
import { burst } from '../../fx';
import { act, useLoad } from '../../hooks';
import { prefs } from '../../prefs';
import { go } from '../../router';
import { feel } from '../../sound';
import { emit, toastUndo } from '../../store';
import { localMinutes, hm, lifeDow, lifeYmd } from '../../time';
import { openQuickCapture } from '../../ui';
import { v2, type V2Task, type WhatNow } from '../../v2';
import { isMust } from '../tasks/TaskEditor';
import { TimerFace } from './TimerFace';
import { addDay, DAY_START, doneReceipt, NIGHT_FROM } from './util';

// ---------------------------------------------------------------- now card

type Target = { kind: 'task'; task: V2Task } | { kind: 'block'; ev: CalEvent };

export function NowCard({ mode, events, now, timer, active, what, onTimer, onChange }: {
  mode: string;
  events: CalEvent[];
  now: number;
  timer: Timer | null;
  active: boolean;
  what: WhatNow;
  onTimer: (t: Timer | null) => void;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const mins = localMinutes(now);
  const night = mins >= NIGHT_FROM || mins < DAY_START;
  const full = prefs.get().fullHome;
  const block = currentEvent(events, now) as CalEvent | null;
  const next = events.filter((e) => !e.allDay && e.kind === 'block' && Date.parse(e.start) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null;

  const start = async (min: number, label: string, taskId: string | null) => {
    setBusy(true);
    const r = await act(api.startTimer(min, label, taskId));
    setBusy(false);
    if (r) {
      feel('timerStart');
      onTimer(r as Timer);
    }
  };
  /** Done acts on the shown task: the app task, or the block's mirrored task (created on first tick). */
  const done = async (target: Target, title: string, el?: HTMLElement) => {
    let id: string | null = null;
    if (target.kind === 'task') id = (await act(v2.done(target.task.id))) ? target.task.id : null;
    else if (target.ev.taskId) id = (await act(v2.done(target.ev.taskId))) ? target.ev.taskId : null;
    else id = (await act(api.mustDone(target.ev.id, true)))?.taskId ?? null;
    if (!id) return;
    feel('done');
    if (el) burst(el);
    emit('tasks');
    emit('blocks');
    const taskId = id;
    void doneReceipt(title, () => void v2.reopen(taskId).then(() => { emit('tasks'); emit('blocks'); }));
    onChange();
  };
  /** Skip = not today. A one-off moves to tomorrow, a recurring one to its next time. Undo restores the due date. */
  const skip = async (task: V2Task) => {
    const r = await act(v2.skip(task.id));
    if (!r) return;
    emit('tasks');
    onChange();
    const prev = r.prev_due ?? null;
    toastUndo(task.recur ? 'Skipped to next time' : 'Moved to tomorrow', () => void v2.setDay([task.id], prev).then(() => { emit('tasks'); onChange(); }));
  };

  if (timer) return <TimerFace timer={timer} active={active} onChange={onTimer} />;

  const shell = (over: string, body: React.ReactNode) => (
    <Card radius="lg" padding="lg" withBorder style={{ borderColor: 'var(--mantine-primary-color-filled)', borderWidth: 1.5 }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={650} mb={6}>{over}</Text>
      {body}
    </Card>
  );

  if (!full && night) {
    return shell('Night', <Stack gap="xs"><NightLine now={now} /><Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => openQuickCapture('note')}>Capture a thought</Button></Stack>);
  }
  if (!full && lifeDow(now) === 6) {
    return shell('Rest day', <Stack gap="xs"><Text fw={600} size="lg">Saturday. Nothing is due.</Text><Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => openQuickCapture(null)}>Capture</Button></Stack>);
  }
  if (mode === 'Family') {
    return shell('Family mode', <Stack gap="xs"><Text fw={600} size="lg">Family first. Capture only.</Text><Button leftSection={<IconPlus size={16} />} onClick={() => openQuickCapture(null)}>Capture</Button></Stack>);
  }
  if (mode === 'Zero') {
    const min = Math.min(10, what?.minutes ?? 10);
    return shell('Zero mode', (
      <Stack gap="xs">
        <Text fw={600} size="lg">{what?.task.title ?? 'One small thing. 10 minutes.'}</Text>
        {what?.first_action && <Text size="sm" c="dimmed">First: {what.first_action}</Text>}
        <Group>
          <Button leftSection={<IconPlayerPlay size={16} />} loading={busy} onClick={() => void start(min, what?.task.title ?? 'Zero day', what?.task.id ?? null)}>Start {min} min</Button>
          {what && <Button variant="light" leftSection={<IconCheck size={16} />} onClick={(e) => void done({ kind: 'task', task: what.task }, what.task.title, e.currentTarget)}>Done</Button>}
        </Group>
      </Stack>
    ));
  }

  const isBlock = !!block && block.kind === 'block';
  // The shown task: the running block's mirrored task (whatNow says 'block'), else the block's own title task,
  // else the picked task. Done/Skip/Start all act on this one task.
  const target: Target | null =
    what && (what.reason === 'block' || !isBlock || !block!.task) ? { kind: 'task', task: what.task } : isBlock && block!.task ? { kind: 'block', ev: block! } : null;
  const title = target ? (target.kind === 'task' ? target.task.title : target.ev.task!) : null;
  const taskId = target ? (target.kind === 'task' ? target.task.id : (target.ev.taskId ?? null)) : null;
  // Block names carry the calendar emoji (it sets the colour there); the UI shows words only. Ends are ISO.
  const name = (e: CalEvent) => splitEmoji(e.blockName ?? e.baseTitle).rest;
  const over = isBlock ? `${name(block!)} · until ${hm(block!.end)}` : next ? `Between blocks · next ${name(next)} at ${hm(next.start)}` : 'Now';
  // Start = the block's minutes (time left in it), else the task estimate, else 10. Never more than 50.
  const blockLeft = isBlock ? Math.max(5, Math.round((Date.parse(block!.end) - now) / 60_000)) : null;
  const minutes = Math.max(5, Math.min(50,
    target?.kind === 'task'
      ? (what?.minutes ?? target.task.est_minutes ?? 10)
      : target?.kind === 'block'
        ? Math.min(target.ev.minutes ?? blockLeft ?? 10, blockLeft ?? 50)
        : 10));
  const ifThen = target?.kind === 'block' || (target?.kind === 'task' && what?.reason === 'block') ? (block?.ifThen ?? null) : null;
  const firstLine = ifThen ?? (target?.kind === 'task' && what?.first_action ? `First: ${what.first_action}` : null);
  const must = target?.kind === 'block' ? target.ev.must : what?.reason === 'block' && isBlock ? block!.must : target?.kind === 'task' ? (isMust(target.task) ? true : null) : null;

  if (!target || !title) {
    return shell(over, (
      <Stack gap="xs">
        <Text fw={600} size="lg">Nothing scheduled right now.</Text>
        <Group>
          <Button variant="light" leftSection={<IconPlayerPlay size={16} />} loading={busy} onClick={() => void start(10, 'Something small', null)}>Start 10 min</Button>
          <Button variant="subtle" onClick={() => go('/tasks')}>Pick a task</Button>
        </Group>
      </Stack>
    ));
  }

  return shell(over, (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text fw={650} size="xl" lh={1.25}>{title}</Text>
        {must !== null && must !== undefined && <Badge variant={must ? 'filled' : 'light'} color={must ? 'brand' : 'gray'} style={{ flexShrink: 0 }}>{must ? 'Priority' : 'If time'}</Badge>}
      </Group>
      {firstLine && <Text size="sm" c="dimmed">{firstLine}</Text>}
      <Group gap="xs">
        <Button leftSection={<IconPlayerPlay size={16} />} loading={busy} onClick={() => void start(minutes, title, taskId)}>Start {minutes} min</Button>
        <Button variant="light" leftSection={<IconCheck size={16} />} onClick={(e) => void done(target, title, e.currentTarget)}>Done</Button>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="lg" aria-label="More actions"><IconDots size={18} stroke={STROKE} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {target.kind === 'task' && !target.task.event_id && <Menu.Item leftSection={<IconPlayerTrackNext size={16} />} onClick={() => void skip(target.task)}>{target.task.recur ? 'Skip to next time' : 'Skip to tomorrow'}</Menu.Item>}
            <Menu.Item onClick={() => go('/tasks')}>Open in Tasks</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Stack>
  ));
}

/** Honest night text: "Tomorrow is planned" only when tomorrow's blocks carry tasks. */
export function NightLine({ now }: { now: number }) {
  const tomorrow = addDay(lifeYmd(now), 1);
  const t = useLoad(() => api.today(tomorrow), true, [tomorrow], { key: `today:${tomorrow}` });
  const planned = !!t.data?.events.some((e) => e.kind === 'block' && !!e.task);
  const text = !t.data ? 'Wind down.' : planned ? 'Wind down. Tomorrow is planned.' : 'Wind down. Tomorrow is not planned yet.';
  return <Text fw={600} size="lg">{text}</Text>;
}
