import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef } from 'react';
import { dismissToast, toasts, useStore, type ToastItem } from '../store';

/**
 * Bridges the app-wide `toasts` store (toast(), toastUndo()) to Mantine notifications.
 * Each toast shows once; closing it (timer, swipe, button) removes it from the store.
 */
export function Notify() {
  const { items } = useStore(toasts);
  const shown = useRef(new Set<number>());

  useEffect(() => {
    const live = new Set(items.map((t) => t.id));
    for (const t of items) {
      if (shown.current.has(t.id)) continue;
      shown.current.add(t.id);
      show(t);
    }
    // Toasts dismissed from code (dismissToast) close their notification too.
    for (const id of [...shown.current]) {
      if (!live.has(id)) {
        shown.current.delete(id);
        notifications.hide(String(id));
      }
    }
  }, [items]);

  return null;
}

function show(t: ToastItem) {
  const id = String(t.id);
  notifications.show({
    id,
    autoClose: t.sticky ? false : t.timeout,
    withCloseButton: true,
    radius: 'md',
    onClose: () => dismissToast(t.id),
    message: (
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm" style={{ minWidth: 0 }}>
          {t.text}
        </Text>
        {t.action && (
          <Button
            size="compact-sm"
            variant="light"
            onClick={() => {
              const run = t.action!.run;
              notifications.hide(id);
              dismissToast(t.id);
              run();
            }}
          >
            {t.action.label}
          </Button>
        )}
      </Group>
    ),
  });
}
