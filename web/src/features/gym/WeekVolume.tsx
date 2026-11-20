import { Text } from '@mantine/core';
import * as f from '../../fmt';
import { useLoad } from '../../hooks';
import { useRefresh } from '../../store';
import { v2 } from '../../v2';

/** Weekly working sets per muscle (Monday week), from /gym/volume. */
export function WeekVolume({ active }: { active: boolean }) {
  const v = useLoad(() => v2.gymVolume(), active, [], { key: 'gym.volume' });
  useRefresh('gym', () => void v.reload());
  const rows = (v.data ?? []).filter((r) => r.sets > 0);
  if (!rows.length) return null;
  return (
    <Text size="sm" c="dimmed" className="num" mt="xs">
      This week: {rows.map((r) => `${r.muscle} ${f.num(r.sets)}`).join(' · ')} sets
    </Text>
  );
}
