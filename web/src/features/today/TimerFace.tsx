import { Button, Card, Group, Progress, Text } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api, type Timer } from '../../api';
import * as f from '../../fmt';
import { act, useNow } from '../../hooks';
import { prefs } from '../../prefs';
import { feel, stopNoise } from '../../sound';
import { toast } from '../../store';
import { speak } from '../../voice';
import { FIVE_MIN } from './util';

/** Running timer: countdown, progress, pause/resume, stop. Speaks at 5 min left and at the end. */
export function TimerFace({ timer, active, onChange }: { timer: Timer; active: boolean; onChange: (t: Timer | null) => void }) {
  const now = useNow(active, 1000);
  const [busy, setBusy] = useState(false);
  const paused = !!timer.pausedAt;
  const end = Date.parse(timer.endsAt);
  const remaining = Math.max(0, end - (paused ? Date.parse(timer.pausedAt!) : now));
  const total = Math.max(1, end - Date.parse(timer.startedAt) - (timer.pausedMs ?? 0));
  const share = Math.min(1, Math.max(0, 1 - remaining / total));
  const over = remaining <= 0;
  const fired = useRef({ key: '', five: false, end: false });
  if (fired.current.key !== timer.startedAt) fired.current = { key: timer.startedAt, five: remaining <= FIVE_MIN, end: over };
  useEffect(() => {
    const s = fired.current;
    if (!s.five && !over && remaining <= FIVE_MIN) {
      s.five = true;
      toast('5 minutes left.');
    }
    if (!s.end && over) {
      s.end = true;
      feel('timerEnd');
      stopNoise();
      if (prefs.get().speakTimer) speak(`Timer done. ${timer.label}`);
    }
  }, [over, remaining, timer.label]);

  const run = async <T,>(p: Promise<T>, next: (v: T) => Timer | null) => {
    setBusy(true);
    const r = await act(p);
    setBusy(false);
    if (r !== null) {
      feel('tap');
      onChange(next(r));
    }
  };
  return (
    <Card radius="lg" padding="lg" withBorder>
      <Text size="xs" c="dimmed" tt="uppercase" fw={650}>{over ? 'Time is up' : paused ? 'Paused' : 'Focus'}</Text>
      <Text fw={600} mt={4}>{timer.label}</Text>
      <Text fz="var(--app-fz-hero)" fw={650} lh={1.1} className="num" role="timer" aria-label={`${f.clock(remaining)} left`} c={over ? 'signal' : undefined}>
        {f.clock(remaining)}
      </Text>
      <Progress value={share * 100} radius="xl" size="sm" mt="xs" mb="md" aria-label="Timer progress" />
      <Group>
        {!over && (
          <Button variant="light" loading={busy} leftSection={paused ? <IconPlayerPlay size={16} /> : <IconPlayerPause size={16} />} onClick={() => void (paused ? run(api.resumeTimer(), (x) => x as Timer) : run(api.pauseTimer('other'), (x) => x as Timer))}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
        )}
        <Button variant={over ? 'filled' : 'subtle'} color={over ? undefined : 'gray'} loading={busy} leftSection={<IconPlayerStop size={16} />} onClick={() => void run(api.stopTimer(), () => null)}>
          {over ? 'Clear' : 'Stop'}
        </Button>
      </Group>
    </Card>
  );
}
