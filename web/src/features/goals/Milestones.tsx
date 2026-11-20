import { Checkbox, Group, Stack, Text } from '@mantine/core';
import { IconFlag, IconPencil, IconTrash } from '@tabler/icons-react';
import * as f from '../../fmt';
import { grades, type GoalV2, type Milestone } from '../../grades';
import { act } from '../../hooks';
import { emit, toast } from '../../store';
import { Async, Empty, IconBtn, Section } from '../../ui/Page';
import { deleteLater, Hint, LineForm, useAsk, useHidden } from '../review/kit';
import { goalsX } from './client';
import { goalsOf, isClosed, runGoal, useTree } from './shared';

/* ---------- Milestones ---------- */

export function MilestoneList({ g, onChanged, compact }: { g: GoalV2; onChanged: () => void; compact?: boolean }) {
  const hidden = useHidden();
  const [askNode, ask] = useAsk();
  const closed = isClosed(g);
  const tick = async (m: Milestone, done: boolean) => {
    const r = await act(grades.milestoneDone(m.id, done));
    if (!r) return;
    if (done && r.moment) toast(r.moment);
    onChanged();
    emit('goals');
  };
  const rename = (m: Milestone) =>
    ask({
      title: 'Milestone',
      label: 'Name',
      initial: m.name,
      save: 'Save',
      onSave: (v) => runGoal(goalsX.updateMilestone(m.id, { name: v }), 'Saved', onChanged),
    });
  const setDue = (m: Milestone) =>
    ask({
      title: 'Milestone date',
      label: 'By',
      type: 'date',
      initial: m.due ?? '',
      allowEmpty: true,
      hint: 'Blank clears the date.',
      save: 'Save',
      onSave: (v) => runGoal(goalsX.updateMilestone(m.id, { due: v || null }), v ? 'Date saved' : 'Date cleared', onChanged),
    });
  const remove = (m: Milestone) =>
    deleteLater({
      text: `Removed ${m.name}`,
      hide: () => hidden.hide(m.id),
      restore: () => hidden.show(m.id),
      run: () => grades.removeMilestone(m.id),
      after: () => {
        onChanged();
        emit('goals');
      },
    });
  const list = g.milestones.filter((m) => !hidden.has(m.id));
  return (
    <Stack gap={4}>
      {list.length === 0 && <Hint>None yet. Break it into 3–5 checkpoints you can see.</Hint>}
      {list.map((m) => (
        <Group key={m.id} justify="space-between" wrap="nowrap" gap="xs">
          <Checkbox
            checked={!!m.done_at}
            onChange={(e) => void tick(m, e.currentTarget.checked)}
            label={m.name}
            styles={{ body: { alignItems: 'center' } }}
            style={{ minWidth: 0, flex: 1 }}
          />
          <Group gap={2} wrap="nowrap">
            {m.due && (
              <Text size="xs" c="dimmed" className="num">
                {f.day(m.due)}
              </Text>
            )}
            {!compact && (
              <>
                <IconBtn icon={IconPencil} label={`Rename ${m.name}`} onClick={() => rename(m)} size="md" />
                <IconBtn icon={IconFlag} label={`Set date for ${m.name}`} onClick={() => setDue(m)} size="md" />
                <IconBtn icon={IconTrash} label={`Remove ${m.name}`} onClick={() => remove(m)} size="md" color="gray" />
              </>
            )}
          </Group>
        </Group>
      ))}
      {!closed && (
        <LineForm
          label={`New milestone for ${g.name}`}
          placeholder="New milestone"
          onSubmit={async (name) => {
            const ok = await act(grades.addMilestone(g.id, name), 'Milestone added');
            if (ok) {
              onChanged();
              emit('goals');
            }
            return !!ok;
          }}
        />
      )}
      {askNode}
    </Stack>
  );
}

export function MilestonesPane() {
  const t = useTree(false);
  return (
    <Async state={t} label="Loading milestones" lines={4}>
      {(d) => {
        const goals = goalsOf(d);
        if (goals.length === 0) {
          return (
            <Section title="Milestones" icon={IconFlag}>
              <Empty title="No goals yet.">Add a goal first, then break it into checkpoints.</Empty>
            </Section>
          );
        }
        return (
          <Stack gap="md">
            {goals.map((g) => {
              const done = g.milestones.filter((m) => m.done_at).length;
              return (
                <Section
                  key={g.id}
                  title={g.name}
                  right={
                    g.milestones.length ? (
                      <Text size="xs" c="dimmed" className="num">
                        {f.num(done)} of {f.num(g.milestones.length)}
                      </Text>
                    ) : undefined
                  }
                >
                  <MilestoneList g={g} onChanged={() => void t.reload()} />
                </Section>
              );
            })}
            <Hint>Ticking a milestone is optional. An open one costs nothing.</Hint>
          </Stack>
        );
      }}
    </Async>
  );
}
