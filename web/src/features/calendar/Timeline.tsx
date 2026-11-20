// Read-only day views of calendar events: a vertical timeline (DayTimeline) and a one-line strip (DayStrip).
import { Badge, Box, Group, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { Fragment } from 'react';
import type { CalEvent, TodayData } from '../../api';
import { ANCHOR_ICON, BLOCK_COLOR, BLOCK_ICON, STROKE } from '../../app/icons';
import { anchorKind, blockDone, blockType, splitEmoji, timeline } from '../../blocks';
import * as f from '../../fmt';
import { localInputToIso } from '../../time';

const HOUR = 3600000;
const DAY_START = '06:00';
/** 06:00 to 23:00, the waking day. */
const DAY_HOURS = 17;
const DAY_END = '23:00';

export const ANCHOR_LABEL = { meal: 'Meal', sleep: 'Sleep', other: 'Fixed' } as const;

export const startOf = (e: CalEvent) => Date.parse(e.start);
export const endOf = (e: CalEvent) => Date.parse(e.end);
/** HH:MM in local time, from an ISO string or epoch ms. */
export const at = (t: number | string) => f.time(typeof t === 'number' ? new Date(t).toISOString() : t);
/** A title with the leading emoji removed. Emoji never show in the UI; icons carry the meaning. */
export const plain = (title: string) => splitEmoji(title).rest;
/** Block name for display: "Deep work", never the emoji or the appended task. */
export const nameOf = (e: CalEvent) => plain(e.blockName ?? e.baseTitle);

/** Icon and colour for one event. Blocks get BLOCK_ICON / BLOCK_COLOR, anchors ANCHOR_ICON in grey. */
export function eventLook(e: CalEvent) {
  const kind = anchorKind(e);
  const type = blockType(e);
  if (e.kind === 'block' || !kind) return { Icon: BLOCK_ICON[type], color: BLOCK_COLOR[type], label: null as string | null };
  return { Icon: ANCHOR_ICON[kind], color: 'gray', label: ANCHOR_LABEL[kind] as string };
}

export type DayTimelineProps = {
  /** A today payload (api.today(date)). */
  data?: TodayData | null;
  /** Or a plain list of events (blocks and anchors). All-day events are left out. */
  blocks?: CalEvent[];
  /** Alias of `blocks`. */
  events?: CalEvent[];
  /** Defaults to the current time. Pass a ticking value to move the now marker. */
  now?: number;
  /** Week view: one line per event, no meta line, no now row. */
  compact?: boolean;
  /** Shown when there are no timed events. */
  emptyText?: string;
};

/**
 * Vertical timeline. Time column on the left, an icon in the block's colour, the block name and its task.
 * The live event is marked (aria-current="time"); past rows are dimmed; a now row sits in a gap.
 * Anchors (meal, sleep) are quiet grey rows. Read-only.
 */
export function DayTimeline({ data, blocks, events, now = Date.now(), compact, emptyText = 'Nothing on the calendar' }: DayTimelineProps) {
  const timed = timeline(blocks ?? events ?? data?.events ?? []);
  if (!timed.length) {
    return (
      <Text size="sm" c="dimmed" py={compact ? 4 : 'sm'} px={compact ? 0 : 'sm'}>
        {emptyText}
      </Text>
    );
  }
  const live =
    timed.find((e) => e.kind === 'block' && startOf(e) <= now && now < endOf(e)) ?? timed.find((e) => startOf(e) <= now && now < endOf(e));
  const gapIndex = live ? -1 : timed.findIndex((e) => startOf(e) > now);
  const inDay = now >= startOf(timed[0]!) && now < Math.max(...timed.map(endOf));

  return (
    <Box component="ol" m={0} p={0} style={{ listStyle: 'none' }} aria-label={`${f.plural(timed.filter((e) => e.kind === 'block').length, 'block')}`}>
      {timed.map((e, i) => (
        <Fragment key={e.id}>
          {!compact && inDay && i === gapIndex && <NowRow now={now} />}
          {compact ? <CompactRow e={e} now={now} live={e === live} /> : <Row e={e} now={now} live={e === live} />}
        </Fragment>
      ))}
    </Box>
  );
}

function NowRow({ now }: { now: number }) {
  return (
    <Box component="li" py={4}>
      <Group gap="xs" wrap="nowrap" align="center">
        <Text size="xs" fw={600} c="signal" w={44} className="num">
          <span className="sr-only">Now </span>
          {at(now)}
        </Text>
        <Box h={2} style={{ flex: 1, background: 'var(--mantine-color-signal-filled)', borderRadius: 1 }} aria-hidden="true" />
      </Group>
    </Box>
  );
}

function Row({ e, now, live }: { e: CalEvent; now: number; live: boolean }) {
  const block = e.kind === 'block';
  const past = endOf(e) <= now;
  const { Icon, color, label } = eventLook(e);
  const rest = plain(e.baseTitle);
  const pos = live ? Math.min(100, Math.max(0, ((now - startOf(e)) / Math.max(1, endOf(e) - startOf(e))) * 100)) : 0;
  return (
    <Box
      component="li"
      aria-current={live ? 'time' : undefined}
      data-past={past && !live ? true : undefined}
      py={block ? 8 : 4}
      px="xs"
      pos="relative"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        background: live ? `var(--mantine-color-${color}-light)` : undefined,
      }}
    >
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Text component="time" dateTime={e.start} size="xs" c="dimmed" w={44} pt={block ? 4 : 2} className="num" style={{ flexShrink: 0 }}>
          {at(e.start)}
        </Text>
        <ThemeIcon variant={block ? 'light' : 'transparent'} color={color} size={block ? 28 : 22} radius="md" style={{ flexShrink: 0 }} aria-hidden="true">
          <Icon size={block ? 16 : 14} stroke={STROKE} />
        </ThemeIcon>
        {block ? (
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text size="sm" fw={600} lineClamp={1}>
                {nameOf(e)}
              </Text>
              {e.must && (
                <Badge size="xs" variant="filled" color={color}>
                  Priority
                </Badge>
              )}
              {live && <span className="sr-only">, happening now</span>}
            </Group>
            <Text size="sm" c={e.task ? undefined : 'dimmed'} fs={e.task ? undefined : 'italic'} lineClamp={2}>
              {e.task ?? 'No task yet'}
              {blockDone(e) ? (
                <Text component="span" size="sm" c="brand">
                  , done
                </Text>
              ) : null}
            </Text>
            <Text size="xs" c="dimmed" className="num">
              {at(e.start)}–{at(e.end)}
              {e.minutes ? ` · ${f.minutes(e.minutes)}` : ''}
            </Text>
          </Box>
        ) : (
          <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }} pt={2}>
            <Text size="sm" c="dimmed" lineClamp={1}>
              {rest}
            </Text>
            <Text size="xs" c="dimmed">
              {label ?? 'Fixed'}
            </Text>
            {live && <span className="sr-only">, happening now</span>}
          </Group>
        )}
      </Group>
      {live && (
        <Box
          aria-hidden="true"
          pos="absolute"
          left={0}
          right={0}
          h={2}
          style={{ top: `${pos}%`, background: 'var(--mantine-color-signal-filled)', opacity: 0.8 }}
        />
      )}
    </Box>
  );
}

