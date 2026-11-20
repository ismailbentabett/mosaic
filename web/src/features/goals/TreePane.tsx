import { Button, Divider, Group, Stack, Switch, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { PLACE_ICON, STROKE } from '../../app/icons';
import { grades, type GoalTemplate, type GoalV2 } from '../../grades';
import { useLoad, usePageActive } from '../../hooks';
import { go } from '../../router';
import { emit } from '../../store';
import { Async, Empty, Section } from '../../ui/Page';
import { deleteLater, Hint, useHidden } from '../review/kit';
import { GoalItem } from './GoalItem';
import { GoalSheet } from './GoalSheet';
import { BASE, useTree } from './shared';

/* ---------- Tree ---------- */

export function TreePane() {
  const active = usePageActive();
  const [all, setAll] = useState(false);
  const t = useTree(all);
  const md = useLoad(() => grades.quiet(), active, [], { key: 'quiet-areas' });
  const [showAll, setShowAll] = useState(false);
  const [sheet, setSheet] = useState<{ pick?: GoalTemplate; edit?: GoalV2 } | null>(null);
  const hidden = useHidden();
  const mode = md.data?.mode;
  const quietMode = mode === 'Zero' || mode === 'Family';
  const reload = () => void t.reload();

  if (quietMode && !showAll && t.data?.next_up) {
    return (
      <Section title={`${mode} mode · one thing`} icon={PLACE_ICON.goals}>
        <Stack gap="xs">
          <Text fw={600}>{t.data.next_up.next}</Text>
          <Hint>{t.data.next_up.goal}. Everything else waits, at no cost.</Hint>
          <Group>
            <Button variant="subtle" size="sm" onClick={() => setShowAll(true)}>
              Show all goals
            </Button>
          </Group>
        </Stack>
      </Section>
    );
  }

  return (
    <Stack gap="md">
      {t.data?.next_up && (
        <Section title="Next up" icon={PLACE_ICON.goals}>
          <Stack gap={4}>
            <Text fw={600}>{t.data.next_up.next}</Text>
            <Hint>
              {t.data.next_up.goal}
              {t.data.next_up.pace_line ? ` · ${t.data.next_up.pace_line}` : ''}
            </Hint>
          </Stack>
        </Section>
      )}
      <Group justify="space-between">
        <Button leftSection={<IconPlus size={16} stroke={STROKE} />} onClick={() => setSheet({})}>
          New goal
        </Button>
        <Switch label="Show done and let-go" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} />
      </Group>
      <Async state={t} label="Loading goals" lines={4}>
        {(d) => (
          <Stack gap="md">
            {d.count === 0 && (
              <Section title="Goals">
                <Empty
                  title="No goals yet."
                  icon={PLACE_ICON.goals}
                  action={
                    <Button variant="light" onClick={() => go(`${BASE}/templates`)}>
                      See templates
                    </Button>
                  }
                >
                  Pick a template: savings fund, read 12 books, run a 10 km, gym.
                </Empty>
              </Section>
            )}
            {d.areas
              .filter((a) => a.goals.some((g) => !hidden.has(g.id)))
              .map((a) => (
                <Section key={a.id ?? 'none'} title={a.name} hint={a.vision || undefined}>
                  <Stack gap={0}>
                    {a.goals
                      .filter((g) => !hidden.has(g.id))
                      .map((g, i) => (
                        <div key={g.id}>
                          {i > 0 && <Divider my="xs" />}
                          <GoalItem
                            g={g}
                            onChanged={reload}
                            onEdit={() => setSheet({ edit: g })}
                            onRemove={() =>
                              deleteLater({
                                text: `Removed ${g.name}`,
                                hide: () => hidden.hide(g.id),
                                restore: () => hidden.show(g.id),
                                run: () => grades.remove(g.id),
                                after: () => emit('goals'),
                              })
                            }
                          />
                        </div>
                      ))}
                  </Stack>
                </Section>
              ))}
            {d.count > 0 && <Hint>Pace compares the count with the date you set, not effort. Pick a new date or pause any time; it costs nothing.</Hint>}
          </Stack>
        )}
      </Async>
      <GoalSheet
        opened={!!sheet}
        onClose={() => setSheet(null)}
        areas={t.data?.areas ?? []}
        pick={sheet?.pick}
        edit={sheet?.edit}
        onMade={reload}
      />
    </Stack>
  );
}
