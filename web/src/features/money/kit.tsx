// Small building blocks shared by the Money tabs.
import { Group, SimpleGrid, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Stat } from '../../ui/Page';
import { Blur } from './blur';
import * as f from '../../fmt';
import { useLoad, usePageActive } from '../../hooks';
import { useRefresh } from '../../store';
import { v2 } from '../../v2';

/**
 * Dollars first, euros second. The stored base is USD; the EUR figure uses the latest saved EUR rate.
 * Without a rate it shows USD only.
 */
export function useFx() {
  const active = usePageActive();
  const rates = useLoad(() => v2.rates(), active, [], { key: 'money.rates' });
  useRefresh('money', () => void rates.reload());
  const r = (rates.data ?? []).find((x) => x.currency === 'EUR');
  /** EUR for 1 USD, or null without a saved rate. */
  const perUsd = r && r.to_usd > 0 ? 1 / r.to_usd : null;
  const eur = (usd: number | null | undefined) => (usd == null || perUsd === null ? null : Math.round(usd * perUsd * 100) / 100);
  return {
    perUsd,
    /** Main figure: "$50". */
    main: (usd: number | null | undefined) => f.usd(usd),
    /** Secondary figure: "€46", or undefined without a rate. */
    sub: (usd: number | null | undefined) => {
      const e = eur(usd);
      return e === null ? undefined : f.money(e, 'EUR');
    },
    /** One line: "$50 (€46)". */
    both: (usd: number | null | undefined) => {
      const e = eur(usd);
      return e === null ? f.usd(usd) : `${f.usd(usd)} (${f.money(e, 'EUR')})`;
    },
  };
}

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF'];

export type ReadoutRow = { label: ReactNode; value: ReactNode; sub?: ReactNode; color?: string };

/** A row of labelled numbers; amounts blur with the toggle. */
export function Readout({ rows, cols = 3 }: { rows: ReadoutRow[]; cols?: number }) {
  return (
    <Blur>
      <SimpleGrid cols={{ base: Math.min(rows.length, 2), sm: Math.min(rows.length, cols) }} spacing="md" verticalSpacing="sm">
        {rows.map((r, i) => (
          <Stat key={i} label={r.label} value={r.value} sub={r.sub} color={r.color} />
        ))}
      </SimpleGrid>
    </Blur>
  );
}

/** A quiet line of help text. */
export function Hint({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" c="dimmed">
      {children}
    </Text>
  );
}

/** A plain list row: title and meta on the left, amount and actions on the right. */
export function Row({ title, meta, amount, actions }: { title: ReactNode; meta?: ReactNode; amount?: ReactNode; actions?: ReactNode }) {
  return (
    <Group className="cv-row" justify="space-between" wrap="nowrap" gap="sm" py={6} align="center">
      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" fw={600} truncate>
          {title}
        </Text>
        {meta && (
          <Text size="xs" c="dimmed" className="num" truncate>
            {meta}
          </Text>
        )}
      </Stack>
      {amount !== undefined && (
        <Text size="sm" fw={600} className="num" style={{ whiteSpace: 'nowrap' }}>
          <Blur inline>{amount}</Blur>
        </Text>
      )}
      {actions}
    </Group>
  );
}

/** NumberInput value → number (NaN when empty or not a number). */
export const toNum = (v: string | number): number => (typeof v === 'number' ? v : v.trim() ? Number(v.replace(',', '.')) : NaN);