function CompactRow({ e, now, live }: { e: CalEvent; now: number; live: boolean }) {
  const block = e.kind === 'block';
  const past = endOf(e) <= now;
  const { Icon, color } = eventLook(e);
  const text = block ? (e.task ?? nameOf(e)) : plain(e.baseTitle);
  const tip = block ? `${nameOf(e)}${e.task ? `: ${e.task}` : ''}, ${at(e.start)}–${at(e.end)}` : `${plain(e.baseTitle)}, ${at(e.start)}–${at(e.end)}`;
  return (
    <Box
      component="li"
      aria-current={live ? 'time' : undefined}
      data-past={past && !live ? true : undefined}
      py={2}
      px={4}
      style={{
        borderRadius: 'var(--mantine-radius-sm)',
        background: live ? `var(--mantine-color-${color}-light)` : undefined,
      }}
    >
      <Tooltip label={tip} openDelay={400} withinPortal multiline maw={280}>
        <Group gap={6} wrap="nowrap" align="center">
          <Text component="time" dateTime={e.start} size="xs" c="dimmed" w={36} className="num" style={{ flexShrink: 0 }}>
            {at(e.start)}
          </Text>
          <Icon size={14} stroke={STROKE} color={`var(--mantine-color-${color}-${block ? 'filled' : '5'})`} style={{ flexShrink: 0 }} aria-hidden="true" />
          <Text size="xs" fw={block ? 500 : 400} c={block ? undefined : 'dimmed'} lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
            {text}
            {e.must ? <span className="sr-only">, priority</span> : null}
            {blockDone(e) ? <span className="sr-only">, done</span> : null}
          </Text>
          {e.must && (
            <Box w={6} h={6} style={{ flexShrink: 0, borderRadius: 3, background: `var(--mantine-color-${color}-filled)` }} aria-hidden="true" />
          )}
        </Group>
      </Tooltip>
    </Box>
  );
}

