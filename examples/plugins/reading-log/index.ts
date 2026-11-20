// Example Mosaic plugin: a reading log.
// Copy this folder into $MOSAIC_PLUGINS_DIR and restart the API. It adds:
//   - table   p_reading_books
//   - routes  GET/POST /api/v2/plugins/reading/books, POST /api/v2/plugins/reading/books/:id/finish
//   - tools   reading_add, reading_list (usable from chat)
// The import below is type-only, so the plugin has no runtime dependency on the server's files.
import type { MosaicPlugin, PluginContext } from '../../../api/src/plugins/index.ts';

type Book = { id: number; title: string; author: string; started: string; finished: string | null };

const list = (ctx: PluginContext, open?: boolean) =>
  ctx.db
    .prepare(`SELECT * FROM ${ctx.table('books')} ${open ? 'WHERE finished IS NULL' : ''} ORDER BY started DESC, id DESC`)
    .all() as Book[];

const add = (ctx: PluginContext, title: string, author = '') => {
  const t = title.trim();
  if (!t) throw new Error('title is required');
  const r = ctx.db.prepare(`INSERT INTO ${ctx.table('books')} (title, author) VALUES (?, ?)`).run(t.slice(0, 200), author.trim().slice(0, 120));
  return ctx.db.prepare(`SELECT * FROM ${ctx.table('books')} WHERE id = ?`).get(r.lastInsertRowid) as Book;
};

const plugin: MosaicPlugin = {
  name: 'reading',
  version: '1.0.0',
  api: 1,
  description: 'Books you are reading and have finished.',
  migrations: [
    {
      version: 1,
      sql: `CREATE TABLE p_reading_books (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        started TEXT NOT NULL DEFAULT (date('now')),
        finished TEXT
      );`,
    },
    { version: 2, sql: 'CREATE INDEX p_reading_books_open ON p_reading_books (finished);' },
  ],
  routes: (app, ctx) => {
    app.get('/books', (c) => c.json({ books: list(ctx, c.req.query('open') === '1') }));
    app.post('/books', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { title?: string; author?: string };
      if (!body.title?.trim()) return c.json({ error: 'title is required' }, 400);
      return c.json(add(ctx, body.title, body.author), 201);
    });
    app.post('/books/:id/finish', (c) => {
      const r = ctx.db
        .prepare(`UPDATE ${ctx.table('books')} SET finished = date('now') WHERE id = ? AND finished IS NULL`)
        .run(Number(c.req.param('id')));
      return r.changes ? c.json({ ok: true }) : c.json({ error: 'not found or already finished' }, 404);
    });
  },
  tools: {
    add: {
      description: 'Start a book in the reading log.',
      input: (z) => ({ title: z.string().min(1).max(200), author: z.string().max(120).optional() }),
      run: (a, ctx) => add(ctx, String(a.title), a.author ? String(a.author) : ''),
    },
    list: {
      description: 'List books in the reading log. open=true shows only unfinished ones.',
      input: (z) => ({ open: z.boolean().optional() }),
      run: (a, ctx) => ({ books: list(ctx, Boolean(a.open)) }),
    },
  },
};

export default plugin;
