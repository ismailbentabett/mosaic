// Body › Screen time: totals, per device, top apps and sites, by day, devices (forget = two taps).
import { Button, Group, Progress, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { feel } from '../../sound';
import { toast } from '../../store';
import { Async, Empty, Section, Stat } from '../../ui/Page';
import { v2 } from '../../v2';

type Range = '1' | '7' | '30';
const ARM_MS = 4000;

/** Two-tap confirm: the first tap arms one key, the second within 4 s runs it. */
function useArm(): [string | null, (key: string, run: () => void) => void] {
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const tap = (key: string, run: () => void) => {
    window.clearTimeout(timer.current);
    if (armed === key) {
      setArmed(null);
      run();
      return;
    }
    feel('tap');
    setArmed(key);
    timer.current = window.setTimeout(() => setArmed(null), ARM_MS);
  };
  return [armed, tap];
}

function Bar({ label, sub, minutes, max }: { label: string; sub?: string; minutes: number; max: number }) {
  return (
    <Stack gap={2}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" truncate style={{ minWidth: 0 }}>
          {label}
          {sub && (
            <Text span size="xs" c="dimmed">
              {' '}
              · {sub}
            </Text>
          )}
        </Text>
        <Text size="sm" className="num" style={{ flexShrink: 0 }}>
          {f.minutes(minutes)}
        </Text>
      </Group>
      <Progress value={max > 0 ? (minutes / max) * 100 : 0} size="sm" aria-label={`${label} minutes`} />
    </Stack>
  );
}

export function ScreenTime() {
  const active = usePageActive();
  const [days, setDays] = useState<Range>('1');
  const s = useLoad(() => v2.screentime(Number(days)), active, [days], { key: `body.screen.${days}` });
  const [armed, tap] = useArm();
  const forget = (device: string) =>
    tap(device, () => {
      void act(v2.forgetDevice(device)).then((r) => {
        if (r) toast(`Forgot ${device} (${f.plural(r.removed_rows, 'row')})`);
        void s.reload();
      });
    });

  return (
    <>
      <SegmentedControl
        fullWidth
        aria-label="Screen time range"
        value={days}
        onChange={(v) => {
          feel('tap');
          setDays(v as Range);
        }}
        data={[
          { value: '1', label: 'Today' },
          { value: '7', label: '7 days' },
          { value: '30', label: '30 days' },
        ]}
      />
      <Async state={s} label="Loading screen time" lines={4}>
        {(d) => {
          if (d.devices.length === 0)
            return (
              <Empty title="No device is sending screen time yet.">Set up ActivityWatch on the PC and the phone. Steps: runbooks/screen-time.md.</Empty>
            );
          const topMax = d.top_apps.reduce((m, a) => Math.max(m, a.minutes), 0);
          const dayMax = d.by_day.reduce((m, a) => Math.max(m, a.minutes), 0);
          return (
            <>
              <Section title="Total">
                <SimpleGrid cols={{ base: 2, sm: 4 }}>
                  <Stat label={days === '1' ? 'Today' : f.plural(d.days, 'day')} value={<span className="num">{f.minutes(d.total_minutes)}</span>} />
                  {days !== '1' && <Stat label="Per day" value={<span className="num">{f.minutes(d.avg_minutes_per_day)}</span>} sub="average" />}
                  {d.per_device.map((p) => (
                    <Stat key={p.device} label={p.device} value={<span className="num">{f.minutes(p.minutes)}</span>} sub={p.kind ?? undefined} />
                  ))}
                </SimpleGrid>
              </Section>

              {d.top_apps.length > 0 && (
                <Section title="Apps and sites">
                  <Stack gap="sm">
                    {d.top_apps.map((a) => (
                      <Bar key={`${a.app}-${a.kind}`} label={a.app} sub={a.devices.join(', ')} minutes={a.minutes} max={topMax} />
                    ))}
                  </Stack>
                </Section>
              )}

              {days !== '1' && d.by_day.length > 0 && (
                <Section title="By day">
                  <Stack gap="sm">
                    {d.by_day.map((b) => (
                      <Bar key={b.day} label={f.day(b.day)} minutes={b.minutes} max={dayMax} />
                    ))}
                  </Stack>
                </Section>
              )}

              <Section title="Devices">
                <Stack gap="xs">
                  {d.devices.map((x) => (
                    <Group key={x.device} justify="space-between" wrap="nowrap">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" truncate>
                          {x.device}
                        </Text>
                        <Text size="xs" c="dimmed" className="num">
                          {x.kind} · last sync {f.ago(x.last_sync)}
                        </Text>
                      </div>
                      <Button size="compact-sm" variant={armed === x.device ? 'light' : 'subtle'} color={armed === x.device ? 'red' : 'gray'} onClick={() => forget(x.device)}>
                        {armed === x.device ? 'Delete its rows?' : 'Forget'}
                      </Button>
                    </Group>
                  ))}
                </Stack>
              </Section>

              {d.note && (
                <Text size="xs" c="dimmed">
                  {d.note}
                </Text>
              )}
            </>
          );
        }}
      </Async>
    </>
  );
}
