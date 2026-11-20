import { Box, Stack, Text } from '@mantine/core';
import { IconFileUpload } from '@tabler/icons-react';
import { STROKE } from '../../../app/icons';

/** Full-page veil while files are dragged over the chat. */
export function DropOverlay() {
  return (
    <Box
      pos="fixed"
      inset={0}
      style={{
        zIndex: 400,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        background: 'color-mix(in srgb, var(--mantine-color-body) 80%, transparent)',
        border: '2px dashed var(--mantine-primary-color-filled)',
      }}
    >
      <Stack align="center" gap={6}>
        <IconFileUpload size={40} stroke={STROKE} />
        <Text fw={600}>Drop to attach</Text>
      </Stack>
    </Box>
  );
}
