import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-chatfiles-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');

const f = await import('../src/chatfiles.ts');
const c = await import('../src/claude.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code ?? e.message; } };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.4\n%fake');

test('saves photos, PDFs and text under DATA_DIR/media/chat', () => {
  const img = f.saveChatFile('receipt.PNG', 'image/png', PNG);
  assert.match(img.id, /^[0-9a-f-]{36}\.png$/);
  assert.equal(img.type, 'image/png');
  assert.equal(img.name, 'receipt.PNG');
  assert.ok(f.chatFilePath(img.id).startsWith(join(root, 'data', 'media', 'chat')));
  assert.deepEqual(readFileSync(f.chatFilePath(img.id)), Buffer.from(PNG));
  // No extension: the type decides.
  assert.match(f.saveChatFile('camera', 'image/png', PNG).id, /\.png$/);
  assert.equal(f.saveChatFile('statement.pdf', '', PDF).type, 'application/pdf');
  assert.equal(f.saveChatFile('list.csv', 'text/csv', new TextEncoder().encode('a,b\n1,2')).type, 'text/csv');
  assert.equal(f.getChatFile(img.id)?.name, 'receipt.PNG');
});

test('rejects unknown kinds, fake contents, empty and oversize files', () => {
  assert.equal(code(() => f.saveChatFile('run.exe', 'application/octet-stream', PNG)), 'bad_request');
  assert.equal(code(() => f.saveChatFile('photo.jpg', 'image/jpeg', PNG)), 'bad_request', 'PNG bytes named .jpg');
  assert.equal(code(() => f.saveChatFile('notes.txt', 'text/plain', new Uint8Array([0x61, 0, 0x62]))), 'bad_request', 'binary as text');
  assert.equal(code(() => f.saveChatFile('a.txt', 'text/plain', new Uint8Array())), 'bad_request');
  assert.equal(code(() => f.saveChatFile('big.txt', 'text/plain', new Uint8Array(f.MAX_FILE + 1).fill(0x61))), 'bad_request');
  assert.equal(f.getChatFile('../../etc/passwd'), null);
  assert.equal(code(() => f.readChatFile('nope.png')), 'not_found');
  assert.equal(code(() => f.resolveChatFiles(['00000000-0000-0000-0000-000000000000.png'])), 'bad_request');
  assert.equal(code(() => f.resolveChatFiles('x')), 'bad_request');
});

test('prompt block names each path and keeps numbers out', () => {
  const img = f.saveChatFile('fuel.png', 'image/png', PNG);
  const block = f.filesPromptBlock([img]);
  assert.ok(block.includes(f.chatFilePath(img.id)));
  assert.match(block, /Read tool/);
  assert.match(block, /Never copy card/);
  assert.equal(f.filesPromptBlock([]), '');
});

test('a run with only files gets a default prompt; the chat keeps the files', async () => {
  process.env.CLAUDE_BIN = join(root, 'no-such-claude');
  const img = f.saveChatFile('lunch.png', 'image/png', PNG);
  assert.equal(code(() => c.startRun({ prompt: '' })), 'bad_request');
  const { runId, chatId } = c.startRun({ prompt: '', files: [img.id] });
  await new Promise((r) => c.subscribe(runId, (e) => { if (e.event === 'done') r(e.data); }));
  const chat = c.getChat(chatId) as any;
  assert.equal(chat.title, 'lunch.png');
  assert.equal(chat.messages[0].text, 'Look at this file.');
  assert.deepEqual(chat.messages[0].files, [img]);
  assert.equal(chat.messages[1].files, undefined);
  assert.ok(existsSync(f.chatFilePath(img.id)));
});
