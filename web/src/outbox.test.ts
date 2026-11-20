import { beforeEach, describe, expect, it, vi } from 'vitest';

// The queue talks to the server through request(); here it is a scripted fake.
const calls: { method: string; path: string; body: any }[] = [];
let reply: (path: string) => unknown = () => ({});

vi.mock('./api', () => {
  class ApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    ApiError,
    asApiError: (e: unknown) => (e instanceof ApiError ? e : new ApiError('offline', 'offline', 0)),
    request: vi.fn(async (method: string, path: string, body: unknown) => {
      calls.push({ method, path, body });
      const r = reply(path);
      if (r instanceof Error) throw r;
      return r;
    }),
  };
});
const netState = { queued: 0, outbox: 0, deadLetters: 0 };
vi.mock('./store', () => ({
  emit: vi.fn(),
  toast: vi.fn(),
  net: { get: () => netState, set: (p: Partial<typeof netState>) => Object.assign(netState, p) },
}));
vi.mock('./brand', () => ({ BRAND: { name: 'Mosaic' } }));

const api = await import('./api');
const o = await import('./outbox');
const fail = (code: string, status: number, msg = code) => new (api.ApiError as any)(code, msg, status);

describe('one offline queue', () => {
  beforeEach(async () => {
    calls.length = 0;
    reply = () => ({});
    for (const i of await o.outboxItems()) await o.cancel(i.id);
    for (const i of await o.deadLetters()) await o.discardDead(i.id);
  });

  it('sends a task capture to the task list and a note to the log', async () => {
    reply = (p) => (p === '/api/capture' ? { path: 'Log/2026-11-12.md' } : {});
    const t = await o.captureItem('task', 'Call Sami\nabout the car', { project: 'Personal' });
    expect(t.sent).toBe(true);
    expect(calls[0]).toMatchObject({ path: '/api/v2/tasks', body: { id: t.clientId, text: 'Call Sami', notes: 'about the car', project: 'Personal' } });
    const n = await o.captureItem('note', 'idea');
    expect(n).toMatchObject({ sent: true, path: 'Log/2026-11-12.md' });
  });

  it('keeps a capture when offline, counts it, and Undo drops it', async () => {
    reply = () => fail('offline', 0);
    const t = await o.captureItem('task', 'Buy milk');
    expect(t.sent).toBe(false);
    expect(netState.queued).toBe(1);
    expect(await o.cancel(t.clientId)).toBe(true);
    expect(netState.queued).toBe(0);
  });

  it('a 409 or 422 goes to Unsent with the server message, never dropped', async () => {
    reply = () => fail('rule_violation', 422, 'Task must be under 45 characters.');
    await expect(o.captureItem('task', 'x'.repeat(10))).rejects.toMatchObject({ code: 'rejected' });
    let dead = await o.deadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0].error).toBe('Task must be under 45 characters.');
    expect(netState.deadLetters).toBe(1);

    reply = () => fail('offline', 0);
    await expect(o.sendOrQueue('POST', '/api/v2/money/records', { id: 'r1', note: 'bread' })).rejects.toMatchObject({ code: 'queued' });
    expect(netState.outbox).toBe(1);
    reply = () => fail('conflict', 409, 'Changed elsewhere.');
    await o.flushOutbox();
    dead = await o.deadLetters();
    expect(dead.map((d) => d.error)).toContain('Changed elsewhere.');
    expect(netState.outbox).toBe(0);

    // retry after the cause is fixed, then it is gone from Unsent
    reply = () => ({});
    await o.retryDead('r1');
    expect((await o.deadLetters()).some((d) => d.id === 'r1')).toBe(false);
    expect(calls.at(-1)).toMatchObject({ path: '/api/v2/money/records' });
  });

  it('a 401 or 5xx keeps the item queued in order', async () => {
    reply = () => fail('offline', 0);
    await expect(o.sendOrQueue('POST', '/api/v2/tasks', { id: 'a', text: 'one' })).rejects.toBeTruthy();
    await new Promise((r) => setTimeout(r, 2));
    await expect(o.sendOrQueue('POST', '/api/v2/tasks', { id: 'b', text: 'two' })).rejects.toBeTruthy();
    reply = () => fail('unauthorized', 401);
    await o.flushOutbox();
    expect((await o.outboxItems()).map((i) => i.id)).toEqual(['a', 'b']);
    expect(await o.deadLetters()).toHaveLength(0);
  });
});
