import { prefs } from './prefs';

/**
 * Voice in (SpeechRecognition) and voice out (speechSynthesis), both built into the browser.
 * Chrome sends dictated audio to Google to turn it into text; nothing is stored by Mosaic.
 */
type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
};

const RecCtor: (new () => Rec) | undefined =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition);

/** A native speech engine bridge. Mosaic is web-only, so it is never present; the code paths stay for a future shell. */
type PluginListenerHandle = { remove(): Promise<void> };
type NativeVoice = {
  start(o: { lang: string }): Promise<void>;
  stop(): Promise<void>;
  abort(): Promise<void>;
  speak(o: { text: string; lang: string; rate: number; queue: boolean; id: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  openSettings(): Promise<void>;
  addListener(event: string, fn: (d: { text?: string; speaking?: boolean; code?: string; id?: string; paused?: boolean }) => void): Promise<PluginListenerHandle>;
};
const onAndroid = false;
const Native = null as NativeVoice | null;

export const canListen = !!RecCtor || !!Native;
export const canSpeak = !!Native || (typeof window !== 'undefined' && 'speechSynthesis' in window);

/** Why voice input stopped. The UI maps each to calm inline copy with a retry. */
export type VoiceError = 'denied' | 'no-speech' | 'no-mic' | 'network' | 'language' | 'busy' | 'failed';

export const VOICE_ERRORS: Record<VoiceError, string> = {
  denied: onAndroid ? 'The mic is not allowed. Allow it for Mosaic in Android settings, then try again.' : 'The mic is blocked. Allow it in site settings, then try again.',
  'no-speech': 'Did not catch that.',
  'no-mic': 'No microphone found.',
  network: 'Voice needs a connection. Type it, or try again online.',
  language: 'Voice is not available in this language on this phone. Pick another in Settings → Voice.',
  busy: 'The mic is busy in another app. Close it, then try again.',
  failed: 'Voice did not start.',
};

const CODES: Record<string, VoiceError> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'no-speech': 'no-speech',
  'audio-capture': 'no-mic',
  network: 'network',
  unavailable: 'failed',
  denied: 'denied',
  'no-mic': 'no-mic',
  language: 'language',
  'language-not-supported': 'language',
  busy: 'busy',
};

/** Android: opens the app's page in system settings (to allow the mic after a "Don't allow"). */
export const openMicSettings = Native ? () => void Native.openSettings().catch(() => undefined) : null;

/** Only one native take at a time: a new one ends the old one cleanly first. */
let activeNative: { end(): void } | null = null;

/** Android recognizer stops after each pause; continuous takes restart it until stop() is called. */
function listenNative(o: ListenOpts, N: NativeVoice): Listener {
  activeNative?.end();
  const lang = o.lang ?? prefs.get().voiceLang;
  let finalText = '';
  let interim = '';
  let ended = false;
  let stopping = false;
  let gotError = false;
  const subs: Promise<PluginListenerHandle>[] = [];
  const text = () => (finalText + (finalText && interim ? ' ' : '') + interim).trim();
  const cleanup = () => subs.forEach((p) => void p.then((h) => h.remove()).catch(() => undefined));
  let emptyRestarts = 0;
  const finish = () => {
    if (ended) return;
    ended = true;
    if (activeNative === me) activeNative = null;
    cleanup();
    o.onSpeech?.(false);
    o.onEnd?.(text());
  };
  const fail = (code: VoiceError) => {
    gotError = true;
    o.onError?.(VOICE_ERRORS[code], code);
  };
  const begin = () =>
    N.start({ lang }).catch((e: { code?: string }) => {
      fail(CODES[e?.code ?? ''] ?? 'failed');
      finish();
    });
  subs.push(
    N.addListener('partial', (d) => {
      interim = d.text ?? '';
      o.onText(text(), false);
    }),
    N.addListener('final', (d) => {
      const t = (d.text ?? '').trim();
      if (t) emptyRestarts = 0;
      if (t) finalText = finalText ? `${finalText} ${t}` : t;
      interim = '';
      o.onText(text(), true);
    }),
    N.addListener('speech', (d) => o.onSpeech?.(!!d.speaking)),
    N.addListener('error', (d) => {
      const c = d.code ?? 'failed';
      if (c === 'aborted') return;
      if (c === 'no-speech' && (o.onEnd || (o.continuous && !stopping))) return; // empty result, or keep waiting
      fail(CODES[c] ?? 'failed');
    }),
    N.addListener('end', (d) => {
      if (ended) return;
      if (d.paused) return finish(); // left the app mid-take: keep what was heard
      // Keep a continuous take going through pauses, but give up after about half a minute of silence.
      if (o.continuous && !stopping && !gotError && ++emptyRestarts <= 4) {
        void begin();
        return;
      }
      finish();
    }),
  );
  const me = { end: finish };
  activeNative = me;
  void begin();
  return {
    stop: () => {
      stopping = true;
      void N.stop().catch(() => finish());
    },
    abort: () => {
      ended = true;
      if (activeNative === me) activeNative = null;
      cleanup();
      void N.abort().catch(() => undefined);
    },
  };
}

export type ListenOpts = {
  lang?: string;
  continuous?: boolean;
  onText: (text: string, final: boolean) => void;
  onEnd?: (finalText: string) => void;
  /** message is ready to show; code lets the UI pick its own copy. */
  onError?: (message: string, code: VoiceError) => void;
  /** true while the recognizer hears speech. Drives the level ring where no meter runs. */
  onSpeech?: (speaking: boolean) => void;
};

export type Listener = { stop(): void; abort(): void };

/** Starts listening. onText gets the running transcript; onEnd gets the final text (possibly empty). */
export function listen(o: ListenOpts): Listener | null {
  if (Native) return listenNative(o, Native);
  if (!RecCtor) return null;
  const r = new RecCtor();
  r.lang = o.lang ?? prefs.get().voiceLang;
  r.interimResults = true;
  r.continuous = !!o.continuous;
  r.maxAlternatives = 1;
  let finalText = '';
  let interim = '';
  let ended = false;
  r.onresult = (e) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    o.onText((finalText + interim).trim(), !interim);
  };
  r.onspeechstart = () => o.onSpeech?.(true);
  r.onspeechend = () => o.onSpeech?.(false);
  r.onerror = (e) => {
    if (e.error === 'aborted') return;
    if (e.error === 'no-speech' && o.onEnd) return; // treated as an empty result
    const code = CODES[e.error] ?? 'failed';
    o.onError?.(VOICE_ERRORS[code], code);
  };
  r.onend = () => {
    o.onSpeech?.(false);
    if (ended) return;
    ended = true;
    o.onEnd?.((finalText + interim).trim());
  };
  try {
    r.start();
  } catch {
    return null;
  }
  return {
    stop: () => r.stop(),
    abort: () => {
      ended = true;
      r.abort();
    },
  };
}

