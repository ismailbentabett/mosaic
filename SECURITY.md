# Security policy

Mosaic is built to hold one person's whole life, so security bugs get the highest priority.

## Reporting a vulnerability

Please **do not open a public issue**. Use
[GitHub private vulnerability reporting](https://github.com/ismailbentabett/mosaic/security/advisories/new)
and include steps to reproduce and the impact you expect. You will get a reply within 7 days.

## Supported versions

Only the latest `main` is supported.

## Security model

| Area | Design |
|---|---|
| Sign-in | Owner only: one email + password (scrypt hash) + TOTP with hashed recovery codes. Constant-time comparisons (`timingSafeEqual`). |
| Session | `__Host-mosaic` cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`. |
| CSRF | Same-site cookie plus an `Origin` check on every state-changing request. |
| Network | The API binds to `127.0.0.1` only. Put a TLS reverse proxy (Caddy, nginx) in front. MCP over HTTP is off unless `MOSAIC_DEV=1`. |
| Secrets | Environment or a `chmod 600` secrets file (`MOSAIC_SECRETS`). Only hashes are stored for the password, recovery codes and ingest token. Never in the database, vault or logs. |
| One-tap links | Notification actions use HMAC-signed, expiring links (`MOSAIC_ACTION_KEY`). |
| Input | Every HTTP route and MCP tool validates input with zod before it reaches a store. Errors are typed (`AppError`) and never leak stack traces. |
| Data | One local SQLite file with WAL. No telemetry and no third-party analytics. |

`MOSAIC_DEV=1` turns sign-in off. Never set it on a public host.
