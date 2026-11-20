import { useCallback, useRef, type RefObject } from 'react';
import { useDictation } from '../../../ui/Mic';
import { canListen } from '../../../voice';
import { takeFiles } from '../attach';
import { chat, send, stopVoice } from '../chat';

/** Dictation: fills the field; in voice mode the finished take is sent. */
export function useTalk({
  setInput,
  taRef,
  nearBottom,
  activeRef,
}: {
  setInput: (v: string) => void;
  taRef: RefObject<HTMLTextAreaElement | null>;
  nearBottom: RefObject<boolean>;
  activeRef: RefObject<boolean>;
}) {
  const dictBase = useRef('');
  const dict = useDictation({
    onText: (t) => setInput(dictBase.current && t ? dictBase.current.replace(/\s*$/, ' ') + t : dictBase.current + t),
    onEnd: (t) => {
      const full = (dictBase.current && t ? dictBase.current.replace(/\s*$/, ' ') + t : dictBase.current + t).trim();
      if (chat.get().voice && full && activeRef.current) {
        setInput('');
        nearBottom.current = true;
        void send(full, true, takeFiles());
      }
    },
  });
  const dictRef = useRef(dict);
  dictRef.current = dict;
  const startTalk = useCallback(() => {
    if (!canListen || !activeRef.current || dictRef.current.on) return;
    stopVoice();
    dictBase.current = chat.get().voice ? '' : (taRef.current?.value ?? '');
    if (chat.get().voice) setInput('');
    dictRef.current.start();
  }, [setInput]);
  const toggleTalk = () => (dict.on ? dict.stop() : startTalk());
  return { dict, dictRef, startTalk, toggleTalk };
}
