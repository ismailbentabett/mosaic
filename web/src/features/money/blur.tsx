// Blur money amounts (per device). Same storage key as the old Home card, so the choice carries over.
import { Box } from '@mantine/core';
import type { ReactNode } from 'react';
import { createStore, useStore } from '../../store';

const BLUR_KEY = 'mosaic.blurMoney';
function readBlur(): boolean {
  try {
    return localStorage.getItem(BLUR_KEY) === '1';
  } catch {
    return false;
  }
}
const blurStore = createStore({ on: readBlur() });

export function useMoneyBlur(): [boolean, () => void] {
  const { on } = useStore(blurStore);
  const toggle = () => {
    const next = !blurStore.get().on;
    try {
      localStorage.setItem(BLUR_KEY, next ? '1' : '0');
    } catch {
      /* storage blocked: session only */
    }
    blurStore.set({ on: next });
  };
  return [on, toggle];
}

/** Amounts inside are blurred while the toggle is on. */
export function Blur({ children, inline }: { children: ReactNode; inline?: boolean }) {
  const [on] = useMoneyBlur();
  return (
    <Box
      component={inline ? 'span' : 'div'}
      style={on ? { filter: 'blur(7px)', userSelect: 'none', transition: 'filter 150ms' } : { transition: 'filter 150ms' }}
      aria-hidden={on || undefined}
    >
      {children}
    </Box>
  );
}
