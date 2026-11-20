import { Badge, Button, Collapse, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { grades, type GoalInput, type GoalV2 } from '../../grades';
import { go } from '../../router';
import { toast } from '../../store';
import { lifeYmd } from '../../time';
import { IconBtn, Notice } from '../../ui/Page';
import { v2 } from '../../v2';
import { Hint, LineForm, Meter, parseNum, useAsk } from '../review/kit';
import { MilestoneList } from './Milestones';
import { isClosed, isSavings, runGoal } from './shared';
import { WhatIfSlider } from './WhatIf';

export function GoalItem({ g, onChanged, onEdit, onRemove }: { g: GoalV2; onChanged: () => void; onEdit: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [askNode, ask] = useAsk();
  const paused = g.status === 'paused';
  const closed = isClosed(g);
  const shaky = !closed && !paused && g.confidence !== null && g.confidence <= 2;
  const hasFloor = g.floor !== null && g.floor !== g.target_value;
  const run = (p: Promise<unknown>, ok: string) => runGoal(p, ok, onChanged);

  const premortem = () => {
    const text = `Pre-mortem for my goal "${g.name}": imagine it is ${f.day(g.target_date ?? lifeYmd())} and it did not happen. List the 3 most likely reasons and one small change for each. Now at ${g.current ?? 'nothing yet'} of ${g.target_value ?? '?'} ${g.unit ?? ''}. ${g.pace_line}`;
    go(`/chat?run=${encodeURIComponent(text)}`);
  };
  // Re-pace moves only the date; start day and progress so far stay.
  const newDate = () =>
    ask({
      title: 'New date',
      label: 'New target date',
      type: 'date',
      initial: g.target_date ?? '',
      allowEmpty: true,
      hint: 'Progress so far stays. Blank = a date that fits your pace so far.',
      save: 'Save',
      onSave: (v) => {
        if (v && v <= lifeYmd()) {
          toast('Pick a date after today');
          return false;
        }
        return run(grades.repace(g.id, v || undefined), 'Date moved');
      },
    });
  const options = (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <Button size="xs" variant="light">
          Options
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {hasFloor && <Menu.Item onClick={() => void run(grades.shrink(g.id), 'Target is now the floor')}>Shrink to floor</Menu.Item>}
        <Menu.Item onClick={newDate}>New date</Menu.Item>
        <Menu.Item onClick={premortem}>Pre-mortem in chat</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
  const editNext = () =>
    ask({
      title: 'Next step',
      label: 'Verb first, one small thing',
      initial: g.next_step || g.next || '',
      save: 'Save',
      onSave: (v) => run(grades.update(g.id, { next_step: v }), 'Next step saved'),
    });
  const setLine = (kind: 'floor_value' | 'stretch_value', label: string, cur: number | null) =>
    ask({
      title: label,
      label: `${label}${g.unit ? ` (${g.unit})` : ''}`,
      initial: cur !== null ? String(cur) : '',
      numeric: true,
      allowEmpty: true,
      hint: 'Blank clears it.',
      save: 'Save',
      onSave: async (v) => {
        const n = parseNum(v);
        if (v && n === null) {
          toast('Type a number');
          return false;
        }
        return run(grades.update(g.id, { [kind]: n } as GoalInput), `${label} saved`);
      },
    });

  return (
    <Stack gap={6}>
      <UnstyledButton className="tap-row" w="100%" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text fw={600} size="sm" style={{ minWidth: 0 }} lineClamp={2} td={g.status === 'dropped' ? 'line-through' : undefined}>
            {g.name}
          </Text>
          {g.outcome ? (
            <Badge variant="default" size="sm">
              info
            </Badge>
          ) : g.progress !== null && !closed ? (
            <Text size="xs" c="dimmed" className="num">
              {f.pct(g.progress)}
            </Text>
          ) : null}
        </Group>
      </UnstyledButton>
      {g.target_value !== null && g.progress !== null && <Meter value={g.progress} max={1} label={`${g.name} progress`} />}
      <Text size="xs" c="dimmed" className="num">
        {g.current !== null ? f.unit(g.current, g.unit) : 'No value yet'}
        {g.target_value !== null && ` of ${f.unit(g.target_value, g.unit)}`}
        {g.target_date && ` · by ${f.day(g.target_date)}`}
        {paused && ' · paused'}
        {g.status === 'done' && ' · done'}
        {g.status === 'dropped' && ' · let go'}
      </Text>
      {g.pace_line && !closed && <Hint>{g.pace_line}</Hint>}
      {!closed && (hasFloor || g.stretch_value !== null) && (
        <Text size="xs" c="dimmed" className="num">
          {hasFloor && `Floor ${f.unit(g.floor, g.unit)}`}
          {hasFloor && g.stretch_value !== null && ' · '}
          {g.stretch_value !== null && `Stretch ${f.unit(g.stretch_value, g.unit)}${g.stretch_note ? ` · ${g.stretch_note}` : ''}`}
        </Text>
      )}
      {shaky && (
        <Notice>
          <Stack gap={6}>
            <Text size="sm">This one feels shaky this week. Options, none required:</Text>
            <Group gap="xs">{options}</Group>
          </Stack>
        </Notice>
      )}
      {!closed && !paused && (g.next || g.next_step) && (
        <UnstyledButton className="tap" onClick={editNext} aria-label="Change next step">
          <Group gap={6} wrap="nowrap">
            <Badge size="sm" variant="light">
              Next
            </Badge>
            <Text size="sm" lineClamp={2}>
              {g.next || g.next_step}
            </Text>
          </Group>
        </UnstyledButton>
      )}
      <Collapse expanded={open}>
        <Stack gap="xs" pt={4}>
          {g.why && <Hint>Why: {g.why}</Hint>}
          {g.auto && <Hint>Counts itself from: {g.auto.replace(':', ' → ')}</Hint>}
          {isSavings(g) && open && <WhatIfSlider id={g.id} />}
          {!g.auto && !closed && (
            <LineForm
              label={`New value for ${g.name}`}
              placeholder={`Now at… ${g.unit ?? ''}`.trim()}
              button="Update"
              numeric
              onSubmit={async (v) => {
                const n = parseNum(v);
                if (n === null) {
                  toast('Type a number');
                  return false;
                }
                return run(v2.goalValue(g.id, n), 'Updated');
              }}
            />
          )}
          {g.links.length > 0 && (
            <Stack gap={2}>
              {g.links.map((l) => (
                <Text key={`${l.kind}${l.ref}`} size="xs" c="dimmed" className="num">
                  {l.kind === 'habit'
                    ? `Habit: ${l.name ?? f.DASH} · ${f.num(l.this_week ?? 0)} of ${f.num(l.target_per_week ?? 0)} this week`
                    : `Project: ${l.name ?? f.DASH} · ${f.plural(l.open_tasks ?? 0, 'open task')}`}
                </Text>
              ))}
            </Stack>
          )}
          <Text size="xs" fw={600} tt="uppercase" c="dimmed">
            Milestones
          </Text>
          <MilestoneList g={g} onChanged={onChanged} compact />
          <Group gap="xs">
            {!closed && (
              <Button size="xs" variant="default" onClick={() => setLine('floor_value', 'Floor (the smallest version that still counts)', g.floor)}>
                Set floor
              </Button>
            )}
            {!closed && (
              <Button size="xs" variant="default" onClick={() => setLine('stretch_value', 'Stretch target', g.stretch_value)}>
                Set stretch
              </Button>
            )}
            {!closed && !paused && !g.next && !g.next_step && (
              <Button size="xs" variant="default" onClick={editNext}>
                Set next step
              </Button>
            )}
          </Group>
          <Group gap="xs">
            {!closed && !paused && !shaky && options}
            {!closed && !paused && (
              <Button size="xs" variant="light" onClick={() => void run(grades.pause(g.id), 'Paused. The date moves when you resume.')}>
                Pause
              </Button>
            )}
            {paused && (
              <Button size="xs" onClick={() => void run(grades.resume(g.id), 'Resumed')}>
                Resume
              </Button>
            )}
            {!closed && (
              <Button size="xs" variant="light" onClick={() => void run(grades.finish(g.id, 'done'), 'Marked done')}>
                Done
              </Button>
            )}
            {!closed && (
              <Button size="xs" variant="subtle" color="gray" onClick={() => void run(grades.finish(g.id, 'dropped'), 'Let go. That is a decision, not a failure.')}>
                Let go
              </Button>
            )}
            {closed && (
              <Button size="xs" variant="light" onClick={() => void run(grades.reopen(g.id), 'Reopened')}>
                Reopen
              </Button>
            )}
          </Group>
          <Group gap={4} justify="flex-end">
            <IconBtn icon={IconPencil} label="Edit goal" onClick={onEdit} size="md" />
            <IconBtn icon={IconTrash} label="Remove goal" onClick={onRemove} size="md" color="gray" />
          </Group>
        </Stack>
      </Collapse>
      {askNode}
    </Stack>
  );
}
