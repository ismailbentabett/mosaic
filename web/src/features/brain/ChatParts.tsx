// Ask conversation pieces: one message, and the composer.
import { ActionIcon, Box, Group, Loader, Modal, Paper, Stack, Text, Textarea, Tooltip, UnstyledButton, VisuallyHidden } from '@mantine/core';
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFileText,
  IconFileTypePdf,
  IconPencil,
  IconPhoto,
  IconPlayerStopFilled,
  IconRefresh,
  IconSparkles,
  IconTool,
  IconVolume,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { canSpeak, isSpeaking, speak, stopSpeaking } from '../../voice';
import { chatFileUrl, type ChatFile, type ToolStep } from '../../api';
import { fileSize, isImage, type Pending } from './attach';
import { FILES_ONLY } from './chat';
import { STROKE } from '../../app/icons';
import { BRAND } from '../../brand';
import { copy } from '../../copy';
import { time } from '../../fmt';
import { toast } from '../../store';
import { Md } from '../../ui/Md';
import { WriteChips } from './writes';

/** Copies to the clipboard, with a textarea fallback for older WebViews. Never throws. */
export async function copyText(text: string) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    } finally {
      ta.remove();
    }
  }
  toast(ok ? copy.toast.copied : 'Could not copy. Select the text instead.');
}

/** Object URL for a chat file (authed fetch, cached). Null while loading or when it failed. */
function useFileUrl(id: string | undefined, fallback?: string) {
  const [src, setSrc] = useState<string | null>(fallback ?? null);
  useEffect(() => {
    if (!id || fallback) return;
    let live = true;
    chatFileUrl(id).then(
      (u) => live && setSrc(u),
      () => live && setSrc(null),
    );
    return () => {
      live = false;
    };
  }, [id, fallback]);
  return src;
}

const FileIcon = ({ type, size = 18 }: { type: string; size?: number }) =>
  type === 'application/pdf' ? <IconFileTypePdf size={size} stroke={STROKE} aria-hidden="true" /> : isImage(type) ? <IconPhoto size={size} stroke={STROKE} aria-hidden="true" /> : <IconFileText size={size} stroke={STROKE} aria-hidden="true" />;

const thumbStyle = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } as const;

/** A sent photo: thumbnail, tap for full size. */
function PhotoThumb({ file, size }: { file: ChatFile; size: number }) {
  const src = useFileUrl(file.id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <UnstyledButton
        onClick={() => src && setOpen(true)}
        aria-label={`Open photo ${file.name}`}
        style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden', background: 'var(--mantine-color-default-hover)', display: 'grid', placeItems: 'center' }}
      >
        {src ? <img src={src} alt={file.name} style={thumbStyle} loading="lazy" /> : <Loader size="xs" />}
      </UnstyledButton>
      <Modal opened={open} onClose={() => setOpen(false)} title={file.name} size="auto" centered>
        {src && <img src={src} alt={file.name} style={{ maxWidth: '100%', maxHeight: '75vh', display: 'block', margin: '0 auto' }} />}
      </Modal>
    </>
  );
}

