// Chat with the assistant: the conversation lives in a module store, so it survives leaving the page and a run keeps streaming.
// Voice mode speaks replies sentence by sentence as they stream and listens again afterwards.
import { api, asApiError, subscribeRun, type ChatFile, type ChatMessage, type ToolStep } from '../../api';
import { BRAND } from '../../brand';
import { day, time } from '../../fmt';
import { feel } from '../../sound';
import { createStore, emit, toast } from '../../store';
import { ASK_PATH, go } from '../../router';
import { lifeYmd } from '../../time';
import { clearFiles } from './attach';
import { canListen, canSpeak, speak, speakable, stopSpeaking } from '../../voice';
import { writeTopics } from './writes';

export const COMMANDS = [
  { cmd: '/what-now', help: 'Pick the one thing to do right now.' },
  { cmd: '/plan-tomorrow', help: "Title tomorrow's blocks from the rules." },
  { cmd: '/reset', help: 'Clear the day. Name what carries over.' },
  { cmd: '/zero-day', help: 'One 10-minute task. Nothing else.' },
  { cmd: '/money-check', help: 'Totals, runway and savings.' },
  { cmd: '/friday-review', help: 'The Friday check on the week.' },
  { cmd: '/weekly-review', help: "Sunday review and next week's plan." },
];

/** `send` runs it, `fill` puts it in the field to finish, `camera` opens the camera. */
export const SUGGESTIONS: { label: string; prompt: string; mode: 'send' | 'fill' | 'camera' }[] = [
  { label: 'What now?', prompt: '/what-now', mode: 'send' },
  { label: 'Plan tomorrow', prompt: '/plan-tomorrow', mode: 'send' },
  { label: 'Snap a receipt', prompt: 'Log this receipt.', mode: 'camera' },
  { label: 'Log a meal', prompt: 'Log lunch: ', mode: 'fill' },
  { label: 'Log fuel', prompt: 'Log fuel: ', mode: 'fill' },
  { label: 'How much did I spend this week?', prompt: 'How much did I spend this week?', mode: 'send' },
];

/** The text a message with only files gets. Hidden under the thumbnails. */
export const FILES_ONLY = /^Look at (this file|these files)\.$/;
const filesText = (n: number) => (n === 1 ? 'Look at this file.' : 'Look at these files.');
const sameFiles = (a: ChatFile[] | undefined, b: ChatFile[]) => (a ?? []).map((f) => f.id).join() === b.map((f) => f.id).join();

const CHAT_KEY = 'mosaic.chat';
const RUN_KEY = 'mosaic.run';
const VOICE_KEY = 'mosaic.jarvis.loop';
const VOICE_RULE =
  '[Voice mode. Reply in one to three short spoken sentences, plain text, no lists, no Markdown, no emoji. If you changed something, say what.]';

// ---------- storage ----------