/**
 * Live input level (0..1) from the mic, for the ring around the record button.
 * Off on phones: Android lets only one consumer hold the mic, and recognition needs it.
 */
const mobileUa = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
export const canMeter =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof window !== 'undefined' &&
  'AudioContext' in window &&
  !mobileUa();

/** Starts the meter; returns a stop function. Safe to call when unsupported (does nothing). */
export function meter(onLevel: (level: number) => void): () => void {
  if (!canMeter) return () => {};
  let stopped = false;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let raf = 0;
  void navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((s) => {
      if (stopped) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let smooth = 0;
      const tick = () => {
        if (stopped) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 5);
        smooth = smooth * 0.7 + level * 0.3;
        onLevel(smooth);
        raf = requestAnimationFrame(tick);
      };
      tick();
    })
    .catch(() => {
      /* no level ring; recognition still runs */
    });
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => undefined);
    onLevel(0);
  };
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  const base = lang.split('-')[0];
  const same = voices.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(base));
  return (
    same.find((v) => v.lang.toLowerCase() === lang.toLowerCase() && /natural|neural|online|google|enhanced|premium/i.test(v.name)) ??
    same.find((v) => /natural|neural|online|google|enhanced|premium/i.test(v.name)) ??
    same.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ??
    same[0]
  );
}

if (!Native && canSpeak) {
  // Some browsers load the voice list late.
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
}

/** Turns Markdown into something that reads well aloud. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SpeakOpts = { lang?: string; rate?: number; onStart?: () => void; onEnd?: () => void; onBoundary?: () => void };

/** Speaks text now. queue=true appends to what is already speaking instead of cutting it off. */
/** Android read-aloud: each utterance has an id; its callbacks fire once, even when flushed. */
type Pending = { o: SpeakOpts; started: boolean };
const pending = new Map<string, Pending>();
let ttsSeq = 0;
let ttsWired = false;
function ttsDone(id: string) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  p.o.onEnd?.();
}
function wireTts(N: NativeVoice) {
  if (ttsWired) return;
  ttsWired = true;
  void N.addListener('ttsStart', (d) => {
    const p = pending.get(d.id ?? '');
    if (p && !p.started) {
      p.started = true;
      p.o.onStart?.();
    }
  });
  void N.addListener('ttsEnd', (d) => ttsDone(d.id ?? ''));
}
/** Ends every pending utterance after the caller's own state update, like the browser's async cancel. */
function flushPending() {
  const ended = [...pending.values()];
  pending.clear();
  if (ended.length) setTimeout(() => ended.forEach((p) => p.o.onEnd?.()), 0);
}

export function speak(text: string, o: SpeakOpts = {}, queue = false): boolean {
  if (!canSpeak) return false;
  const clean = speakable(text);
  if (!clean) {
    o.onEnd?.();
    return false;
  }
  if (Native) {
    const p = prefs.get();
    wireTts(Native);
    if (!queue) flushPending();
    const id = `k${++ttsSeq}`;
    pending.set(id, { o, started: false });
    void Native.speak({ text: clean, lang: o.lang ?? p.voiceLang, rate: o.rate ?? p.rate, queue, id }).catch(() => ttsDone(id));
    return true;
  }
  if (!queue) speechSynthesis.cancel();
  const p = prefs.get();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = o.lang ?? p.voiceLang;
  u.rate = o.rate ?? p.rate;
  const v = pickVoice(u.lang);
  if (v) u.voice = v;
  u.onstart = () => o.onStart?.();
  u.onend = () => o.onEnd?.();
  u.onerror = () => o.onEnd?.();
  u.onboundary = () => o.onBoundary?.();
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking() {
  if (Native) {
    flushPending();
    void Native.stopSpeaking().catch(() => undefined);
    return;
  }
  if (canSpeak) speechSynthesis.cancel();
}

export const isSpeaking = () => (Native ? pending.size > 0 : canSpeak && speechSynthesis.speaking);
