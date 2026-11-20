import { Button, Card, Text } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useState } from 'react';
import { api, type Timer } from '../../api';
import { act } from '../../hooks';
import { feel } from '../../sound';
import { lifeDow, lifeYmd } from '../../time';
import { type WhatNow } from '../../v2';
import { addDay } from './util';

// ---------------------------------------------------------------- re-entry

/** After 2+ quiet life-days: one block to restart. Never says how many days were missed. */
export function ReEntry({ lastAt, now, what, onTimer }: { lastAt: string | null; now: number; what: WhatNow; onTimer: (t: Timer | null) => void }) {
  const [busy, setBusy] = useState(false);
  // A new week when the last activity was before this week's Sunday (the week starts with the Sunday review).
  const today = lifeYmd(now);
  const weekStart = addDay(today, -lifeDow(now));
  const newWeek = !lastAt || lifeYmd(lastAt) < weekStart;
  const minutes = Math.min(what?.minutes ?? what?.task.est_minutes ?? 10, 50);
  const start = async () => {
    setBusy(true);
    const r = await act(api.startTimer(minutes, what?.task.title ?? 'Restart: one block', what?.task.id ?? null));
    setBusy(false);
    if (r) {
      feel('timerStart');
      onTimer(r as Timer);
    }
  };
  return (
    <Card withBorder radius="lg" padding="md">
      <Text fw={650}>{newWeek ? 'New week.' : 'New day.'} One block to restart.</Text>
      {what && <Text size="sm" c="dimmed" mt={2}>{what.task.title}</Text>}
      <Button mt="sm" leftSection={<IconPlayerPlay size={16} />} loading={busy} onClick={() => void start()}>Start {minutes} min</Button>
    </Card>
  );
}
