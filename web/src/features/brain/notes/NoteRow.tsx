import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import { type ReactNode } from 'react';

/** A clickable row: title, a small line under it, and something on the right. */
export function NoteRow({ title, sub, right, icon, selected, onOpen }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; icon?: ReactNode; selected?: boolean; onOpen: () => void }) {
  return (
    <Box component="li" className="cv-row" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <UnstyledButton
        onClick={onOpen}
        aria-current={selected || undefined}
        w="100%"
        px="md"
        py="sm"
        style={{ display: 'block', background: selected ? 'var(--mantine-primary-color-light)' : undefined }}
      >
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            {icon}
            <Box style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} lineClamp={1}>
                {title}
              </Text>
              {sub && (
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {sub}
                </Text>
              )}
            </Box>
          </Group>
          {right && (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {right}
            </Text>
          )}
        </Group>
      </UnstyledButton>
    </Box>
  );
}
