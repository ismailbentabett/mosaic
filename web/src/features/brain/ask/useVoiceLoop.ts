import { useEffect, useRef, type RefObject } from 'react';
import { chat, stopVoice } from '../chat';

// Voice mode: listen again once a spoken reply has finished.
export function useRelisten(spokenSeq: number, startTalk: () => void, activeRef: RefObject<boolean>) {
  const lastSpoken = useRef(spokenSeq);
  useEffect(() => {
    if (spokenSeq === lastSpoken.current) return;
    lastSpoken.current = spokenSeq;
    if (chat.get().voice && activeRef.current) window.setTimeout(startTalk, 350);
  }, [spokenSeq, startTalk]);
}

// Leaving the page (or hiding the tab) stops the mic and the voice; the run finishes in the background.
export function useStopOnLeave(active: boolean, dictRef: RefObject<{ stop: () => void }>) {
  useEffect(() => {
    if (active) return;
    dictRef.current.stop();
    stopVoice();
  }, [active]);
  useEffect(
    () => () => {
      dictRef.current.stop();
      stopVoice();
    },
    [],
  );
}
