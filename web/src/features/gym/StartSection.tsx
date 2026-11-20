import { Button, NavLink, Stack, Text } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { ErrorState, Loading, Section } from '../../ui/Page';
import { type Routine } from '../../v2';
import { repRange } from './kit';

export function StartSection({
  routines,
  door,
  busy,
  onStart,
}: {
  routines: { data: Routine[] | null; error: import('../../api').ApiError | null; reload: () => void };
  door: Routine | null;
  busy: boolean;
  onStart: (id?: string) => void;
}) {
  // Today's suggested routine first.
  const list = [...(routines.data ?? [])].sort((a, z) => (a.id === door?.id ? -1 : z.id === door?.id ? 1 : 0));
  return (
    <Section title="Start" id="gym-start">
      {!routines.data && !routines.error && <Loading label="Loading routines" lines={2} />}
      {routines.error && !routines.data && <ErrorState error={routines.error} onRetry={() => void routines.reload()} />}
      {routines.data && routines.data.length === 0 && (
        <Text size="sm" c="dimmed" mb="sm">
          No routines yet. Start an empty workout and log sets as you go.
        </Text>
      )}
      <Stack gap={4} mb="sm">
        {list.map((r) => (
          <NavLink
            key={r.id}
            component="button"
            disabled={busy}
            active={r.id === door?.id}
            variant="light"
            label={`Start ${r.name}`}
            description={
              r.items
                .slice(0, 4)
                .map((i) => `${i.exercise_name} ${f.num(i.sets)}×${repRange(i.rep_min, i.rep_max)}`)
                .join(' · ') + (r.items.length > 4 ? ` · +${f.num(r.items.length - 4)}` : '')
            }
            rightSection={<IconPlayerPlay size={18} stroke={STROKE} />}
            onClick={() => onStart(r.id)}
          />
        ))}
      </Stack>
      <Button variant="default" disabled={busy} onClick={() => onStart()}>
        {busy ? 'Starting…' : 'Start empty workout'}
      </Button>
    </Section>
  );
}
