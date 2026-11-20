# Plugin API

Plugins add modules to Mosaic without forking it. A plugin can bring its own tables, its own HTTP routes, and its own chat tools.

Plugin tools are registered next to the core tools, so the AI chat can use a plugin from the first message.

> **Not a sandbox.** A plugin runs inside the API process with the server's rights. Install only code you have read or trust.

## Quick start

```bash
mkdir -p /srv/mosaic/plugins
cp -r examples/plugins/reading-log /srv/mosaic/plugins/
echo 'MOSAIC_PLUGINS_DIR=/srv/mosaic/plugins' >> api/.env
node --experimental-strip-types api/src/cli.ts plugins   # migrate + list what loaded
```

Restart the API. The example adds:

- the table `p_reading_books`
- the routes `GET/POST /api/v2/plugins/reading/books`
- the chat tools `reading_add` and `reading_list`

## Anatomy

```ts
import { definePlugin, defineTool } from '../../api/src/plugins/index.ts';

export default definePlugin({
  name: 'reading',          // /^[a-z][a-z0-9_]{1,30}$/ ; becomes the table prefix, route base and tool prefix
  version: '1.0.0',
  api: 1,                   // PLUGIN_API_VERSION this plugin was written for
  description: 'Books you are reading.',

  migrations: [
    { version: 1, sql: 'CREATE TABLE p_reading_books (id INTEGER PRIMARY KEY, title TEXT NOT NULL)' },
  ],

  routes: (app, ctx) => {
    app.get('/books', (c) => c.json(ctx.db.prepare(`SELECT * FROM ${ctx.table('books')}`).all()));
  },

  tools: {
    add: defineTool({
      description: 'Start a book.',
      input: (z) => ({ title: z.string().min(1).max(200) }),
      run: (a, ctx) => ctx.db.prepare(`INSERT INTO ${ctx.table('books')} (title) VALUES (?)`).run(a.title),
    }),
  },
});
```

A plugin is either a single file or a folder with an `index.ts`/`index.js`, placed directly in `MOSAIC_PLUGINS_DIR`. Plugins load in alphabetical order, both in the HTTP server and in the stdio MCP server.

## The context (`ctx`)

| Member | What it does |
|---|---|
| `ctx.db` | The app's `node:sqlite` database. |
| `ctx.table('books')` | Returns the namespaced name, `p_reading_books`. |
| `ctx.settings.get(key)` / `.set(key, value)` | Small key/value store scoped to the plugin (table `plugin_settings`). |
| `ctx.log(...)` | Logs to stderr with the plugin name as a prefix. |

## Rules the loader enforces

- **Names.** The plugin name must match `^[a-z][a-z0-9_]{1,30}$` and must not clash with another loaded plugin.
- **Tables.** Every `CREATE`/`ALTER`/`DROP` of a table, index, view or trigger must target a `p_<name>_*` object. Core tables stay out of reach of migrations.
- **No `ATTACH` or `PRAGMA`** in migrations.
- **Migrations run once each, in version order,** inside a transaction. They are tracked per plugin in `plugin_migrations`. A failing migration rolls back and the plugin is skipped.
- **Routes** mount under `/api/v2/plugins/<name>/` behind the normal sign-in. A plugin cannot add unauthenticated routes.
- **Tools** register as `<name>_<tool>`. Their input is a zod shape, or a function `(z) => shape` so the plugin needs no zod import of its own.
- **API version.** A plugin that declares an `api` different from the server's `PLUGIN_API_VERSION` is refused, with a clear error. Leave `api` out to skip the check.
- **Migrations** need unique positive integer versions. **Tool names** must be lowercase, and every tool needs a `description` and a `run`.
- **A broken plugin never stops the server.** It is logged, listed under `failed` in `GET /api/v2/plugins` and `cli plugins`, and the rest load normally.

## Inspect

```bash
curl -H "Authorization: Bearer $TOKEN" https://your-host/api/v2/plugins
```

```json
{
  "api": 1,
  "plugins": [{
    "name": "reading", "version": "1.0.0", "description": "Books you are reading.",
    "tools": ["reading_add", "reading_list"], "routes": "/api/v2/plugins/reading", "migrations": 2
  }],
  "failed": []
}
```

## Testing a plugin

`registerPlugin(plugin)` loads a plugin that is already imported, with no folder scan. `api/test/plugins.test.ts` shows the pattern: a temporary database, register, call the routes through `app.request()`, and call the tools directly.
