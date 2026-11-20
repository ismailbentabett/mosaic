// Goals: shared loader, helpers and row used by every tab.
import { Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { grades, type GoalTree, type GoalV2 } from '../../grades';
import { act, useLoad, usePageActive } from '../../hooks';
import { emit, useRefresh } from '../../store';

export const BASE = '/life/goals';

/* ---------- shared ---------- */

export function useTree(all = false) {
  const active = usePageActive();
  const t = useLoad(() => grades.tree(all ? 'all' : 'active'), active, [all], { key: `goals2:${all ? 'all' : 'active'}` });
  useRefresh('goals', () => void t.reload());
  return t;
}

export const goalsOf = (t: GoalTree): GoalV2[] => t.areas.flatMap((a) => a.goals);
export const isClosed = (g: GoalV2) => g.status === 'done' || g.status === 'dropped';
export const isSavings = (g: GoalV2) => !!g.auto && g.auto.startsWith('savings:') && !isClosed(g);

/** Run a goal action, toast, refresh everything that shows goals. */
export async function runGoal(p: Promise<unknown>, ok: string, after?: () => void): Promise<boolean> {
  const r = await act(p, ok);
  if (r === null) return false;
  after?.();
  emit('goals');
  return true;
}

export function Row({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" py={4}>
      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" fw={600} lineClamp={2}>
          {title}
        </Text>
        {sub ? (
          <Text size="xs" c="dimmed" lineClamp={3}>
            {sub}
          </Text>
        ) : null}
      </Stack>
      {right ? (
        <Group gap={4} wrap="nowrap">
          {right}
        </Group>
      ) : null}
    </Group>
  );
}
