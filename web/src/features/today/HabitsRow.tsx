import { Chip, Group } from '@mantine/core';
import { useEffect, useState } from 'react';
import { PLACE_ICON } from '../../app/icons';
import { burst } from '../../fx';
import { act } from '../../hooks';
import { feel } from '../../sound';
import { Section } from '../../ui/Page';
import { v2, type Habit } from '../../v2';

export function HabitsRow({ habits, onChange }: { habits: Habit[]; onChange: () => void }) {
  const [list, setList] = useState(habits);
  useEffect(() => setList(habits), [habits]);
  const live = list.filter((h) => !h.archived);
  if (live.length === 0) return null;
  // Names, never counts: "Done: Reading, Water".
  const doneNames = live.filter((h) => h.today > 0).map((h) => h.name);
  const toggle = async (h: Habit, el: HTMLElement) => {
    const on = h.today > 0;
    const r = await act(v2.checkHabit(h.id, on ? 0 : 1));
    if (!r) return;
    if (!on) {
      feel('done');
      burst(el);
    }
    setList((xs) => xs.map((x) => (x.id === h.id ? (r as Habit) : x)));
    onChange();
  };
  return (
    <Section title="Habits" hint={doneNames.length ? `Done: ${doneNames.join(', ')}` : undefined} icon={PLACE_ICON.habits}>
      <Group gap={8}>
        {live.map((h) => (
          <Chip key={h.id} checked={h.today > 0} onClick={(e) => void toggle(h, e.currentTarget)} variant="light">
            {h.name}
          </Chip>
        ))}
      </Group>
    </Section>
  );
}
