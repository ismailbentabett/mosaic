# mosaic-api: internal design

How the API is put together, for anyone changing it. The README covers running it.

## Constraints

- Node 22.13+ (tests run on Node 24). TypeScript is run directly by `node --experimental-strip-types`
  in tests and bundled by esbuild (`build.mjs`) into `dist/server.js`, `dist/mcp-stdio.js` and `dist/cli.js`.
- **No native modules.** Storage is `node:sqlite`, HTTP is global `fetch`, crypto is `node:crypto`.
  Runtime dependencies are only `hono`, `@hono/node-server`, `@modelcontextprotocol/sdk` and `zod` (v4).
- TS rules (tsconfig): `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, parameter properties or
  namespaces), imports carry the `.ts` extension, `import type` for types.
- Every integration is optional. A missing Google token, ntfy server, Claude CLI or sheet id turns that
  feature into a clear "not connected" answer; it never stops the server or the other modules.

## Layers

```
server.ts ──> routes.ts (Hono app: auth, CORS, body limits, /api, /act, static web)
                 └─> modules/routes.ts  (/api/v2: one store per life module)
mcp-stdio.ts ─> tools.ts (McpServer "mosaic") ─> modules/tools.ts (module tools)
cli.ts ───────> the same stores, for cron jobs, imports and setup
```

Routes and MCP tools are thin: they parse input and call a store function. All rules live in the stores,
so the web client, Claude (MCP) and the CLI get the same behaviour and the same errors.

## Shared core (signatures are stable)

- `config.ts`: `ROOT, VAULT, WEB_DIST, LOG_DIR, DATA_DIR, DEV, PORT, PUBLIC_URL, SECRETS_PATH`,
  `cfg(key, fallback)` (env, then `services/config.env`), `secret(key)` (env, then the secrets file),
  `setSecret(key, value|null)`.
- `db.ts`: `getDb()` opens `MOSAIC_DB` (WAL), `kvGet`, `kvSet`, `pidAlive`. `migrate.ts` holds the
  versioned schema; each module may add its own `schema.ts`.
- `errors.ts`: `AppError(code, message, extra)` and `fail(...)`. `routes.ts` maps codes to statuses:
  `bad_request` 400, `unauthorized` 401, `not_found` 404, `conflict` 409, `rule_violation` 422,
  `upstream` 502, `google_*` 503. Anything else is a logged 500 `{ error: 'internal' }`.
- `time.ts`: one fixed zone, `MOSAIC_TZ` (default UTC). `isDate`, `addDays`, `lifeDay(d, 4)`
  (a "life day" ends at 04:00, so late-night logging counts for the evening before), `lifeToday()`.
- `modules/util.ts`: `one`, `all`, `run`, `insert` (idempotent on a client-sent `id`), `patch`,
  `softDelete`, `need(row, what)` (404 when missing), `uuid`, `toCsv`, `parseCsv`.

## Input rules

- Bodies must be a JSON object, else 400. Unknown keys are ignored; mistyped known keys are a 400.
- Date query params (`day`, `week`, `from` where noted) must be real `YYYY-MM-DD` dates, else 400.
- A missing id or name is a 404 through `need()`. Bad input must never surface as a 500;
  `test/edge.test.ts` holds the regression cases.
- Every create accepts a client `id` (uuid) so offline replays from the app do not double rows.
- Writes are soft deletes (`deleted_at`), and the Removed list can restore them.

## Modules (`src/modules/*`)

tasks (projects, sections, recurrence, natural-language quick add, CSV import/export) · money (accounts,
records, transfers, rates, budgets, runway, savings goals, debts) · food (foods, recipes, meals,
targets, adaptive TDEE) · gym (exercises, routines, workouts, sets, volume) · body (metrics, trend) ·
habits and goals (grades: areas, goals tree, milestones, links, weekly grades) · people (contacts,
occasions, promises, lent items, capsules) · car (car, papers, service, fuel, listings) · thrift (recurring costs, skipped buys, wishlist) · habitat (closed days, chores) ·
screentime (ingest from the phone) · brain (search over notes and data) · profile (facts and the asks
queue) · ideas and extras (the smaller helpers: rescue mode, done list, weather, anchors drift).

`life.ts` builds the one-call snapshot the home screen and Claude read. `lifeseed.ts` imports a
persona file (`data/demo-seed.json`) idempotently: it never overwrites an answer the user gave.

## Calendar and sheet (optional Google side)

`google.ts` (OAuth, token refresh), `calendar.ts` (events classified into blocks), `rules.ts`
(`setBlockTask` enforces the block title rules and mirrors the task into the tasks module, default
project `Studio`), `sheet.ts` (mode, money totals). With no Google tokens these return a
503 `google_not_connected`; the local modules keep working.

## Claude and MCP

`tools.ts` builds the MCP server named `mosaic`. Over stdio (`dist/mcp-stdio.js`) it is what Claude Code
and the app's chat tab spawn. Over HTTP (`/mcp`) it is on only in dev mode. `claude.ts` runs the Claude
CLI for the chat tab and the nightly plan, one run at a time (409 when busy).

## Source tag

Every write calls `logAction(source, tool, summary)`. The source is `MOSAIC_SOURCE` for stdio
(`app-claude`, `vps-claude`, `nightly`), `pc-claude` for HTTP `/mcp`, and `app` for REST.

## Push

`ntfy.ts` publishes to a self-hosted ntfy on 127.0.0.1 (`NTFY_TOPIC`, default `mosaic`). `push()` never
throws; a missing server is logged as a failed push. `pushCenter.ts` holds quiet hours, categories and
the schedule.
