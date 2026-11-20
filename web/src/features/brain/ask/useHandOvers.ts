import { useEffect, useRef, useState, type RefObject } from 'react';
import { replace } from '../../../router';
import { chat, send } from '../chat';
import { ASK } from './paths';

/** Work handed to the chat from elsewhere (voice sheet, mic doors, ?run=) and the reply announcement. Returns the text to announce. */
export function useHandOvers({
  active,
  st,
  startTalk,
  nearBottom,
  activeRef,
  runParam,
}: {
  active: boolean;
  st: ReturnType<typeof chat.get>;
  startTalk: () => void;
  nearBottom: RefObject<boolean>;
  activeRef: RefObject<boolean>;
  runParam: string | null;
}) {
  const [said, setSaid] = useState('');
  const consumed = useRef<string | null>(null);

  // A question handed over from the voice sheet: answered aloud once.
  useEffect(() => {
    if (!active || !st.inbox || st.loading) return;
    const q = st.inbox;
    chat.set({ inbox: null });
    nearBottom.current = true;
    void send(q, true);
  }, [active, st.inbox, st.loading]);

  // talkToAssistant() (every mic door): start listening once the page is up.
  useEffect(() => {
    if (!active || !st.listen || st.loading) return;
    chat.set({ listen: false });
    nearBottom.current = true;
    window.setTimeout(startTalk, 150);
  }, [active, st.listen, st.loading, startTalk]);

  // ?run=/what-now (from Home or a shortcut): send once, then drop the param.
  useEffect(() => {
    if (!active || !runParam || st.loading || consumed.current === runParam) return;
    consumed.current = runParam;
    replace(ASK);
    nearBottom.current = true;
    void send(runParam);
  }, [active, runParam, st.loading]);

  // One screen reader announcement per finished reply. Clearing first lets the same text repeat.
  useEffect(() => {
    if (!st.announce.seq) return;
    setSaid('');
    if (!activeRef.current) return;
    const id = window.setTimeout(() => setSaid(st.announce.text), 120);
    return () => window.clearTimeout(id);
  }, [st.announce.seq, st.announce.text]);
  return said;
}
