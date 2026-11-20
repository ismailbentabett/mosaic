import { Box, Group, Modal, ScrollArea, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { useOverlayBack } from '../app/back';

type Props = {
  opened: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Right side of the title row (an action button). */
  right?: ReactNode;
  children: ReactNode;
  /** Desktop modal width. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Sticky bottom row (save buttons). */
  footer?: ReactNode;
  /** Fill most of the phone screen (editors, chat). */
  tall?: boolean;
  /** Skip autofocus trap in the desktop modal (QuickAdd focuses its own input). */
  trapFocus?: boolean;
};

/** True below 48em (phones): bottom sheets and the bottom bar. */
export function usePhone(): boolean {
  return useMediaQuery('(max-width: 47.99em)', typeof window !== 'undefined' ? window.innerWidth < 768 : true, {
    getInitialValueInEffect: false,
  });
}

/**
 * The one overlay: a swipeable vaul bottom sheet on phones, a centred Mantine modal on larger screens.
 * Registers itself on the Android back stack.
 */
export function Sheet({ opened, onClose, title, right, children, size = 'md', footer, tall, trapFocus = true }: Props) {
  const phone = usePhone();
  useOverlayBack(opened, onClose);

  if (!phone) {
    return (
      <Modal
        opened={opened}
        onClose={onClose}
        size={size}
        trapFocus={trapFocus}
        title={
          title || right ? (
            <Group justify="space-between" wrap="nowrap" gap="sm" w="100%">
              {typeof title === 'string' ? <Title order={4}>{title}</Title> : title}
              {right}
            </Group>
          ) : undefined
        }
        styles={{ title: { flex: 1 } }}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {children}
        {footer && (
          <Box pt="md" mt="md" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
            {footer}
          </Box>
        )}
      </Modal>
    );
  }

  return (
    <Drawer.Root open={opened} onOpenChange={(o) => !o && onClose()} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="vaul-overlay" />
        <Drawer.Content className="vaul-content" data-tall={tall ? 'true' : undefined} aria-describedby={undefined}>
          <div className="vaul-handle" aria-hidden="true" />
          {title || right ? (
            <Group justify="space-between" wrap="nowrap" px="md" pb="xs" gap="sm">
              <Drawer.Title asChild>
                {typeof title === 'string' ? (
                  <Title order={4}>{title}</Title>
                ) : (
                  <div>{title}</div>
                )}
              </Drawer.Title>
              {right}
            </Group>
          ) : (
            <Drawer.Title asChild>
              <Text className="sr-only">Sheet</Text>
            </Drawer.Title>
          )}
          <div className="vaul-body">{children}</div>
          {footer && <div className="vaul-footer">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