const storage = {
  get(k: string, session = false): string | null {
    try {
      return (session ? sessionStorage : localStorage).getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null, session = false) {
    try {
      const s = session ? sessionStorage : localStorage;
      if (v === null) s.removeItem(k);
      else s.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
};

type PendingRun = { runId: string; chatId: string; prompt: string; voice?: boolean };

function readPending(): PendingRun | null {
  const raw = storage.get(RUN_KEY, true);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingRun;
  } catch {
    return null;
  }
}

const stripRule = (t: string) => (t.startsWith(VOICE_RULE) ? t.slice(VOICE_RULE.length).trim() : t);
const clean = (m: ChatMessage): ChatMessage => (m.role === 'user' ? { ...m, text: stripRule(m.text) } : m);

function limitText(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return `${BRAND.assistant} has reached its usage limit. Until it resets, use the Claude phone app.`;
  const d = lifeYmd(iso);
  const when = d === lifeYmd() ? time(iso) : `${day(d)} ${time(iso)}`;
  return `${BRAND.assistant} has reached its usage limit. It resets ${when}. Until then, use the Claude phone app.`;
}

// ---------- chat store ----------

export type Live = { runId: string; text: string; tools: ToolStep[]; prompt: string };
/** Shown inline under the last message. `retry` is the prompt to send again. */
export type Problem = { tone: 'quiet' | 'warn'; text: string; detail?: string; retry?: string; retryFiles?: ChatFile[]; reload?: boolean } | null;

export const chat = createStore({
  chatId: storage.get(CHAT_KEY),
  messages: [] as ChatMessage[],
  loading: false,
  live: null as Live | null,
  sending: false,
  problem: null as Problem,
  /** Screen reader text for the last finished reply; `seq` makes repeats re-announce. */
  announce: { text: '', seq: 0 },
  speaking: false,
  /** Bumped when a spoken reply has fully finished (voice mode listens again). */
  spokenSeq: 0,
  voice: storage.get(VOICE_KEY) === '1',
  /** A question handed over before the page was open (?ask=). */
  inbox: null as string | null,
  /** Set by talkToAssistant(): the chat page starts listening once it is open. */
  listen: false,
  /** Messages waiting to send while the assistant is busy or the phone is offline. */
  queued: 0,
});

let unsub: (() => void) | null = null;
let booted = false;
/** True between pressing Stop and the run's end: a stopped run is not a failure. */
let stopping = false;

// ---------- queue: busy or offline sends wait here and go out in order ----------

type Queued = { text: string; voice: boolean; files: ChatFile[] };
const QUEUE_KEY = 'mosaic.chat.queue';

function readQueue(): Queued[] {
  try {
    const v = JSON.parse(storage.get(QUEUE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((q): q is Queued => !!q && typeof q.text === 'string') : [];
  } catch {
    return [];
  }
}

let queue: Queued[] = readQueue();
chat.set({ queued: queue.length });

function saveQueue() {
  storage.set(QUEUE_KEY, queue.length ? JSON.stringify(queue) : null);
  chat.set({ queued: queue.length });
}

function queuedProblem(): Problem {
  if (!queue.length) return null;
  const what = queue.length === 1 ? `"${queue[0].text.length > 40 ? queue[0].text.slice(0, 39) + '…' : queue[0].text}"` : `${queue.length} messages`;
  return { tone: 'quiet', text: `Queued: ${what}. Sends when ${BRAND.assistant} is free.` };
}

function enqueue(q: Queued, front = false) {
  if (front) queue.unshift(q);
  else queue.push(q);
  saveQueue();
  chat.set({ problem: queuedProblem() });
}

function clearQueue() {
  queue = [];
  saveQueue();
}

/** Sends the oldest queued message once nothing is running. */
function drain() {
  const st = chat.get();
  if (!queue.length || st.live || st.sending) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const q = queue.shift()!;
  saveQueue();
  void send(q.text, q.voice, q.files, true);
}

function setChatId(id: string | null) {
  chat.set({ chatId: id });
  storage.set(CHAT_KEY, id);
}

export function setVoice(on: boolean) {
  chat.set({ voice: on });
  storage.set(VOICE_KEY, on ? '1' : '0');
  if (!on) stopVoice();
}

// ---------- speech out ----------

let speechBuf = '';
let utterances = 0;
let streamDone = true;
let speakRun = false;

/** Splits streamed text into finished sentences and the unfinished tail. */
function sentences(buf: string): [string[], string] {
  const out: string[] = [];
  const re = /[^.!?\n]+[.!?]+["')\]]?(\s+|$)|[^\n]+\n+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf))) {
    if (m.index !== last) break;
    if (!/\s$/.test(m[0]) && m.index + m[0].length === buf.length) break; // may still be growing
    out.push(m[0].trim());
    last = m.index + m[0].length;
  }
  return [out.filter(Boolean), buf.slice(last)];
}

function maybeFinishedSpeaking() {
  if (!streamDone || utterances > 0) return;
  if (chat.get().speaking) chat.set({ speaking: false, spokenSeq: chat.get().spokenSeq + 1 });
}

function say(s: string) {
  if (!canSpeak || !speakable(s)) return;
  utterances += 1;
  chat.set({ speaking: true });
  speak(
    s,
    {
      onEnd: () => {
        utterances = Math.max(0, utterances - 1);
        maybeFinishedSpeaking();
      },
    },
    true,
  );
}

function flushSpeech(all: boolean) {
  if (!speakRun) return;
  const [done, rest] = sentences(speechBuf);
  done.forEach(say);
  speechBuf = rest;
  if (all && rest.trim()) {
    say(rest.trim());
    speechBuf = '';
  }
}

/** Stops speaking without counting it as finished (no listen-again). */
export function stopVoice() {
  stopSpeaking();
  utterances = 0;
  speechBuf = '';
  speakRun = false;
  chat.set({ speaking: false });
}

// ---------- runs ----------

function attach(runId: string, prompt: string, voice: boolean) {
  unsub?.();
  stopping = false;
  const blank = (): Live => ({ runId, text: '', tools: [], prompt });
  chat.set({ live: blank() });
  speechBuf = '';
  utterances = 0;
  streamDone = false;
  speakRun = voice && canSpeak;
  let spoken = 0; // characters already queued for speech (a reconnect replays the stream)
  unsub = subscribeRun(runId, {
    reset: () => chat.set({ live: blank() }),
    text: (t) => {
      const l = chat.get().live;
      if (!l) return;
      const text = l.text + t;
      chat.set({ live: { ...l, text } });
      if (text.length > spoken) {
        speechBuf += text.slice(spoken);
        spoken = text.length;
        flushSpeech(false);
      }
    },
    tool: (s) => {
      const l = chat.get().live;
      if (l) chat.set({ live: { ...l, tools: [...l.tools, s] } });
    },
    done: (d) => {
      const l = chat.get().live;
      unsub = null;
      storage.set(RUN_KEY, null, true);
      flushSpeech(true);
      streamDone = true;
      const st = chat.get();
      const patch: Partial<typeof st> = { live: null };
      // Stop is the person's choice, not a failure: keep what came, no error sound, no problem line.
      const stopped = stopping || d.error === 'Stopped';
      stopping = false;
      const error = stopped ? undefined : (d.error ?? undefined);
      // An empty reply is not kept as a message: the inline problem carries Retry.
      if (l && (l.text.trim() || l.tools.length)) {
        const msg: ChatMessage = { role: 'assistant', text: l.text, tools: l.tools, ts: new Date().toISOString(), error };
        patch.messages = [...st.messages, msg];
        const topics = writeTopics(l.tools);
        if (topics.length) emit(...topics);
        if (l.text.trim()) patch.announce = { text: `${BRAND.assistant}: ${speakable(l.text)}`, seq: st.announce.seq + 1 };
      }
      if (d.limitResetAt) patch.problem = { tone: 'warn', text: limitText(d.limitResetAt), retry: l?.prompt };
      else if (stopped) patch.problem = queuedProblem();
      else if (d.error || (l && !l.text.trim() && !l.tools.length)) {
        feel('error');
        patch.problem = { tone: 'warn', text: 'Did not get a reply.', detail: d.error ?? undefined, retry: l?.prompt };
      } else patch.problem = queuedProblem();
      chat.set(patch);
      if (d.chatId) setChatId(d.chatId);
      if (!d.limitResetAt) window.setTimeout(drain, 0);
      if (!speakRun || utterances === 0) {
        utterances = 0;
        if (speakRun) maybeFinishedSpeaking();
      }
    },
    lost: () => {
      unsub = null;
      storage.set(RUN_KEY, null, true);
      streamDone = true;
      stopVoice();
      chat.set({ live: null, problem: { tone: 'warn', text: 'Lost the connection to this reply.', reload: true } });
    },
  });
}

export async function loadChat(id: string, dropAfterPrompt?: string) {
  // Queued messages belong to the open chat; opening another one drops them.
  if (queue.length && id !== chat.get().chatId) clearQueue();
  chat.set({ loading: true });
  try {
    const c = await api.chat(id);
    let ms = c.messages;
    // A run started while this loaded (voice hand-over, ?run=): keep its prompt visible.
    const liveNow = chat.get().live;
    if (dropAfterPrompt === undefined && liveNow) dropAfterPrompt = liveNow.prompt;
    if (dropAfterPrompt !== undefined) {
      // A run is still streaming: keep history up to and including its prompt; the stream replays the reply.
      let idx = -1;
      for (let i = ms.length - 1; i >= 0; i--) {
        if (ms[i].role === 'user' && ms[i].text === dropAfterPrompt) {
          idx = i;
          break;
        }
      }
      ms = idx >= 0 ? ms.slice(0, idx + 1) : [...ms, { role: 'user', text: dropAfterPrompt, tools: [], ts: new Date().toISOString() }];
    }
    chat.set({ messages: ms.map(clean), problem: null });
    setChatId(c.id);
  } catch (e) {
    const err = asApiError(e);
    if (err.status === 404) {
      setChatId(null);
      chat.set({ messages: [] });
    } else chat.set({ problem: { tone: 'warn', text: 'Could not load this chat.', detail: err.message, reload: true } });
  } finally {
    chat.set({ loading: false });
  }
}

/** Once per app run: resume a reply that was streaming, or reopen the last chat. */
export function boot() {
  if (booted) return;
  booted = true;
  window.addEventListener('online', drain);
  window.setInterval(drain, 15_000);
  if (queue.length) chat.set({ problem: queuedProblem() });
  const pending = readPending();
  if (pending) {
    void loadChat(pending.chatId, pending.prompt).then(() => attach(pending.runId, stripRule(pending.prompt), !!pending.voice));
  } else {
    const id = chat.get().chatId;
    if (id) void loadChat(id);
  }
}

/**
 * Sends a message. Resolves true when the run started.
 * While a reply is running, the assistant is busy elsewhere or the phone is offline, the message is queued
 * and goes out by itself (`fromQueue` puts a failed resend back at the front).
 */
export async function send(raw: string, voice = chat.get().voice, files: ChatFile[] = [], fromQueue = false): Promise<boolean> {
  const text = raw.trim() || (files.length ? filesText(files.length) : '');
  const st = chat.get();
  if (!text) return false;
  const retryFiles = files.length ? files : undefined;
  if (st.live || st.sending || (!fromQueue && queue.length)) {
    enqueue({ text, voice, files }, fromQueue);
    return false;
  }
  // Show the message at once. A retry after a failed send reuses the message already on screen.
  const last = st.messages[st.messages.length - 1];
  const shown = last?.role === 'user' && last.text === text && sameFiles(last.files, files);
  const before = st.messages;
  chat.set({
    sending: true,
    problem: null,
    messages: shown ? st.messages : [...st.messages, { role: 'user', text, tools: [], ts: new Date().toISOString(), ...(files.length ? { files } : {}) }],
  });
  stopVoice();
  const prompt = voice ? `${VOICE_RULE}\n${text}` : text;
  try {
    const r = await api.run(prompt, chat.get().chatId, files.map((f) => f.id));
    feel('tap');
    setChatId(r.chatId);
    storage.set(RUN_KEY, JSON.stringify({ runId: r.runId, chatId: r.chatId, prompt, voice } satisfies PendingRun), true);
    attach(r.runId, text, voice);
    return true;
  } catch (e) {
    const err = asApiError(e);
    const body = (err.body ?? {}) as { busy?: unknown; limitResetAt?: unknown };
    if (err.status === 409 || err.status === 0 || err.code === 'offline') {
      // Busy (another run, e.g. the nightly plan) or offline: wait in the queue, not an error.
      if (!shown) chat.set({ messages: before });
      enqueue({ text, voice, files }, true);
      return false;
    }
    feel('error');
    if (typeof body.limitResetAt === 'string') {
      chat.set({ problem: { tone: 'warn', text: limitText(body.limitResetAt), retry: text, retryFiles } });
    } else {
      chat.set({ problem: { tone: 'warn', text: 'Did not get a reply.', detail: err.message, retry: text, retryFiles } });
    }
    return false;
  } finally {
    chat.set({ sending: false });
  }
}

export async function stopRun() {
  const l = chat.get().live;
  stopVoice();
  if (!l) return;
  stopping = true;
  try {
    await api.stopRun(l.runId);
  } catch (e) {
    stopping = false;
    toast(asApiError(e).message);
  }
}

/** Starts an empty chat: no messages, no waiting files, nothing queued. Refused (false) while a reply is running. */
export function newChat(): boolean {
  if (chat.get().live || chat.get().sending) return false;
  stopVoice();
  clearFiles();
  clearQueue();
  setChatId(null);
  chat.set({ messages: [], problem: null });
  return true;
}

/** Hands a spoken question to the chat; it is sent (and answered aloud) when the chat page is open. */
export function askAloud(text: string) {
  chat.set({ inbox: text });
}

/**
 * The one way in to talking with the assistant, used by every mic door (long-press +, header mic, `v`, Spotlight).
 * Opens the chat with voice on and starts listening. An idle chat with history starts fresh,
 * so the new voice chat is titled from its first spoken words.
 */
export function talkToAssistant() {
  const st = chat.get();
  if (!st.live && !st.sending && st.messages.length) newChat();
  setVoice(true);
  chat.set({ listen: true });
  go(ASK_PATH);
}

// ---------- voice phases ----------

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';
export const PHASE_TEXT: Record<Phase, string> = {
  idle: canListen ? 'Voice on. Press Space or the mic to talk.' : 'Voice on. Replies are read aloud.',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking. Press Escape to stop.',
};
