import { openQuickCapture, openVoice, ui } from './ui';

/**
 * Quick add plumbing shared by the shell, the share target and the mic doors.
 * The QuickAdd sheet (features/quickadd) reads all of this; nothing here renders.
 */

/** Text handed over by the native share target or the web share target (/share → #/capture). */
export function takeShared(): string {
  try {
    const s = sessionStorage.getItem('mosaic.share');
    if (s !== null) sessionStorage.removeItem('mosaic.share');
    return s ?? '';
  } catch {
    return '';
  }
}

/* ---- Draft: one per device, survives close and reopen ---- */

export type CaptureDraft = { text: string; type: string | null; project: string };
const DRAFT_KEY = 'mosaic.captureDraft';
export const DRAFT_EVENT = 'mosaic:capture-draft';

export function readDraft(): CaptureDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const d = raw ? (JSON.parse(raw) as Partial<CaptureDraft> & { mode?: string }) : {};
    // Older drafts stored `mode` ('task' | 'note').
    const type = typeof d.type === 'string' ? d.type : d.mode === 'note' ? 'note' : null;
    return { text: typeof d.text === 'string' ? d.text : '', type, project: typeof d.project === 'string' ? d.project : '' };
  } catch {
    return { text: '', type: null, project: '' };
  }
}

export function writeDraft(d: CaptureDraft) {
  try {
    if (!d.text.trim()) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* private mode or full storage: the text stays in the field */
  }
}

/** Writes the draft and tells an open quick add to reload it. */
export function putDraft(d: CaptureDraft) {
  writeDraft(d);
  window.dispatchEvent(new Event(DRAFT_EVENT));
}

/** Puts text into the quick add draft and opens it so it can be edited before saving (voice sheet). */
export function editInCapture(text: string, type: string | null = null) {
  const cur = readDraft();
  const t = text.trim();
  putDraft({ text: !cur.text ? t : cur.text.includes(t) ? cur.text : cur.text + '\n' + t, type: type ?? cur.type, project: cur.project });
  openQuickCapture(type);
}

/* ---- Voice from the + button (long press) ---- */

let pendingMic: boolean = false;
export const VOICE_EVENT = 'mosaic:capture-voice';

/**
 * Long-press +: the same door as every other mic (talk to the assistant in the chat, voice on).
 * With quick add already open, its own mic records into the field instead.
 */
export function openCaptureVoice() {
  if (ui.get().capture) {
    window.dispatchEvent(new Event(VOICE_EVENT));
    return;
  }
  openVoice();
}

/** True once when quick add was asked to record on open (kept for QuickAdd; no door sets it now). */
export function consumePendingMic(): boolean {
  const p = pendingMic;
  pendingMic = false;
  return p;
}
