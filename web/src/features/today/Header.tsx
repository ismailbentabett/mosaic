import { ActionIcon, Badge, Button, Group, Menu, Stack, Text, Title } from '@mantine/core';
import { IconDots, IconLifebuoy } from '@tabler/icons-react';
import { type CalEvent, type Timer } from '../../api';
import { STROKE } from '../../app/icons';
import { splitEmoji } from '../../blocks';
import * as f from '../../fmt';
import { useLoad, useNow } from '../../hooks';
import { go } from '../../router';
import { dateAtNoon, hm, lifeYmd, longDay } from '../../time';
import { openMode } from '../../ui';
import { v2, type LifeSnapshot } from '../../v2';

// ---------------------------------------------------------------- header

export function Header({ mode, timer, active, rescue, onRescue }: { mode: string; timer: Timer | null; active: boolean; rescue: boolean; onRescue: () => void }) {
  return (
    <Stack gap={4}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Title order={1} fz={{ base: 'h3', sm: 'h2' }} lineClamp={1}>
            {longDay(dateAtNoon(lifeYmd()))}
          </Title>
          <Text size="sm" c="dimmed">
            <WeatherLine active={active} />
          </Text>
        </div>
        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
          {timer && <TimerPill timer={timer} active={active} />}
          <Button size="compact-md" variant="light" radius="md" hiddenFrom="sm" aria-label={`Mode: ${mode}. Change mode.`} onClick={openMode}>{mode}</Button>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Day actions"><IconDots size={18} stroke={STROKE} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={openMode}>Change mode</Menu.Item>
              {!rescue && <Menu.Item leftSection={<IconLifebuoy size={16} />} onClick={onRescue}>Bad day: shrink today</Menu.Item>}
              <Menu.Item onClick={() => go('/calendar')}>Open calendar</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </Stack>
  );
}

/** "London 18°C, clear · rain 20%". Approximate; hidden when the weather call fails. */
export function WeatherLine({ active }: { active: boolean }) {
  const w = useLoad(() => v2.weather(), active, [], { key: 'weather' }).data;
  if (!w || w.error || w.temp_c === undefined) return null;
  return (
    <span className="num" title={w.stale ? 'Last known weather' : undefined}>
      {w.place} {f.num(w.temp_c)}°C{w.text ? `, ${w.text.toLowerCase()}` : ''}
      {w.rain_pct ? ` · rain ${f.pct(w.rain_pct / 100)}` : ''}
    </span>
  );
}

export function TimerPill({ timer, active }: { timer: Timer; active: boolean }) {
  const now = useNow(active, 1000);
  const end = Date.parse(timer.endsAt);
  const left = Math.max(0, end - (timer.pausedAt ? Date.parse(timer.pausedAt) : now));
  return (
    <Badge size="lg" color={timer.pausedAt ? 'gray' : 'signal'} variant="filled" className="num">
      {f.clock(left)}
    </Badge>
  );
}

/** One quiet line under the priorities: the next block, else what is on today's list. */
export function Ambient({ s, events, now }: { s: LifeSnapshot; events: CalEvent[]; now: number }) {
  const next = events.filter((e) => !e.allDay && e.kind === 'block' && Date.parse(e.start) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  const done = s.done && !('error' in s.done) ? s.done.tasks : 0;
  const parts: string[] = [];
  if (next) parts.push(`Next: ${splitEmoji(next.blockName ?? next.baseTitle).rest} at ${hm(next.start)}`);
  if (done > 0) parts.push(`${f.plural(done, 'task')} done today`);
  if (!parts.length) return null;
  return <Text size="sm" c="dimmed">{parts.join(' · ')}</Text>;
}