/** A sent PDF or text file: icon, name and size; tap to save it. */
function FileChip({ file }: { file: ChatFile }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const u = await chatFileUrl(file.id);
      const a = document.createElement('a');
      a.href = u;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast('Could not open the file.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <UnstyledButton onClick={() => void open()} aria-label={`Save ${file.name}`}>
      <Paper withBorder radius="md" px="sm" py={6} maw={240}>
        <Group gap={8} wrap="nowrap">
          {busy ? <Loader size="xs" /> : <FileIcon type={file.type} />}
          <Box miw={0}>
            <Text size="sm" truncate>
              {file.name}
            </Text>
            <Text size="xs" c="dimmed" className="num">
              {fileSize(file.size)}
            </Text>
          </Box>
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

function MessageFiles({ files }: { files: ChatFile[] }) {
  const photos = files.filter((f) => isImage(f.type));
  const docs = files.filter((f) => !isImage(f.type));
  const size = photos.length === 1 ? 200 : 110;
  return (
    <Stack gap={6} align="flex-end" maw="85%">
      {photos.length > 0 && (
        <Group gap={6} justify="flex-end">
          {photos.map((f) => (
            <PhotoThumb key={f.id} file={f} size={size} />
          ))}
        </Group>
      )}
      {docs.map((f) => (
        <FileChip key={f.id} file={f} />
      ))}
    </Stack>
  );
}

/** Files waiting under the field: preview, upload spinner, error, remove. */
export function PendingChips({ items, onRemove }: { items: Pending[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <Group gap={8} px={6} pt={6} pb={2} role="list" aria-label="Attached files">
      {items.map((it) => {
        const photo = !!it.previewUrl;
        return (
          <Box key={it.key} role="listitem" pos="relative">
            <Paper
              withBorder
              radius="md"
              style={{ width: photo ? 64 : 'auto', height: 64, overflow: 'hidden', display: 'grid', placeItems: 'center', borderColor: it.status === 'error' ? 'var(--mantine-color-red-6)' : undefined }}
              px={photo ? 0 : 'sm'}
            >
              {photo ? (
                <img src={it.previewUrl} alt={it.name} style={{ ...thumbStyle, opacity: it.status === 'uploading' ? 0.55 : 1 }} />
              ) : (
                <Group gap={6} wrap="nowrap" maw={180}>
                  <FileIcon type={it.type} />
                  <Box miw={0}>
                    <Text size="xs" truncate>
                      {it.name}
                    </Text>
                    <Text size="xs" c={it.status === 'error' ? 'red' : 'dimmed'} truncate>
                      {it.status === 'error' ? 'Failed' : fileSize(it.size)}
                    </Text>
                  </Box>
                </Group>
              )}
              {it.status === 'uploading' && (
                <Box pos="absolute" style={{ inset: 0, display: 'grid', placeItems: 'center' }}>
                  <Loader size="sm" aria-label={`Uploading ${it.name}`} />
                </Box>
              )}
            </Paper>
            <ActionIcon
              size={20}
              radius="xl"
              variant="filled"
              color="dark"
              pos="absolute"
              top={-6}
              right={-6}
              aria-label={`Remove ${it.name}`}
              onClick={() => onRemove(it.key)}
            >
              <IconX size={12} />
            </ActionIcon>
            {it.status === 'error' && it.error && (
              <Text size="xs" c="red" maw={180} mt={2}>
                {it.error}
              </Text>
            )}
          </Box>
        );
      })}
    </Group>
  );
}

/** A tool name as words: "tasks_list" → "tasks list". */
const stepText = (t: ToolStep) => t.summary || t.name.replace(/[_-]+/g, ' ');

/** Tool steps folded into one pill; opens to the list. */
function Steps({ tools }: { tools: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const Chev = open ? IconChevronDown : IconChevronRight;
  return (
    <div>
      <UnstyledButton className="ck-steps-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <IconTool size={14} stroke={STROKE} aria-hidden="true" />
        {tools.length === 1 ? 'Used 1 tool' : `Used ${tools.length} tools`}
        <Chev size={14} stroke={STROKE} aria-hidden="true" />
      </UnstyledButton>
      {open && (
        <ol className="ck-steps-list">
          {tools.map((t, i) => (
            <li key={i}>{stepText(t)}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** While a reply streams with no text yet: the latest step, so the wait says what is happening. */
function Working({ tools }: { tools: ToolStep[] }) {
  const last = tools[tools.length - 1];
  return (
    <p className="ck-working" style={{ margin: 0 }}>
      <Loader size={14} />
      <span className="ck-shimmer">{last ? `${stepText(last)}…` : 'Thinking…'}</span>
      {tools.length > 1 && <span>· step {tools.length}</span>}
    </p>
  );
}

/** One icon action with a tooltip. */
function Act({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <Tooltip label={label} openDelay={300} withArrow>
      <ActionIcon size={30} radius="md" variant="subtle" color="gray" aria-label={label} aria-pressed={pressed} onClick={onClick}>
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

function CopyAct({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return (
    <Act
      label={done ? 'Copied' : 'Copy'}
      onClick={() => {
        void copyText(text);
        setDone(true);
        window.clearTimeout(t.current);
        t.current = window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <IconCheck size={16} stroke={STROKE} /> : <IconCopy size={16} stroke={STROKE} />}
    </Act>
  );
}

/** Read a reply aloud (icon only). */
export function SpeakAct({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  onRef.current = on;
  useEffect(() => () => void (onRef.current && stopSpeaking()), []);
  if (!canSpeak || !text) return null;
  return (
    <Act
      label={on ? 'Stop reading' : 'Read aloud'}
      pressed={on}
      onClick={() => {
        if (on || isSpeaking()) {
          stopSpeaking();
          setOn(false);
          return;
        }
        setOn(true);
        speak(text, { onEnd: () => setOn(false) });
      }}
    >
      {on ? <IconPlayerStopFilled size={14} /> : <IconVolume size={16} stroke={STROKE} />}
    </Act>
  );
}

/** A date line between messages from different days. */
export function DayDivider({ label }: { label: string }) {
  return (
    <li className="ck-day" aria-hidden="true">
      {label}
    </li>
  );
}

export type ChatBubbleProps = {
  role: 'user' | 'assistant';
  text: string;
  ts?: string;
  tools?: ToolStep[];
  error?: string;
  /** Photos and files sent with a user message. */
  files?: ChatFile[];
  /** Text is still arriving: hide the actions. */
  streaming?: boolean;
  /** The latest reply: its actions stay visible. */
  last?: boolean;
  onRetry?: () => void;
  onEdit?: () => void;
  /** Read aloud (assistant). */
  speakText?: string;
};

/**
 * One message. User: a right-aligned bubble. Assistant: avatar + full-width Markdown, write chips underneath.
 * Actions are icons: shown on hover/focus with a mouse (always on the latest reply), always on touch.
 */
export function ChatBubble({ role, text, ts, tools = [], error, files = [], streaming = false, last = false, onRetry, onEdit, speakText }: ChatBubbleProps) {
  const hideText = files.length > 0 && FILES_ONLY.test(text);
  const isCmd = role === 'user' && text.startsWith('/') && !/\s/.test(text.trim());
  const showActions = !streaming && (!!text || !!onRetry);

  if (role === 'user') {
    return (
      <li className="ck-msg ck-msg-user">
        <VisuallyHidden component="h3">You</VisuallyHidden>
        {files.length > 0 && <MessageFiles files={files} />}
        {!hideText && <div className={isCmd ? 'ck-bubble is-cmd' : 'ck-bubble'}>{text}</div>}
        {showActions && (
          <div className="ck-actions" role="group" aria-label="Message actions">
            {ts && (
              <time className="ck-time" dateTime={ts}>
                {time(ts)}
              </time>
            )}
            {text && !hideText && <CopyAct text={text} />}
            {onEdit && (
              <Act label="Edit and resend" onClick={onEdit}>
                <IconPencil size={16} stroke={STROKE} />
              </Act>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <li className={streaming ? 'ck-msg is-live' : 'ck-msg'} data-last={last || undefined} aria-busy={streaming || undefined}>
      <VisuallyHidden component="h3">{BRAND.assistant}</VisuallyHidden>
      <div className="ck-ai">
        <span className="ck-avatar" aria-hidden="true">
          <IconSparkles size={16} stroke={STROKE} />
        </span>
        <div className="ck-ai-body">
          {(!streaming || !!text) && <Steps tools={tools} />}
          {text ? (
            <div className="ck-md">
              <Md src={text} variant="chat" />
            </div>
          ) : (
            streaming && <Working tools={tools} />
          )}
          <WriteChips tools={tools} />
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          {showActions && (
            <div className="ck-actions" role="group" aria-label="Message actions" style={{ marginLeft: -6 }}>
              {text && <CopyAct text={text} />}
              {onRetry && (
                <Act label="Retry" onClick={onRetry}>
                  <IconRefresh size={16} stroke={STROKE} />
                </Act>
              )}
              {speakText && <SpeakAct text={speakText} />}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Composer: a card with the field on top (grows up to 8 rows) and a tool row underneath:
 * left tools (attach, commands), then mic, then Send. While a reply runs, Send becomes Stop.
 * Enter sends with a fine pointer; on touch Enter is a newline.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  id,
  running = false,
  onStop,
  sendDisabled = false,
  before,
  after,
  onKeyDown,
  inputRef,
  describedBy,
  hasFiles = false,
  top,
  idle,
  onPaste,
  ariaProps,
}: {
  /** Files are attached: Send works with an empty field. */
  hasFiles?: boolean;
  /** Row above the field, inside the card (attached files). */
  top?: ReactNode;
  /** Shown in place of Send while there is nothing to send (the big mic). */
  idle?: ReactNode;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  id?: string;
  running?: boolean;
  onStop?: () => void;
  sendDisabled?: boolean;
  /** Left side of the tool row. */
  before?: ReactNode;
  /** Right side of the tool row, before Send. */
  after?: ReactNode;
  /** Runs first; return true when the key was handled. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean | void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  describedBy?: string;
  /** Combobox wiring for the slash palette. */
  ariaProps?: Record<string, string | boolean | undefined>;
}) {
  const ready = value.trim().length > 0 || hasFiles;
  const fine = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (running || sendDisabled || !ready) return;
        onSubmit();
      }}
    >
      <div className="ck-composer">
        {top}
        <Textarea
          ref={inputRef}
          id={id}
          data-draft
          variant="unstyled"
          autosize
          minRows={1}
          maxRows={8}
          aria-label={label}
          aria-describedby={describedBy}
          placeholder={placeholder}
          value={value}
          enterKeyHint={fine() ? 'send' : 'enter'}
          autoComplete="off"
          {...ariaProps}
          onChange={(e) => onChange(e.currentTarget.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (onKeyDown?.(e)) return;
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && fine()) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="ck-tools">
          {before}
          <span className="ck-spacer" />
          {after}
          {running ? (
            <Tooltip label="Stop reply (Esc)" openDelay={300} withArrow>
              <ActionIcon size={36} radius="xl" variant="filled" color="gray" onClick={onStop} aria-label="Stop reply">
                <IconPlayerStopFilled size={14} />
              </ActionIcon>
            </Tooltip>
          ) : !ready && idle ? (
            idle
          ) : (
            <ActionIcon type="submit" size={36} radius="xl" variant="filled" disabled={!ready || sendDisabled} aria-label="Send">
              <IconArrowUp size={20} stroke={2.2} />
            </ActionIcon>
          )}
        </div>
      </div>
    </form>
  );
}
