// The current or next block, the focus timer and today's priorities. Ported from the old Today screen.
import { Badge, Box, Button, Checkbox, Group, Progress, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconSparkles, IconVolume, IconVolumeOff } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api, asApiError, type CalEvent, type PauseReason, type Timer } from '../../api';
import { blockDone } from '../../blocks';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { prefs } from '../../prefs';
import { ASK_PATH, go } from '../../router';
import { feel, playingNoise, startNoise, stopNoise, type NoiseKind } from '../../sound';
import { toast } from '../../store';
import { minutesLeft } from '../../time';
import { Section } from '../../ui/Page';
import { speak } from '../../voice';
import { at, endOf, eventLook, nameOf, plain, startOf } from './Timeline';

/** Now / next block with its plan, a countdown and the timer. One Section (a Card). */
export function Focus({ ev, isNow, now, timer, onTimer, onCancel }: {
  ev: CalEvent;
  isNow: boolean;
  now: number;
  timer: Timer | null | undefined;
  onTimer: () => void;
  onCancel: () => void;
}) {
  const anchor = ev.kind !== 'block';
  const { Icon, color } = eventLook(ev);
  const total = Math.max(1, (endOf(ev) - startOf(ev)) / 60000);
  const left = isNow ? minutesLeft(ev.end, now) : minutesLeft(ev.start, now);
  const progress = isNow ? Math.min(1, Math.max(0, 1 - left / total)) : 0;
  const rest = plain(ev.baseTitle);
  const task = ev.task ?? (anchor ? rest : null);
  const done = ev.done?.replace(/^DONE\s*=\s*/i, '');

  return (
    <Section>
      <Stack gap="sm" aria-labelledby="cal-focus-task" component="section">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="sm" c="dimmed">
            {isNow ? (
              <>
                <Badge component="strong" size="sm" color="signal" variant="light" mr={6} style={{ verticalAlign: 'middle' }}>
                  Now
                </Badge>
                until{' '}
                <time className="num" dateTime={ev.end}>
                  {at(ev.end)}
                </time>
              </>
            ) : (
              <>
                <Text component="strong" fw={650} c="var(--mantine-color-text)" inherit>
                  Next
                </Text>{' '}
                at{' '}
                <time className="num" dateTime={ev.start}>
                  {at(ev.start)}–{at(ev.end)}
                </time>
              </>
            )}
          </Text>
          {!anchor && ev.must !== null && (
            <Badge variant={ev.must ? 'filled' : 'light'} color={ev.must ? color : 'gray'}>
              {ev.must ? 'Priority' : 'If time'}
            </Badge>
          )}
        </Group>

        {!anchor && (
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon variant="light" color={color} size={24} radius="md" aria-hidden="true">
              <Icon size={14} stroke={STROKE} />
            </ThemeIcon>
            <Text size="sm" fw={600} lineClamp={1}>
              {nameOf(ev)}
            </Text>
          </Group>
        )}

        <Title order={2} size="h3" id="cal-focus-task" c={task ? undefined : 'dimmed'} fw={task ? 700 : 500} lineClamp={3}>
          {task ?? 'No task written for this block yet'}
        </Title>

        {(ev.ifThen || done) && (
          <Stack gap={4} component="dl" m={0}>
            {ev.ifThen && (
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Text component="dt" size="xs" c="dimmed" w={72} pt={2} style={{ flexShrink: 0 }}>
                  Start
                </Text>
                <Text component="dd" size="sm" m={0}>
                  {ev.ifThen}
                </Text>
              </Group>
            )}
            {done && (
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Text component="dt" size="xs" c="dimmed" w={72} pt={2} style={{ flexShrink: 0 }}>
                  Done when
                </Text>
                <Text component="dd" size="sm" m={0}>
                  {done}
                </Text>
              </Group>
            )}
          </Stack>
        )}

        {timer ? (
          <TimerFace timer={timer} now={now} task={task} onCancel={onCancel} />
        ) : (
          <>
            <Group gap={8} align="baseline">
              <Text fz="var(--app-fz-stat)" fw={650} lh={1} className="num">
                {f.num(left)}
              </Text>
              <Text size="sm" c="dimmed">
                {isNow ? 'min left' : 'min to start'}
              </Text>
              {ev.minutes && !anchor ? (
                <Text size="xs" c="dimmed" ml="auto" className="num">
                  Planned {f.minutes(ev.minutes)}
                </Text>
              ) : null}
            </Group>
            {isNow && <Progress value={Math.round(progress * 100)} color={color} size="sm" aria-label="Block progress" />}
            {!anchor && (
              <Group gap="xs">
                <Button leftSection={<IconPlayerPlay size={16} stroke={STROKE} />} onClick={onTimer}>
                  Start 50 min
                </Button>
                <Button variant="default" leftSection={<IconSparkles size={16} stroke={STROKE} />} onClick={() => go(`${ASK_PATH}?run=/what-now`)}>
                  Ask what now
                </Button>
              </Group>
            )}
          </>
        )}
      </Stack>
    </Section>
  );
}

const PAUSE_REASONS: { id: PauseReason; label: string }[] = [
  { id: 'family', label: 'Family' },
  { id: 'power', label: 'Power cut' },
  { id: 'other', label: 'Other' },
];

