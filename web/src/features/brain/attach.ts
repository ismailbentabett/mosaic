// Photos and files waiting under the chat field. Each one uploads as soon as it is added,
// so Send is instant. Big photos are shrunk to a JPEG first (faster on mobile data, same reading).
import { api, asApiError, seedChatFileUrl, type ChatFile } from '../../api';
import { createStore, toast } from '../../store';

export const MAX_FILE = 7 * 1024 * 1024;
export const MAX_FILES = 8;
const SHRINK_OVER = 1.5 * 1024 * 1024;
const MAX_SIDE = 2048;

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DOC_EXT = new Set(['pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'log', 'xml', 'yaml', 'yml', 'ics', 'html', 'htm']);

/** For `<input type=file accept>`: photos, PDFs and text files. */
export const ACCEPT = 'image/*,application/pdf,text/*,.pdf,.txt,.md,.csv,.tsv,.json,.log,.xml,.yaml,.yml,.ics,.html,.htm';

export type Pending = {
  key: string;
  name: string;
  type: string;
  size: number;
  /** Local object URL for a photo (shown at once, before the upload ends). */
  previewUrl?: string;
  status: 'uploading' | 'ready' | 'error';
  file?: ChatFile;
  error?: string;
};

export const attachments = createStore({ items: [] as Pending[] });

const extOf = (name: string) => /\.([a-z0-9]{2,4})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
export const isImage = (type: string) => type.startsWith('image/');
export const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Photo → JPEG, longest side at most 2048 px, white behind transparency. Null when the browser cannot decode it. */
async function toJpeg(f: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise<Blob | null>((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.85));
  } catch {
    return null;
  }
}

const TOO_BIG = `Too large (max ${MAX_FILE / 1024 / 1024} MB).`;
const UNKNOWN = 'This kind of file cannot be read. Send a photo, a PDF or a text file.';

/** What to upload for one picked file, or why not. */
export async function prepareFile(f: File): Promise<{ blob: Blob; name: string } | { error: string }> {
  if (!f.size) return { error: 'The file is empty.' };
  const ext = extOf(f.name);
  const type = (f.type || '').toLowerCase();
  const base = (f.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
  if (isImage(type) || IMAGE_EXT.has(ext)) {
    const known = IMAGE_TYPES.has(type) || IMAGE_EXT.has(ext);
    if (type === 'image/gif' || ext === 'gif') return f.size <= MAX_FILE ? { blob: f, name: f.name || 'photo.gif' } : { error: TOO_BIG };
    if (known && f.size <= SHRINK_OVER) return { blob: f, name: f.name || `photo.${ext || 'jpg'}` };
    const j = await toJpeg(f);
    if (j && j.size <= MAX_FILE) return { blob: j, name: `${base}.jpg` };
    if (known && f.size <= MAX_FILE) return { blob: f, name: f.name };
    return { error: j ? TOO_BIG : 'This photo format cannot be read. Send a JPG or PNG.' };
  }
  if (!DOC_EXT.has(ext) && !type.startsWith('text/') && type !== 'application/pdf' && type !== 'application/json') return { error: UNKNOWN };
  if (f.size > MAX_FILE) return { error: TOO_BIG };
  return { blob: f, name: f.name };
}

const patch = (key: string, p: Partial<Pending>) =>
  attachments.set({ items: attachments.get().items.map((x) => (x.key === key ? { ...x, ...p } : x)) });

let seq = 0;

/** Add picked, pasted or dropped files. Each starts uploading at once. */
export function addFiles(list: FileList | File[] | null | undefined) {
  const arr = Array.from(list ?? []);
  if (!arr.length) return;
  const room = MAX_FILES - attachments.get().items.length;
  if (room <= 0) {
    toast(`At most ${MAX_FILES} files per message.`);
    return;
  }
  if (arr.length > room) toast(`Added the first ${room}. At most ${MAX_FILES} files per message.`);
  for (const f of arr.slice(0, room)) {
    const key = `att${++seq}`;
    const image = isImage(f.type) || IMAGE_EXT.has(extOf(f.name));
    const item: Pending = { key, name: f.name || 'photo', type: f.type, size: f.size, previewUrl: image ? URL.createObjectURL(f) : undefined, status: 'uploading' };
    attachments.set({ items: [...attachments.get().items, item] });
    void (async () => {
      const prep = await prepareFile(f);
      if (!attachments.get().items.some((x) => x.key === key)) return; // removed meanwhile
      if ('error' in prep) {
        patch(key, { status: 'error', error: prep.error });
        return;
      }
      try {
        const file = await api.uploadChatFile(prep.blob, prep.name);
        if (!attachments.get().items.some((x) => x.key === key)) return;
        patch(key, { status: 'ready', file, name: file.name, type: file.type, size: file.size });
      } catch (e) {
        patch(key, { status: 'error', error: asApiError(e).message });
      }
    })();
  }
}

export function removeFile(key: string) {
  const it = attachments.get().items.find((x) => x.key === key);
  if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
  attachments.set({ items: attachments.get().items.filter((x) => x.key !== key) });
}

/** Put a sent message's files back under the field (Edit and resend). */
export function restoreFiles(files: ChatFile[]) {
  clearFiles();
  attachments.set({
    items: files.slice(0, MAX_FILES).map((f) => ({ key: `att${++seq}`, name: f.name, type: f.type, size: f.size, status: 'ready' as const, file: f })),
  });
}

export function clearFiles() {
  for (const it of attachments.get().items) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
  attachments.set({ items: [] });
}

export const uploadingCount = () => attachments.get().items.filter((x) => x.status === 'uploading').length;

/** Hand the ready files to a message and empty the tray. Local previews become the message thumbnails. */
export function takeFiles(): ChatFile[] {
  const items = attachments.get().items;
  const out: ChatFile[] = [];
  for (const it of items) {
    if (it.status === 'ready' && it.file) {
      out.push(it.file);
      if (it.previewUrl) seedChatFileUrl(it.file.id, it.previewUrl);
    } else if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
  }
  attachments.set({ items: [] });
  return out;
}
