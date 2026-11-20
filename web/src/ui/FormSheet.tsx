import { Button, Group, Stack } from '@mantine/core';
import type { FormEvent, ReactNode } from 'react';
import { Sheet } from './Sheet';

type Props = {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Runs on Save or Enter. */
  onSave: () => void | Promise<void>;
  saveLabel?: string;
  saving?: boolean;
  /** Save disabled until the form is valid. */
  canSave?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Extra left-side footer action (Delete). */
  extra?: ReactNode;
};

/** A form in the one overlay: fields, then a sticky Cancel / Save row. */
export function FormSheet({ opened, onClose, title, children, onSave, saveLabel = 'Save', saving, canSave = true, size, extra }: Props) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSave && !saving) void onSave();
  };
  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={title}
      size={size}
      footer={
        <Group justify="space-between" wrap="nowrap">
          <div>{extra}</div>
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="form-sheet" loading={saving} disabled={!canSave}>
              {saveLabel}
            </Button>
          </Group>
        </Group>
      }
    >
      <form id="form-sheet" onSubmit={submit}>
        <Stack gap="sm">{children}</Stack>
      </form>
    </Sheet>
  );
}
