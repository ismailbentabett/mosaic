import { ActionIcon, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconBrandWhatsapp, IconPhone } from '@tabler/icons-react';
import { type ReactNode } from 'react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';

/** One list row: text on the left, actions on the right. */
export function Row({ title, sub, right, onClick }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  const body = (
    <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
      <Text size="sm" fw={600} lineClamp={2}>
        {title}
      </Text>
      {sub ? (
        <Text size="xs" c="dimmed" lineClamp={2}>
          {sub}
        </Text>
      ) : null}
    </Stack>
  );
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" py={4}>
      {onClick ? (
        <UnstyledButton className="tap-row" onClick={onClick} style={{ minWidth: 0, flex: 1 }}>
          {body}
        </UnstyledButton>
      ) : (
        body
      )}
      {right ? (
        <Group gap={4} wrap="nowrap">
          {right}
        </Group>
      ) : null}
    </Group>
  );
}

const MONTH_DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** "03-14" → "Mar 14". */
export const md = (v: string | null | undefined) => {
  if (!v) return f.DASH;
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(v);
  return m ? MONTH_DAY.format(new Date(`2000-${m[1]}-${m[2]}T12:00:00Z`)) : v;
};
export const sinceText = (days: number | null | undefined) =>
  days === null || days === undefined ? 'no contact logged' : days <= 0 ? 'talked today' : `last ${f.plural(days, 'day')} ago`;

/** Call and WhatsApp links when a phone is saved. Opens the phone app; nothing is sent from here. */
export function ReachLinks({ name, phone }: { name: string; phone?: string | null }) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  const wa = digits.replace(/^\+/, '').replace(/^00/, '');
  return (
    <>
      <ActionIcon component="a" href={`tel:${digits}`} size="lg" variant="subtle" aria-label={`Call ${name}`} title={`Call ${name}`}>
        <IconPhone size={20} stroke={STROKE} />
      </ActionIcon>
      <ActionIcon
        component="a"
        href={`https://wa.me/${wa}`}
        target="_blank"
        rel="noopener noreferrer"
        size="lg"
        variant="subtle"
        aria-label={`WhatsApp ${name}`}
        title={`WhatsApp ${name}`}
      >
        <IconBrandWhatsapp size={20} stroke={STROKE} />
      </ActionIcon>
    </>
  );
}
