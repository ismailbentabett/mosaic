# Contributing to Mosaic

Thanks for taking a look. Issues and pull requests are welcome.

## Setup

Node 24 (see `.nvmrc`; the API runs on 22.13+).

```sh
git clone https://github.com/ismailbentabett/mosaic.git
cd mosaic
npm run setup        # npm ci in api/ and web/
npm run dev:demo     # web app on the in-browser mock backend, no API needed
```

To run against the real API, see [the README](README.md#run-the-full-stack).

## Ground rules

1. **Chat parity.** Every feature works from the UI *and* from chat. A new endpoint needs a zod
   schema and route in `api/src/modules/routes.ts`, an MCP tool in `api/src/modules/tools.ts`,
   and a handler in the web mock (`web/src/mock/`). `web/src/parity.test.ts` and
   `web/src/mockCoverage.test.ts` fail if one is missing.
2. **Thin edges, fat stores.** Routes and MCP tools only validate and delegate. Logic lives in the
   module's `store.ts` and is tested against a temporary SQLite database in `api/test/`.
3. **Theme tokens only.** No raw hex colours, font sizes or numeric gaps in screen code.
   `npm run lint:ui` enforces this; real exceptions go in `web/scripts/ui-lint-allow.txt`.
4. **No personal data.** Fixtures, seeds and screenshots use the fictional persona *Sam*.
5. **Errors are values.** Throw `AppError(code, message)`; the error middleware maps it to a JSON
   `{ error, message }` body and the right status.

## Before you push

```sh
npm run check        # typecheck + UI lint + tests + builds, both packages
```

CI runs the same steps on every push and pull request (API on Node 22 and 24).

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `feat(money): …`, `fix(web): …`,
`docs: …`, `ci: …`, `test(gym): …`. Keep the subject under 72 characters and explain the *why* in
the body.

## Screenshots

```sh
npm run screenshots  # builds the demo, then renders docs/screenshots/ (desktop + phone, light + dark)
```

Needs Playwright's Chromium once: `npx --prefix web playwright install chromium`.
