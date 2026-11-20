import { useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { closeMode, ui } from '../../ui';
import { Sheet } from '../../ui/Sheet';
import { ModeList } from './ModeList';

/** Mode picker as a sheet. Opens from `ui.mode`; closes shortly after a change lands. */
export function ModeSheet() {
  const { mode: opened } = useStore(ui);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Sheet opened={opened} onClose={closeMode} title="Mode" size="sm">
      {opened && (
        <ModeList
          onChanged={() => {
            clearTimeout(timer.current);
            timer.current = window.setTimeout(closeMode, 350);
          }}
        />
      )}
    </Sheet>
  );
}