/** The waking day (06:00 to 23:00) as one strip. Blocks in colour, anchors grey, past shaded, now as a thin line. */
export function DayStrip({ date, events, now = Date.now() }: { date: string; events: CalEvent[]; now?: number }) {
  const from = Date.parse(localInputToIso(`${date}T${DAY_START}`) ?? `${date}T${DAY_START}:00Z`);
  const to = from + DAY_HOURS * HOUR;
  const pct = (t: number) => ((Math.min(Math.max(t, from), to) - from) / (to - from)) * 100;
  const timed = events
    .filter((e) => !e.allDay && endOf(e) > from && startOf(e) < to)
    .sort((a, b) => Number(a.kind === 'block') - Number(b.kind === 'block'));
  const blocks = timed.filter((e) => e.kind === 'block');
  const done = blocks.filter((e) => endOf(e) <= now).length;
  const nowIn = now >= from && now < to;
  const ticks: number[] = [];
  for (let h = 12; h <= 24; h += 2) ticks.push(from + (h - 10.5) * HOUR);

  return (
    <Box
      component="figure"
      m={0}
      role="img"
      aria-label={`Day from ${DAY_START} to ${DAY_END}. ${f.plural(blocks.length, 'block')}, ${f.num(done)} behind you.${nowIn ? ` Now ${at(now)}.` : ''}`}
    >
      <Box pos="relative" h={14} style={{ borderRadius: 7, overflow: 'hidden', background: 'var(--mantine-color-default-hover)' }}>
        {nowIn && (
          <Box pos="absolute" top={0} bottom={0} left={0} style={{ width: `${pct(now)}%`, background: 'var(--mantine-color-default-border)', opacity: 0.6 }} />
        )}
        {timed.map((e) => {
          const block = e.kind === 'block';
          const left = pct(startOf(e));
          const width = Math.max(0.6, pct(endOf(e)) - left);
          const live = startOf(e) <= now && now < endOf(e);
          const past = endOf(e) <= now;
          const color = BLOCK_COLOR[blockType(e)];
          return (
            <Box
              key={e.id}
              pos="absolute"
              top={block ? 0 : 4}
              bottom={block ? 0 : 4}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                borderRadius: 3,
                background: block ? `var(--mantine-color-${color}-filled)` : 'var(--mantine-color-gray-5)',
                opacity: past ? 0.45 : live ? 1 : 0.85,
                outline: live ? '2px solid var(--mantine-color-body)' : undefined,
              }}
              title={`${at(e.start)}–${at(e.end)} ${plain(e.baseTitle)}`}
            />
          );
        })}
        {nowIn && <Box pos="absolute" top={0} bottom={0} w={2} style={{ left: `${pct(now)}%`, background: 'var(--mantine-color-signal-filled)' }} />}
      </Box>
      <Box pos="relative" h={16} mt={2} aria-hidden="true">
        {ticks.map((t) => (
          <Text
            key={t}
            component="span"
            size="xs"
            c="dimmed"
            className="num"
            pos="absolute"
            style={{ left: `${pct(t)}%`, transform: 'translateX(-50%)', lineHeight: '16px' }}
          >
            {at(t).slice(0, 2)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

/** All-day events (banners, week bar) as quiet chips, emoji stripped. */
export function AllDayChips({ events }: { events: CalEvent[] }) {
  const chips = events.filter((e) => e.allDay);
  if (!chips.length) return null;
  return (
    <Group gap={6} component="ul" m={0} p={0} style={{ listStyle: 'none' }} aria-label="All-day">
      {chips.map((c) => (
        <Box component="li" key={c.id}>
          <Badge variant="light" color={c.kind === 'banner' ? 'gray' : 'blue'} tt="none" fw={600} size="lg" radius="sm" maw="100%">
            {plain(c.title)}
          </Badge>
        </Box>
      ))}
    </Group>
  );
}

