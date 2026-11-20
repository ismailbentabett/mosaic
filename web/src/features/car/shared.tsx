// Car: shared helpers, rows and the overview loader used by every tab.
import { Badge, Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import * as f from '../../fmt';
import { useLoad } from '../../hooks';
import { emit, useRefresh } from '../../store';
import { carApi, type DueItem } from './client';

export const BASE = '/life/car';

/* ---------- shared ---------- */

export type NumVal = number | string;
export const optNum = (v: NumVal): number | undefined => (v === '' || v === null || !Number.isFinite(Number(v)) ? undefined : Number(v));
export const km = (n: number | null | undefined) => f.unit(n, 'km', 0);
export const changed = (withMoney: boolean) => (withMoney ? emit('car', 'money') : emit('car'));

export function useOverview(active: boolean) {
  const o = useLoad(() => carApi.overview(), active, [], { key: 'car.overview' });
  useRefresh('car', () => void o.reload());
  return o;
}

export const STATE_BADGE: Record<DueItem['state'], { label: string; color: string }> = {
  due: { label: 'Now', color: 'yellow' },
  soon: { label: 'Soon', color: 'yellow' },
  later: { label: 'Later', color: 'gray' },
};

export function DueRow({ d }: { d: DueItem }) {
  const b = STATE_BADGE[d.state];
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="sm" fw={600} truncate>
          {d.title}
        </Text>
        <Text size="xs" c="dimmed">
          {d.line}
        </Text>
      </Stack>
      <Badge variant={d.state === 'later' ? 'outline' : 'light'} color={b.color} size="sm">
        {b.label}
      </Badge>
    </Group>
  );
}

export function Row({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" align="center">
      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" fw={600} truncate>
          {title}
        </Text>
        {sub && (
          <Text size="xs" c="dimmed">
            {sub}
          </Text>
        )}
      </Stack>
      {right}
    </Group>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(2, 4)}`;

/** Router link usable as a Mantine Button `component`. */
export function LinkButton({ to, children, ...rest }: { to: string; children?: ReactNode } & Record<string, unknown>) {
  return (
    <a href={`#${to}`} {...rest}>
      {children}
    </a>
  );
}

export const cap = (s: string) => (s.length <= 3 && s === s.toUpperCase() ? s : s.charAt(0).toUpperCase() + s.slice(1));
