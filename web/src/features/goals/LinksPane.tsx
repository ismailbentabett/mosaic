import { Select, Stack } from '@mantine/core';
import { IconLink, IconUnlink } from '@tabler/icons-react';
import * as f from '../../fmt';
import type { GoalV2 } from '../../grades';
import { act, useLoad, usePageActive } from '../../hooks';
import { emit, toastUndo } from '../../store';
import { Async, Empty, IconBtn, Section } from '../../ui/Page';
import { v2 } from '../../v2';
import { Hint } from '../review/kit';
import { goalsX, type LinkKind } from './client';
import { goalsOf, isClosed, Row, runGoal, useTree } from './shared';

/* ---------- Links ---------- */

export function LinksPane() {
  const active = usePageActive();
  const t = useTree(false);
  const habits = useLoad(() => v2.habits(), active, [], { key: 'habits' });
  const projects = useLoad(() => v2.projects(), active, [], { key: 'projects' });
  const options = [
    { group: 'Habits', items: (habits.data ?? []).filter((h) => !h.archived).map((h) => ({ value: `habit:${h.id}`, label: h.name })) },
    { group: 'Projects', items: (projects.data ?? []).map((p) => ({ value: `project:${p.id}`, label: p.name })) },
  ];
  const link = async (g: GoalV2, value: string | null) => {
    if (!value) return;
    const [kind, ref] = value.split(/:(.*)/s) as [LinkKind, string];
    await runGoal(goalsX.link(g.id, kind, ref), 'Linked', () => void t.reload());
  };
  const unlink = async (g: GoalV2, kind: LinkKind, ref: string, name: string | null) => {
    const r = await act(goalsX.unlink(g.id, kind, ref));
    if (r === null) return;
    void t.reload();
    emit('goals');
    toastUndo(`Unlinked ${name ?? kind}`, () => void runGoal(goalsX.link(g.id, kind, ref), 'Linked again', () => void t.reload()));
  };
  return (
    <Async state={t} label="Loading goals" lines={4}>
      {(d) => {
        const goals = goalsOf(d).filter((g) => !isClosed(g));
        if (goals.length === 0) {
          return (
            <Section title="Links" icon={IconLink}>
              <Empty title="No goals yet.">Add a goal, then link a habit or a project that feeds it.</Empty>
            </Section>
          );
        }
        return (
          <Stack gap="md">
            {goals.map((g) => {
              const taken = new Set(g.links.map((l) => `${l.kind}:${l.ref}`));
              const data = options.map((o) => ({ group: o.group, items: o.items.filter((i) => !taken.has(i.value)) })).filter((o) => o.items.length);
              return (
                <Section key={g.id} title={g.name} icon={IconLink}>
                  <Stack gap={4}>
                    {g.links.length === 0 && <Hint>Nothing linked.</Hint>}
                    {g.links.map((l) => (
                      <Row
                        key={`${l.kind}${l.ref}`}
                        title={`${l.kind === 'habit' ? 'Habit' : 'Project'}: ${l.name ?? f.DASH}`}
                        sub={
                          l.kind === 'habit'
                            ? `${f.num(l.this_week ?? 0)} of ${f.num(l.target_per_week ?? 0)} this week`
                            : f.plural(l.open_tasks ?? 0, 'open task')
                        }
                        right={<IconBtn icon={IconUnlink} label={`Unlink ${l.name ?? l.kind}`} onClick={() => void unlink(g, l.kind, l.ref, l.name)} size="md" />}
                      />
                    ))}
                    {data.length > 0 && (
                      <Select
                        aria-label={`Link a habit or project to ${g.name}`}
                        placeholder="Link a habit or project"
                        data={data}
                        value={null}
                        onChange={(v) => void link(g, v)}
                        searchable
                        clearable={false}
                        comboboxProps={{ withinPortal: true }}
                      />
                    )}
                  </Stack>
                </Section>
              );
            })}
            <Hint>Linked habits and projects show their week next to the goal. They do not change the goal count.</Hint>
          </Stack>
        );
      }}
    </Async>
  );
}
