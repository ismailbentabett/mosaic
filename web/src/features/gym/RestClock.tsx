import { Button, Group, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import * as f from '../../fmt';
import { useNow, usePageActive } from '../../hooks';
import { feel } from '../../sound';

export function RestClock({ endsAt, label, chime, onClear }: { endsAt: string; label: string; chime: boolean; onClear: () => void }) {
  const active = usePageActive();
  const now = useNow(active, 250);
  const left = Date.parse(endsAt) - now;
  // Ring once, and only for a rest that was running while shown (not one that ended while away).
  const [rang, setRang] = useState(() => Date.parse(endsAt) <= Date.now());
  useEffect(() => {
    if (left <= 0 && !rang) {
      setRang(true);
      if (chime) {
        feel('timerEnd');
        try {
          navigator.vibrate?.([200, 100, 200]);
        } catch {
          /* no vibration on this device */
        }
      }
    }
  }, [left, rang, chime]);
  return (
    <Group justify="space-between" wrap="nowrap" role="timer" aria-label={`Rest for ${label}`}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <Text fz="var(--app-fz-stat)" fw={600} className="num" lh={1}>
          {left > 0 ? f.clock(left) : 'Go'}
        </Text>
        <Text size="sm" c="dimmed" aria-live="polite" lineClamp={1}>
          {left > 0 ? `Rest · ${label}` : `Next set · ${label}`}
        </Text>
      </Group>
      <Button size="xs" variant="subtle" onClick={onClear}>
        {left > 0 ? 'Skip rest' : 'Dismiss'}
      </Button>
    </Group>
  );
}