/** Focus timer: the countdown takes over. Pause keeps the minutes; noise is optional. Not a Card (it sits inside one). */
export function TimerFace({ timer: given, now, task, onCancel }: {
  timer: Timer;
  now: number;
  task?: string | null;
  onCancel: () => void;
}) {
  // Local copy after pause/resume; dropped when a different timer arrives.
  const [local, setLocal] = useState<Timer | null>(null);
  const timer = local && local.startedAt === given.startedAt ? local : given;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noise, setNoise] = useState<NoiseKind | null>(() => playingNoise());
  const paused = !!timer.pausedAt;
  const remaining = Date.parse(timer.endsAt) - (paused ? Date.parse(timer.pausedAt!) : now);
  const done = !paused && remaining <= 0;
  // Ring once when the countdown crosses zero while the page is open (not when it loads already finished).
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current) {
      feel('timerEnd');
      stopNoise();
      setNoise(null);
      if (prefs.get().speakTimer) speak(`Timer done. ${timer.label}`);
    }
    wasDone.current = done;
  }, [done, timer.label]);
  // Noise stops with the timer face.
  useEffect(() => () => stopNoise(), []);

  const pause = async (reason: PauseReason) => {
    setBusy(true);
    try {
      const t = await api.pauseTimer(reason);
      setLocal(t);
      setAsking(false);
      if (noise) stopNoise();
      feel('tap');
    } catch (e) {
      toast(asApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const resume = async () => {
    setBusy(true);
    try {
      const t = await api.resumeTimer();
      setLocal(t);
      if (noise) startNoise(noise);
      feel('tap');
    } catch (e) {
      toast(asApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const cycleNoise = () => {
    const next: NoiseKind | null = noise === null ? 'brown' : noise === 'brown' ? 'pink' : null;
    if (next) {
      if (!paused) startNoise(next);
    } else stopNoise(true);
    setNoise(next);
  };
  const cancel = () => {
    stopNoise();
    setNoise(null);
    onCancel();
  };
  const reason = timer.pauseReason
    ? ` for ${PAUSE_REASONS.find((r) => r.id === timer.pauseReason)?.label.toLowerCase() ?? timer.pauseReason}`
    : '';
  const label = done ? `Done: ${timer.label}` : paused ? `Paused${reason}` : timer.label === task ? 'Focus timer running' : timer.label;

  return (
    <Box
      role="timer"
      aria-label={`Timer: ${timer.label}`}
      p="md"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        background: done ? 'var(--mantine-color-teal-light)' : paused ? 'var(--mantine-color-default-hover)' : 'var(--mantine-primary-color-light)',
      }}
    >
      <Group gap="md" wrap="wrap" align="center">
        <Text fz="var(--app-fz-display)" fw={650} lh={1} className="num" c={paused ? 'dimmed' : undefined}>
          {done ? 'Time' : f.clock(remaining)}
        </Text>
        <Stack gap={8} style={{ flex: 1, minWidth: 200 }}>
          <Text size="sm" fw={600} aria-live="polite" lineClamp={2}>
            {label}
          </Text>
          {asking ? (
            <Group gap={6} role="group" aria-label="Pause for">
              {PAUSE_REASONS.map((r) => (
                <Button key={r.id} size="compact-sm" variant="default" disabled={busy} onClick={() => void pause(r.id)}>
                  {r.label}
                </Button>
              ))}
              <Button size="compact-sm" variant="subtle" color="gray" onClick={() => setAsking(false)}>
                Back
              </Button>
            </Group>
          ) : (
            <Group gap={6}>
              {!done &&
                (paused ? (
                  <Button size="compact-sm" leftSection={<IconPlayerPlay size={14} stroke={STROKE} />} disabled={busy} onClick={() => void resume()}>
                    Resume
                  </Button>
                ) : (
                  <Button size="compact-sm" variant="default" leftSection={<IconPlayerPause size={14} stroke={STROKE} />} disabled={busy} onClick={() => setAsking(true)}>
                    Pause
                  </Button>
                ))}
              {!done && (
                <Button
                  size="compact-sm"
                  variant="subtle"
                  leftSection={noise ? <IconVolume size={14} stroke={STROKE} /> : <IconVolumeOff size={14} stroke={STROKE} />}
                  onClick={cycleNoise}
                  aria-label={`Noise: ${noise ?? 'off'}. Change noise.`}
                >
                  {noise === 'brown' ? 'Noise: brown' : noise === 'pink' ? 'Noise: pink' : 'Noise: off'}
                </Button>
              )}
              <Button size="compact-sm" variant="default" leftSection={<IconPlayerStop size={14} stroke={STROKE} />} onClick={cancel}>
                {done ? 'Clear' : 'Cancel timer'}
              </Button>
            </Group>
          )}
        </Stack>
      </Group>
    </Box>
  );
}

/** Today's priorities as checkboxes. Ticking marks the block task done (and its app task). */
export function Musts({ musts, onToggle }: { musts: CalEvent[]; onToggle: (ev: CalEvent, done: boolean) => void }) {
  if (!musts.length) return null;
  const left = musts.filter((m) => !blockDone(m)).length;
  return (
    <Section
      title="Priorities"
      hint={
        <span className="num" aria-live="polite">
          {left === 0 ? 'all done' : `${f.num(left)} open`}
        </span>
      }
    >
      <Stack gap="sm" component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
        {musts.map((m) => {
          const rest = nameOf(m);
          const { color } = eventLook(m);
          return (
            <Box component="li" key={m.id}>
              <Checkbox
                size="md"
                radius="xl"
                color={color}
                checked={!!blockDone(m)}
                onChange={(e) => onToggle(m, e.currentTarget.checked)}
                label={
                  <Text size="sm" fw={600} td={blockDone(m) ? 'line-through' : undefined} c={blockDone(m) ? 'dimmed' : undefined} lineClamp={2}>
                    {m.task ?? rest}
                  </Text>
                }
                description={
                  <span className="num">
                    {rest}, {at(m.start)}
                  </span>
                }
              />
            </Box>
          );
        })}
      </Stack>
    </Section>
  );
}
