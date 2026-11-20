import { ActionIcon, Card, Group, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { burst } from '../../fx';
import { act } from '../../hooks';
import { feel } from '../../sound';
import { emit, toastUndo } from '../../store';
import { v2, type V2Task } from '../../v2';

// ---------------------------------------------------------------- priorities, habits, timeline

export function MustRow({ task, onChange }: { task: V2Task; onChange: () => void }) {
  const doneNow = task.status === 'done';
  const toggle = async (el: HTMLElement) => {
    const r = await act(doneNow ? v2.reopen(task.id) : v2.done(task.id));
    if (!r) return;
    if (!doneNow) {
      feel('done');
      burst(el);
      toastUndo(`Done: ${task.title}`, () => void v2.reopen(task.id).then(() => emit('tasks')));
    }
    emit('tasks');
    onChange();
  };
  return (
    <Card withBorder radius="md" padding="sm">
      <Group wrap="nowrap" gap="sm">
        <ActionIcon size="lg" color="brand" variant={doneNow ? 'filled' : 'default'} radius="xl" aria-label={doneNow ? `Mark not done: ${task.title}` : `Mark done: ${task.title}`} aria-pressed={doneNow} onClick={(e) => void toggle(e.currentTarget)}>
          <IconCheck size={18} />
        </ActionIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} td={doneNow ? 'line-through' : undefined} lineClamp={2}>{task.title}</Text>
          {task.est_minutes ? <Text size="xs" c="dimmed">{task.est_minutes}m{task.done_def ? ` · DONE = ${task.done_def}` : ''}</Text> : null}
        </div>
      </Group>
    </Card>
  );
}
