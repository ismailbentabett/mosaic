import { Fragment, type ReactNode } from 'react';
import { type ChatFile } from '../../../api';
import { day } from '../../../fmt';
import { lifeYmd } from '../../../time';
import { Loading } from '../../../ui/Page';
import { speakable } from '../../../voice';
import { ChatBubble, DayDivider } from '../ChatParts';
import { type chat } from '../chat';
import { ProblemBlock } from './ProblemBlock';

export function Conversation({
  st,
  busy,
  emptyState,
  sendNow,
  editResend,
}: {
  st: ReturnType<typeof chat.get>;
  busy: boolean;
  emptyState: ReactNode;
  sendNow: (text: string, files?: ChatFile[]) => Promise<unknown>;
  editResend: (text: string, files?: ChatFile[]) => void;
}) {
  // Retry for an assistant message: the user message right before it, with its files.
  const promptBefore = (i: number): { text: string; files: ChatFile[] } | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      const m = st.messages[j]!;
      if (m.role === 'user') return { text: m.text, files: m.files ?? [] };
    }
    return undefined;
  };

  const empty = !st.loading && st.messages.length === 0 && !st.live;
  const lastAssistant = st.live ? -1 : st.messages.map((m) => m.role).lastIndexOf('assistant');
  const today = lifeYmd();

  return (
    <div className="ck-scroll">
      <div className="ck-col" style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
        {st.loading && st.messages.length === 0 && <Loading label="Loading chat" lines={4} />}
        {empty && emptyState}
        {(st.messages.length > 0 || st.live) && (
          <ol className="ck-list" aria-label="Conversation">
            {st.messages.map((m, i) => {
              const before = m.role === 'assistant' ? promptBefore(i) : undefined;
              const d = m.ts ? lifeYmd(m.ts) : '';
              const prev = i > 0 && st.messages[i - 1]!.ts ? lifeYmd(st.messages[i - 1]!.ts!) : '';
              const showDay = !!d && d !== prev && (i > 0 || d !== today);
              return (
                <Fragment key={`${i}-${m.ts}`}>
                  {showDay && <DayDivider label={day(d, today)} />}
                  <ChatBubble
                    role={m.role}
                    text={m.text}
                    ts={m.ts}
                    tools={m.tools}
                    files={m.files}
                    error={m.error}
                    last={i === lastAssistant}
                    onRetry={m.role === 'assistant' && !busy && before ? () => void sendNow(before.text, before.files) : undefined}
                    onEdit={m.role === 'user' && !busy ? () => editResend(m.text, m.files) : undefined}
                    speakText={m.role === 'assistant' && m.text && speakable(m.text) ? m.text : undefined}
                  />
                </Fragment>
              );
            })}
            {st.live && <ChatBubble role="assistant" text={st.live.text} tools={st.live.tools} streaming />}
          </ol>
        )}
        {st.problem && !st.live && <ProblemBlock busy={busy} onRetry={(t, f) => void sendNow(t, f)} />}
      </div>
    </div>
  );
}
