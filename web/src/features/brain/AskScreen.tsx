// Chat: the home screen. Streaming chat with the assistant; history rail on desktop, its own view on phones.
// Query params: ?q= prefills, ?run= sends once, ?ask= sends once and answers aloud, ?voice=1 turns voice on.
// Attach photos and files (button, camera, paste, drop); talk with the big mic when the field is empty.
import { ActionIcon, Button, VisuallyHidden } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowDown, IconMicrophone, IconPlayerStopFilled } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { type ChatFile } from '../../api';
import { STROKE } from '../../app/icons';
import { BRAND } from '../../brand';
import { copy } from '../../copy';
import { usePageActive, usePageSearch } from '../../hooks';
import { feel } from '../../sound';
import { toast, useStore } from '../../store';
import { useTitle } from '../../ui/Page';
import { canListen, canSpeak } from '../../voice';
import { ACCEPT, addFiles, attachments, removeFile, restoreFiles, takeFiles } from './attach';
import { Composer, PendingChips } from './ChatParts';
import { COMMANDS, FILES_ONLY, PHASE_TEXT, boot, chat, newChat, send, setVoice, stopRun, type Phase } from './chat';
import './chat.css';
import { ChatBar } from './ask/ChatBar';
import { CommandPalette } from './ask/CommandPalette';
import { ComposerTools } from './ask/ComposerTools';
import { Conversation } from './ask/Conversation';
import { DropOverlay } from './ask/DropOverlay';
import { EmptyState } from './ask/EmptyState';
import { HistoryView, Rail, useChats } from './ask/history';
import { ASK } from './ask/paths';
import { useAskParams } from './ask/useAskParams';
import { useChatKeys } from './ask/useChatKeys';
import { useChatScroll } from './ask/useChatScroll';
import { useCommandPalette } from './ask/useCommandPalette';
import { useFileDrop } from './ask/useFileDrop';
import { useHandOvers } from './ask/useHandOvers';
import { useTalk } from './ask/useTalk';
import { useRelisten, useStopOnLeave } from './ask/useVoiceLoop';

/** The unsent text survives switching to history and back. */
let draft = '';

export function AskScreen() {
  return (
    <Routes>
      <Route index element={<AskMain />} />
      <Route path="history" element={<HistoryView />} />
      <Route path="*" element={<Navigate to={ASK} replace />} />
    </Routes>
  );
}

// ---------- chat ----------

