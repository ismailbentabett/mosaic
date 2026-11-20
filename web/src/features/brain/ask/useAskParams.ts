import { useEffect, type RefObject } from 'react';
import { replace } from '../../../router';
import { chat, setVoice } from '../chat';
import { ASK } from './paths';

/** Query params: ?q= prefill, ?voice=1, ?ask= (voice hand-over), ?run= (send once). Returns ?run=. */
export function useAskParams(search: string, setInput: (v: string) => void, taRef: RefObject<HTMLTextAreaElement | null>) {
  const params = new URLSearchParams(search);
  const qParam = params.get('q');
  const voiceParam = params.get('voice');
  const askParam = params.get('ask');
  const runParam = params.get('run');
  useEffect(() => {
    if (qParam === null && voiceParam === null && askParam === null) return;
    if (voiceParam === '1') setVoice(true);
    if (qParam !== null) {
      setInput(qParam);
      window.setTimeout(() => taRef.current?.focus(), 0);
    }
    if (askParam) chat.set({ inbox: askParam });
    // ?run= is consumed by its own effect once the chat has loaded.
    replace(runParam ? `${ASK}?run=${encodeURIComponent(runParam)}` : ASK);
  }, [qParam, voiceParam, askParam, runParam, setInput]);
  return runParam;
}
