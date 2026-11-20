import { useLoad } from '../../hooks';
import { life } from '../../life';
import { Notice } from '../../ui/Page';

/** The note written for this exercise last time. */
export function CarryForward({ exercise, active }: { exercise: string; active: boolean }) {
  const cf = useLoad(() => life.carryForward(exercise), active && !!exercise, [exercise]);
  const note = cf.data?.note;
  if (!note) return null;
  return <Notice>Last time you wrote: {note}</Notice>;
}