function AskMain() {
  const active = usePageActive();
  const search = usePageSearch();
  const desktop = useMediaQuery('(min-width: 64em)');
  const st = useStore(chat);
  const [input, setInputState] = useState(draft);
  const setInput = useCallback((v: string) => {
    draft = v;
    setInputState(v);
  }, []);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottom = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  useTitle('Chat');

  const running = !!st.live;
  const busy = running || st.sending;
  const voiceAvailable = canListen || canSpeak;
  const att = useStore(attachments);
  const readyFiles = att.items.some((x) => x.status === 'ready');
  const uploading = att.items.some((x) => x.status === 'uploading');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const chats = useChats();
  const title = (st.chatId && chats.data?.find((c) => c.id === st.chatId)?.title) || 'New chat';

  useEffect(() => boot(), []);

  const runParam = useAskParams(search, setInput, taRef);

  // ---- dictation: fills the field; in voice mode the finished take is sent ----
  const { dict, dictRef, startTalk, toggleTalk } = useTalk({ setInput, taRef, nearBottom, activeRef });

  const phase: Phase = dict.on ? 'listening' : busy ? 'thinking' : st.speaking ? 'speaking' : 'idle';

  useRelisten(st.spokenSeq, startTalk, activeRef);

  const said = useHandOvers({ active, st, startTalk, nearBottom, activeRef, runParam });

  useStopOnLeave(active, dictRef);

  useChatKeys(active, startTalk, dictRef);

  // ---- scrolling (the window scrolls): follow new content at the bottom, else offer Jump to latest ----
  const { jump, scrolled, toBottom } = useChatScroll(active, running, st, nearBottom);

  const sendNow = async (text: string, files: ChatFile[] = []) => {
    toBottom();
    return send(text, undefined, files);
  };

  // ---- attachments: paste and drop anywhere on the page ----
  const pickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(e.currentTarget.files);
    e.currentTarget.value = '';
    taRef.current?.focus();
  };
  useFileDrop(active, setDragging, taRef);
  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  // The big mic when the field is empty. No speech recognition here: the keyboard's own mic.
  const talk = () => {
    if (canListen) {
      toggleTalk();
      return;
    }
    taRef.current?.focus();
    toast('Tap the mic on your keyboard to talk.');
  };

  // ---- composer + commands ----
  const { matches, paletteOpen, setSel, selIdx, onKeyDown } = useCommandPalette(input, busy, setInput);

  const submit = () => {
    const text = matches.length > 0 && !COMMANDS.some((c) => c.cmd === input) ? matches[selIdx]!.cmd : input;
    if ((!text.trim() && !readyFiles) || busy || uploading) return;
    if (dict.on) dict.stop();
    setInput('');
    void sendNow(text, takeFiles());
  };
  const runCommand = (cmd: string) => {
    setInput('');
    void sendNow(cmd);
  };
  const openCommands = () => {
    setInput('/');
    taRef.current?.focus();
  };
  const focusEnd = () =>
    window.setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  const editResend = (text: string, files?: ChatFile[]) => {
    if (files?.length) restoreFiles(files);
    setInput(files?.length && FILES_ONLY.test(text) ? '' : text);
    focusEnd();
  };

  const startNew = () => {
    if (!newChat()) return;
    setInput('');
    taRef.current?.focus();
  };
  const toggleVoice = () => {
    const on = !st.voice;
    setVoice(on);
    if (!on && dict.on) dict.stop();
    feel('tap');
    toast(on ? 'Voice on. Replies are read aloud.' : 'Voice off');
  };

  const halo = dict.on
    ? { boxShadow: '0 0 0 calc(2px + var(--cap-level, 0) * 10px) color-mix(in srgb, var(--mantine-color-signal-filled) 28%, transparent)', transition: 'box-shadow 80ms linear' }
    : undefined;

  const footer = (
    <div className="ck-foot">
      <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={pickFiles} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pickFiles} />
      {dragging && <DropOverlay />}
      <div className="ck-col" style={{ position: 'relative' }}>
        {jump && (
          <Button className="ck-jump" size="compact-sm" variant="default" radius="xl" leftSection={<IconArrowDown size={14} stroke={STROKE} />} onClick={() => toBottom()}>
            Jump to latest
          </Button>
        )}

        {st.voice && (
          <div className="ck-voice" id="chat-voice-state" data-phase={phase} aria-live="polite">
            <span className="ck-voice-dot" aria-hidden="true" />
            {PHASE_TEXT[phase]}
          </div>
        )}

        {paletteOpen && <CommandPalette matches={matches} selIdx={selIdx} setSel={setSel} runCommand={runCommand} />}

        <Composer
          id="claude-input"
          inputRef={taRef}
          value={input}
          onChange={setInput}
          onSubmit={submit}
          label={`Message ${BRAND.assistant}`}
          placeholder={running ? `${BRAND.assistant} is answering…` : dict.on ? 'Listening…' : copy.askPlaceholder}
          running={running}
          onStop={() => void stopRun()}
          sendDisabled={st.sending || uploading}
          hasFiles={readyFiles}
          onPaste={onPaste}
          ariaProps={{
            role: 'combobox',
            'aria-expanded': paletteOpen,
            'aria-controls': paletteOpen ? 'chat-palette' : undefined,
            'aria-activedescendant': paletteOpen ? `chat-cmd-${selIdx}` : undefined,
            'aria-autocomplete': 'list',
          }}
          top={att.items.length > 0 ? <PendingChips items={att.items} onRemove={removeFile} /> : undefined}
          idle={
            <ActionIcon
              ref={dict.levelRef as (el: HTMLButtonElement | null) => void}
              size={36}
              radius="xl"
              variant="filled"
              color={dict.on ? 'signal' : undefined}
              aria-pressed={dict.on}
              aria-label={dict.on ? 'Stop listening' : 'Talk'}
              aria-keyshortcuts={st.voice ? 'Space' : undefined}
              onClick={talk}
              style={halo}
            >
              {dict.on ? <IconPlayerStopFilled size={16} /> : <IconMicrophone size={20} stroke={STROKE} />}
            </ActionIcon>
          }
          describedBy={st.voice ? 'chat-voice-state' : undefined}
          onKeyDown={onKeyDown}
          before={<ComposerTools camRef={camRef} fileRef={fileRef} busy={busy} openCommands={openCommands} />}
          after={
            canListen && !running && (input.trim().length > 0 || readyFiles) ? (
              <ActionIcon
                ref={dict.levelRef as (el: HTMLButtonElement | null) => void}
                size={34}
                radius="xl"
                variant={dict.on ? 'filled' : 'subtle'}
                color={dict.on ? 'signal' : 'gray'}
                aria-pressed={dict.on}
                aria-label={dict.on ? 'Stop listening' : st.voice ? 'Talk' : 'Dictate a message'}
                aria-keyshortcuts={st.voice ? 'Space' : undefined}
                onClick={toggleTalk}
                style={halo}
              >
                {dict.on ? <IconPlayerStopFilled size={16} /> : <IconMicrophone size={19} stroke={STROKE} />}
              </ActionIcon>
            ) : undefined
          }
        />
        <p className="ck-hint">Enter to send · Shift+Enter for a new line · / for commands</p>
      </div>
    </div>
  );

  return (
    <div className="ck">
      {desktop && <Rail busy={busy} onNew={startNew} />}
      <main className="ck-main" aria-label="Chat">
        <ChatBar
          desktop={desktop}
          scrolled={scrolled}
          title={title}
          voiceAvailable={voiceAvailable}
          voice={st.voice}
          hasMessages={st.messages.length > 0}
          busy={busy}
          onToggleVoice={toggleVoice}
          onNew={startNew}
        />
        <Conversation
          st={st}
          busy={busy}
          emptyState={<EmptyState busy={busy} sendNow={sendNow} setInput={setInput} camRef={camRef} focusEnd={focusEnd} />}
          sendNow={sendNow}
          editResend={editResend}
        />
        {footer}
      </main>
      {/* One announcement per finished reply, not per token. */}
      <VisuallyHidden aria-live="polite" aria-atomic="true">
        {said}
      </VisuallyHidden>
    </div>
  );
}
