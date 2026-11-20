import { CloseButton, Group, Text } from '@mantine/core';
import { useState } from 'react';
import { DEMO } from '../api';

const KEY = 'mosaic.demoBanner';

function wasDismissed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Public demo only: one line saying the data is fictional. Dismissed for this tab session. */
export function DemoBanner() {
  const [hidden, setHidden] = useState(wasDismissed);
  if (!DEMO || hidden) return null;
  const close = () => {
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* storage blocked: hide for this render tree only */
    }
    setHidden(true);
  };
  return (
    <Group
      role="note"
      aria-label="Demo notice"
      gap="xs"
      justify="center"
      wrap="nowrap"
      px="md"
      py={4}
      style={{ background: 'var(--mantine-color-brand-light)', borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Text size="xs" c="var(--mantine-color-brand-light-color)" fw={500} style={{ flex: 1, textAlign: 'center' }}>
        Demo — data is fictional and resets on reload.
      </Text>
      <CloseButton size="lg" aria-label="Hide demo notice" onClick={close} />
    </Group>
  );
}
