// Files and photos sent in chat. Bytes live in DATA_DIR/media/chat (never the vault); the row keeps name and type.
// Claude reads them with its Read tool (images, PDFs, text), so only those kinds are accepted.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from './config.ts';
import { getDb } from './db.ts';
import { fail } from './errors.ts';

export type ChatFile = { id: string; name: string; type: string; size: number };

export const MAX_FILE = 7 * 1024 * 1024;
export const MAX_FILES = 8;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,4}$/;

const IMAGE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const TEXT: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  log: 'text/plain', xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml', ics: 'text/calendar', html: 'text/html', htm: 'text/html',
};
const TYPES: Record<string, string> = { ...IMAGE, ...TEXT, pdf: 'application/pdf' };
// First extension per type wins (jpg over jpeg, txt over log, yaml over yml, html over htm).
const EXT_BY_TYPE: Record<string, string> = {};
for (const [e, t] of Object.entries(TYPES)) EXT_BY_TYPE[t] ??= e;

export const chatMediaDir = () => join(DATA_DIR, 'media', 'chat');
export const chatFilePath = (id: string) => join(chatMediaDir(), id);

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const contentOk = (ext: string, b: Uint8Array): boolean => {
  if (ext === 'png') return starts(b, [0x89, 0x50, 0x4e, 0x47]);
  if (ext === 'jpg' || ext === 'jpeg') return starts(b, [0xff, 0xd8, 0xff]);
  if (ext === 'gif') return starts(b, [0x47, 0x49, 0x46, 0x38]);
  if (ext === 'webp') return starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8);
  if (ext === 'pdf') return starts(b, [0x25, 0x50, 0x44, 0x46]);
  // Text: valid UTF-8 with no NUL bytes.
  if (b.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; }
};

const cleanName = (name: string, ext: string) => {
  // eslint-disable-next-line no-control-regex
  const base = name.replace(/[\\/]/g, ' ').replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return base || `file.${ext}`;
};

/** Save one upload. Throws bad_request for unknown kinds, wrong contents or size. */
export const saveChatFile = (name: string, type: string, bytes: Uint8Array): ChatFile => {
  if (!bytes.length) fail('bad_request', 'The file is empty.');
  if (bytes.length > MAX_FILE) fail('bad_request', `File too large (max ${MAX_FILE / 1024 / 1024} MB).`);
  const fromName = /\.([a-z0-9]{2,4})$/i.exec(name)?.[1]?.toLowerCase();
  const ext = fromName && TYPES[fromName] ? fromName : EXT_BY_TYPE[(type || '').toLowerCase().split(';')[0].trim()];
  if (!ext) fail('bad_request', 'This kind of file cannot be read. Send a photo (PNG, JPG, WebP, GIF), a PDF or a text file (TXT, MD, CSV, JSON).');
  if (!contentOk(ext, bytes)) fail('bad_request', 'The file contents do not match its type.');
  const id = `${randomUUID()}.${ext}`;
  mkdirSync(chatMediaDir(), { recursive: true, mode: 0o700 });
  writeFileSync(chatFilePath(id), bytes, { mode: 0o600 });
  const f: ChatFile = { id, name: cleanName(name, ext), type: TYPES[ext], size: bytes.length };
  getDb().prepare('INSERT INTO chat_files (id, name, type, size, created) VALUES (?, ?, ?, ?, ?)').run(f.id, f.name, f.type, f.size, new Date().toISOString());
  return f;
};

export const getChatFile = (id: string): ChatFile | null => {
  if (!ID.test(id)) return null;
  const r = getDb().prepare('SELECT id, name, type, size FROM chat_files WHERE id = ?').get(id) as ChatFile | undefined;
  return r && existsSync(chatFilePath(id)) ? { id: r.id, name: r.name, type: r.type, size: r.size } : null;
};

export const readChatFile = (id: string): { file: ChatFile; bytes: Buffer } => {
  const file = getChatFile(id);
  if (!file) fail('not_found', 'File not found');
  return { file: file!, bytes: readFileSync(chatFilePath(id)) };
};

/** Resolve the ids sent with a chat message. An unknown id fails so a message never silently drops a file. */
export const resolveChatFiles = (ids: unknown): ChatFile[] => {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids)) fail('bad_request', 'files must be a list of file ids');
  const list = [...new Set(ids as unknown[])];
  if (list.length > MAX_FILES) fail('bad_request', `At most ${MAX_FILES} files per message.`);
  return list.map((id) => {
    const f = typeof id === 'string' ? getChatFile(id) : null;
    if (!f) fail('bad_request', 'A file is missing. Attach it again.');
    return f!;
  });
};

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The block appended to Claude's prompt. Never stored in the chat. */
export const filesPromptBlock = (files: ChatFile[]): string => {
  if (!files.length) return '';
  return [
    '',
    '',
    `[Attached: ${files.length === 1 ? 'one file' : `${files.length} files`}. Open each with the Read tool before answering.`,
    'If the user asked to log or save something from it, or it is plainly a receipt, meal, fuel slip, workout, body reading, car paper or task list and they asked nothing else, save it with the matching mosaic tool (money_log, food_log, car tools, gym_log_workout, body_log, tasks_add, documents_add) and say what you saved.',
    'Never copy card, account, ID or document numbers from a file. Names and totals only.]',
    ...files.map((f) => `- ${chatFilePath(f.id)} (${f.name}, ${f.type}, ${size(f.size)})`),
  ].join('\n');
};
