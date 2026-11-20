import { useEffect, type RefObject } from 'react';
import { chat, stopRun, stopVoice } from '../chat';

/** Space talks (voice mode), Escape stops: mic first, then speech, then the run. */
export function useChatKeys(active: boolean, startTalk: () => void, dictRef: RefObject<{ on: boolean; stop: () => void }>) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[data-vaul-drawer], .mantine-Modal-content')) return;
      const el = e.target as HTMLElement | null;
      const typing = !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape') {
        if (dictRef.current.on) dictRef.current.stop();
        else if (chat.get().speaking) stopVoice();
        else if (chat.get().live && !typing) void stopRun();
        return;
      }
      if (typing || !chat.get().voice) return;
      if (e.key === ' ' && !e.repeat && !el?.closest?.('button, a')) {
        e.preventDefault();
        if (dictRef.current.on) dictRef.current.stop();
        else startTalk();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, startTalk]);
}
