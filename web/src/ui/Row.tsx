import { Box, Text, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { STROKE, type AppIcon } from '../app/icons';

type RowProps = {
  /** Leading icon, or any node (checkbox, avatar). */
  icon?: AppIcon;
  lead?: ReactNode;
  title: ReactNode;
  /** Dimmed line under the title. */
  meta?: ReactNode;
  /** Right side: a value, a badge, buttons. */
  right?: ReactNode;
  /** Whole row tappable; shows a chevron unless `right` is set. */
  onClick?: () => void;
  /** Muted (done items). */
  dim?: boolean;
};

/** One list row: 56 px, lead, two-line title, meta, trailing value. The whole row is the target. */
export function Row({ icon: Icon, lead, title, meta, right, onClick, dim }: RowProps) {
  const body = (
    <>
      {Icon ? <Icon size={20} stroke={STROKE} style={{ flexShrink: 0, color: 'var(--mantine-color-dimmed)' }} /> : lead}
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={500} lineClamp={2} c={dim ? 'dimmed' : undefined} td={dim ? 'line-through' : undefined}>
          {title}
        </Text>
        {meta && (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {meta}
          </Text>
        )}
      </Box>
      {right ?? (onClick && <IconChevronRight size={16} stroke={STROKE} style={{ flexShrink: 0, color: 'var(--mantine-color-dimmed)' }} />)}
    </>
  );
  if (onClick && !right) {
    return (
      <UnstyledButton className="row-tap cv-row ui-row" onClick={onClick}>
        {body}
      </UnstyledButton>
    );
  }
  return (
    <Box
      className="cv-row ui-row"
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--mantine-spacing-sm)', cursor: onClick ? 'pointer' : undefined }}
    >
      {body}
    </Box>
  );
}
