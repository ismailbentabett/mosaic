# mosaic-api

The backend of **Mosaic**, the everything app: one app for every part of your life. Tasks, money,
food, gym, body, habits and goals, people, the car fund and notes
share one SQLite file, one REST API and one MCP server, so the web app and Claude see the same data.

Built with Node, [Hono](https://hono.dev), `node:sqlite` and the MCP TypeScript SDK. No native
modules and no external database.

## Run it

Requires Node 22.13 or later (Node 24 recommended).

```sh
npm ci
npm test          # node:test suite, each test file uses its own temp database
npm run typecheck # tsc --noEmit
npm run build     # esbuild → dist/server.js, dist/mcp-stdio.js, dist/cli.js
npm start         # http://localhost:8787
```

For local development without sign-in, set `MOSAIC_DEV=1`. Never use dev mode on a public host.

To fill a fresh database with the demo persona (Sam, a freelance web designer who is
saving for a used car):

```sh
node dist/cli.js import-life            # uses data/demo-seed.json
node dist/cli.js import-life --dry-run  # shows what would be added
```

The import is idempotent and never overwrites answers you have already given.

## Configuration

All settings are environment variables. `.env.example` lists every one with its default. The common ones:

| Variable | Default | Purpose |
|---|---|---|
| `MOSAIC_PUBLIC_URL` | `http://localhost:8787` | Origin used for CORS, cookies and links |
| `MOSAIC_API_PORT` | `8787` | Listens on 127.0.0.1 only |
| `MOSAIC_DATA` / `MOSAIC_DB` | `~/.local/share/mosaic` / `$MOSAIC_DATA/app.db` | Data folder and SQLite file |
| `MOSAIC_VAULT` | `$MOSAIC_ROOT/vault` | Markdown notes folder |
| `MOSAIC_DEV` | unset | `1` = no sign-in, MCP over HTTP on |
| `MOSAIC_OWNER_NAME` | `Sam` | Name returned by `GET /api/me` |
| `MOSAIC_LAT`, `MOSAIC_LNG`, `MOSAIC_CITY` | London | Weather |

Secrets (sign-in hash, TOTP, Google and ntfy tokens) can live in the file at `MOSAIC_SECRETS`
(mode 600) instead of the environment. Set the sign-in with the CLI:
`cli owner-email <email>`, `cli password`, `cli 2fa-setup`, `cli 2fa-confirm <code>`.

Every integration is optional. Without Google tokens the calendar and sheet features answer
`google_not_connected`; without ntfy, pushes are logged as failed; without the Claude CLI, chat says
so. Everything else keeps working.

## API

- `GET /healthz`: liveness.
- `/api/*`: session, today view, mode, notes vault, timer, capture, Claude chat, status.
- `/api/v2/*`: the life modules (`tasks`, `projects`, `money`, `food`, `gym`, `body`, `habits`,
  `goals`, `people`, `car`, `thrift`, `screentime`, `brain`, `life` and more).

Errors are JSON `{ error, message }`: 400 bad input, 401 signed out, 404 not found, 409 conflict,
422 rule violation, 502/503 for an upstream that is down or not connected.

## MCP

The same stores are exposed as MCP tools on a server named `mosaic`. Run it over stdio:

```json
{
  "mcpServers": {
    "mosaic": { "command": "node", "args": ["/path/to/api/dist/mcp-stdio.js"], "env": { "MOSAIC_SOURCE": "pc-claude" } }
  }
}
```

Tools are then named `mcp__mosaic__<tool>` (for example `tasks_add`, `money_log`, `life_snapshot`).
stdout is the MCP channel, so all logs go to stderr.

## CLI

`node dist/cli.js <command>`: `health`, `status`, `import-life`, `import-tasks-csv`, `import-foods`,
`import-exercises`, `import-strong`, `import-hevy`, `import-mfp`, `import-wallet`, `export <dir>`,
`push <title> <message>`, `nightly`, sign-in setup and more. Exit codes: 0 ok, 1 fail, 2 usage, 75 retry.

See `DESIGN.md` for the internal layout and input rules.
