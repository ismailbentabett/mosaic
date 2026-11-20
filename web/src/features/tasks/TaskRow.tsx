import { ActionIcon, Box, Checkbox, Group, Menu, Text, UnstyledButton } from '@mantine/core';
import { IconArrowsMove, IconCheck, IconDots, IconPencil, IconPin, IconRotate } from '@tabler/icons-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import type { V2Task } from '../../v2';

/** Row state: open, leaving (ticked, fading, about to collapse) or done (in the "Done today" group). */
export type TaskRowState = 'open' | 'leaving' | 'done';

export type TaskMetaOpts = {
  /** Hide the project name (Inbox view, project view). */
  hideProject?: boolean;
  /** Hide the due day (Today view, day groups in Upcoming). The time still shows. */
  hideDay?: boolean;
};

/** The quiet meta line under a task title: project · minutes · day. Never red, never "overdue". */
export function taskMeta(t: V2Task, o: TaskMetaOpts = {}): string[] {
  const meta: string[] = [];
  if (t.project_name && !o.hideProject) meta.push(t.project_name);
  if (t.est_minutes) meta.push(f.mins(t.est_minutes));
  if (t.status === 'done' && t.done_at) meta.push(`done ${f.ago(t.done_at)}`);
  else if (t.due_date && !o.hideDay) meta.push(f.due(t.due_date, t.due_time));
  else if (t.due_time) meta.push(f.hhmm(t.due_time));
  if (t.waiting_for) meta.push(`waiting on ${t.waiting_for}`);
  if (t.recur_text) meta.push(t.recur_text);
  if (t.someday) meta.push('someday');
  return meta;
}

export type TaskRowProps = TaskMetaOpts & {
  task: V2Task;
  state?: TaskRowState;
  /** Highlighted as the one open in the desktop detail pane. */
  selected?: boolean;
  /** Tick or untick. The parent does the optimistic work. */
  onToggle: (t: V2Task) => void;
  onEdit: (t: V2Task) => void;
  /** Row menu "Move" and the `m` key on a focused row. Hidden when absent. */
  onMove?: (t: V2Task) => void;
  /** Small trailing control, e.g. "Today" in Needs a day. */
  side?: ReactNode;
  /** Bulk select mode: the box picks the row instead of ticking it. */
  picking?: boolean;
  picked?: boolean;
  onPick?: (t: V2Task) => void;
};

/**
 * One task: a checkbox, a 2-line title, a first-action line and a quiet meta line.
 * Row menu: Edit, Done or Reopen, Move. Delete lives in the editor only.
 * Keyboard on the title: Enter edits, `x` ticks, `m` moves.
 */
export function TaskRow({
  task: t,
  state = t.status === 'done' ? 'done' : 'open',
  selected,
  onToggle,
  onEdit,
  onMove,
  side,
  hideProject,
  hideDay,
  picking,
  picked,
  onPick,
}: TaskRowProps) {
  const checked = state !== 'open';
  const meta = taskMeta(t, { hideProject, hideDay });
  const leaving = state === 'leaving';
  const metaId = `task-meta-${t.id}`;
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'm' && onMove && !picking) {
      e.preventDefault();
      e.stopPropagation();
      onMove(t);
    } else if (e.key === 'x') {
      e.preventDefault();
      e.stopPropagation();
      if (picking && onPick) onPick(t);
      else onToggle(t);
    }
  };
  const body = () => (picking && onPick ? onPick(t) : onEdit(t));
  return (
    <Group
      data-task={t.id}
      className="cv-row"
      gap="xs"
      wrap="nowrap"
      align="flex-start"
      px="sm"
      py={8}
      mih={52}
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        background: selected || picked ? 'var(--mantine-color-default-hover)' : undefined,
        opacity: leaving ? 0.45 : 1,
        transition: 'opacity 300ms ease, background 120ms ease',
      }}
    >
      {/* The label is the 44px hit area around the 24px box. */}
      <Box component="label" miw={44} mih={44} mt={-8} ml={-10} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        {picking ? (
          <Checkbox
            size="md"
            radius="sm"
            checked={!!picked}
            onChange={() => onPick?.(t)}
            aria-label={picked ? `Unselect ${t.title}` : `Select ${t.title}`}
          />
        ) : (
          <Checkbox
            size="md"
            radius="xl"
            color="teal"
            checked={checked}
            disabled={leaving}
            onChange={() => onToggle(t)}
            aria-label={checked ? `Reopen ${t.title}` : `Complete ${t.title}`}
          />
        )}
      </Box>
      <UnstyledButton
        onClick={body}
        onKeyDown={onKey}
        data-row-body
        aria-label={picking ? `Select ${t.title}` : `Edit ${t.title}`}
        aria-describedby={meta.length ? metaId : undefined}
        mih={44}
        style={{ flex: 1, minWidth: 0, borderRadius: 'var(--mantine-radius-sm)' }}
      >
        <Group gap={6} wrap="nowrap" align="flex-start">
          {t.pinned && <IconPin size={14} stroke={STROKE} style={{ flexShrink: 0, marginTop: 4, color: 'var(--mantine-color-dimmed)' }} aria-label="Pinned" />}
          <Text size="sm" fw={600} lineClamp={2} td={checked ? 'line-through' : undefined} c={checked ? 'dimmed' : undefined}>
            {t.title}
          </Text>
        </Group>
        {t.first_action && state === 'open' && (
          <Text size="xs" c="dimmed" lineClamp={1}>
            Start: {t.first_action}
          </Text>
        )}
        {meta.length > 0 && (
          <Text size="xs" c="dimmed" className="num" lineClamp={1} id={metaId}>
            {meta.join(' · ')}
          </Text>
        )}
      </UnstyledButton>
      {side && <Box style={{ flexShrink: 0 }}>{side}</Box>}
      {!picking && (
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="lg" aria-label={`Actions for ${t.title}`} disabled={leaving}>
              <IconDots size={18} stroke={STROKE} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPencil size={16} stroke={STROKE} />} onClick={() => onEdit(t)}>
              Edit
            </Menu.Item>
            <Menu.Item leftSection={checked ? <IconRotate size={16} stroke={STROKE} /> : <IconCheck size={16} stroke={STROKE} />} onClick={() => onToggle(t)}>
              {checked ? 'Reopen' : 'Done'}
            </Menu.Item>
            {onMove && state === 'open' && (
              <Menu.Item leftSection={<IconArrowsMove size={16} stroke={STROKE} />} onClick={() => onMove(t)}>
                Move
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  );
}
