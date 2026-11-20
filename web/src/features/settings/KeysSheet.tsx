import { Group, Kbd, Stack, Text } from '@mantine/core';
import { Fragment } from 'react';
import { SHORTCUTS } from '../../app/Shortcuts';
import { useStore } from '../../store';
import { closeKeys, ui } from '../../ui';
import { Sheet } from '../../ui/Sheet';

type Row = { keys: string[]; label: string };

/** Two letters starting with g are pressed one after the other; anything else is held together. */
const isSequence = (keys: string[]) => keys.length > 1 && keys[0] === 'g';

function Keys({ keys }: { keys: string[] }) {
  const joiner = isSequence(keys) ? 'then' : '+';
  return (
    <Group gap={4} wrap="nowrap">
      {keys.map((k, i) => (
        <Fragment key={k + i}>
          {i > 0 && (
            <Text span size="xs" c="dimmed">
              {joiner}
            </Text>
          )}
          <Kbd size="sm">{k}</Kbd>
        </Fragment>
      ))}
    </Group>
  );
}

function Group_({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed" fw={600} tt="uppercase">
        {title}
      </Text>
      {rows.map((r) => (
        <Group key={r.keys.join('-') + r.label} justify="space-between" wrap="nowrap" gap="sm">
          <Text size="sm">{r.label}</Text>
          <Keys keys={r.keys} />
        </Group>
      ))}
    </Stack>
  );
}

/** The keyboard shortcut list. Opens from `ui.keys` (press ?). */
export function KeysSheet() {
  const { keys: opened } = useStore(ui);
  const goTo = SHORTCUTS.filter((s) => isSequence(s.keys) || /^\d$/.test(s.keys[0] ?? ''));
  const doRows = SHORTCUTS.filter((s) => !goTo.includes(s));
  return (
    <Sheet opened={opened} onClose={closeKeys} title="Keyboard shortcuts" size="sm">
      <Stack gap="lg">
        <Group_ title="Go to" rows={goTo} />
        <Group_ title="Do" rows={doRows} />
        <Text size="xs" c="dimmed">
          Shortcuts pause while you type in a field.
        </Text>
      </Stack>
    </Sheet>
  );
}
