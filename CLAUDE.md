# CLAUDE.md

Personal todo lists plus a calendar, as an offline-first PWA at https://todo.matteob.dev, with an MCP
connector so Claude can read and change the same data. One Cloudflare Worker serves the Vite + React
SPA (static assets), the JSON API, the MCP endpoint and the OAuth endpoints. Custom CSS, no Tailwind.

## Commands

- `npm run dev`: apply local D1 migrations, build the SPA, `wrangler dev` on :8787 (`--local-upstream`
  keeps OAuth metadata on localhost instead of the custom domain).
- `npm run dev:ui`: Vite with HMR, proxying `/api` to :8787. The service worker is only registered in
  production builds.
- `npm test`: `vite build` then Vitest. Projects: `unit` (`test/unit/`, node; `test/unit/client/` uses
  fake-indexeddb) and `worker` (`test/worker/`, inside workerd via `@cloudflare/vitest-plugin`, migrations
  applied per file, the `STD` service binding replaced by `test/std-mock.ts`).
- `npm run typecheck`: `tsc -b` over app, worker, worker tests and client tests.
- `npm run types`: regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` or `.dev.vars`.
- `npm run icons`: regenerate `public/` icons (`scripts/generate-icons.mjs`, needs `sharp`).
- `npm run deploy`: build, apply remote migrations, `wrangler deploy`.

## Bindings and secrets

- `DB`: D1 `todo-app`. `OAUTH_KV`: KV for `@cloudflare/workers-oauth-provider` (clients, grants,
  tokens).
- `STD`: service binding to the `save-the-date` Worker.
- `REGISTRATION_SECRET`: the invite code `POST /api/auth/register` requires.
- `STD_TOKEN`: bearer token for save-the-date's `POST /api/todo/redeem` and `GET /api/dates` (the
  latter on behalf of a connected account, named in `X-Todo-User`); the same value is save-the-date's
  `TODO_APP_TOKEN` secret, which grants those two requests and nothing else.
- Local values live in `.dev.vars` (gitignored).

## Layout

- `shared/`: code used by the client, the API and MCP. `entities.ts` is the wire format for synced
  records and mutations (zod), `recurrence.ts` the RRULE subset and occurrence expansion, `agenda.ts`
  a day's ordered agenda (the calendar UI and `get_agenda` both use it), `items.ts` item ordering and
  overdue, `dates.ts` floating date arithmetic, `palette.ts` the only colour values, `std.ts` the
  save-the-date app URL.
- `worker/`: `index.ts` wraps everything in `OAuthProvider`; `/api/*` goes to the hand-written
  `Router`, `/authorize` to `routes/authorize.ts`, `/connect/save-the-date` to `routes/connect.ts`,
  other paths to the assets. `services/records.ts` is
  the single write path; `services/todo.ts` holds the MCP operations; `mcp.ts` registers the tools.
- `src/`: the SPA. `data/store.ts` is the offline mirror; `todo/` and `calendar/` are the two tabs.

## Sync model

- Every synced row (`lists`, `items`, `events`, `event_exceptions`) has `seq`, `created_at`,
  `updated_at` and `deleted_at`. Deletes are soft (tombstones) and cascade: list to items, event to
  exceptions.
- Each write bumps the owner's `user_seq` and stamps the touched rows with it, in one D1 batch.
  `GET /api/sync?since=N` returns rows with `seq > N` (tombstones included, except when N is 0) and the
  new cursor.
- `POST /api/mutations` takes `{op_id, entity, action: upsert|delete, record}` with client UUIDs.
  Idempotent by `op_id` (`applied_ops`, pruned after 30 days). Upserts carry the full record; the last
  one to arrive wins. A delete beats a later edit. Rejected ops return the server copy (`current`), which
  the client puts in place of its optimistic one.
- The client (`src/data/store.ts`) writes to memory and IndexedDB first and queues the mutation in the
  `outbox`; `sync()` flushes the outbox, then pulls. A pulled row never overwrites a record with a
  queued mutation. Sync runs on start, `online`, becoming visible, 300 ms after a write, and every
  minute while visible (no Background Sync API: iOS lacks it).
- MCP writes go through the same `applyMutation`, so the app sees them on its next pull.

## Time

Dates (`YYYY-MM-DD`) and times (`HH:MM`) are floating, with no zone. The app reads "today" from the
device clock. The server uses the user's `timezone` setting (default `America/Los_Angeles`, changed in
Settings) only for MCP's notion of today and overdue.

## Gotchas

- `/register` is the OAuth dynamic client registration endpoint; the SPA's sign-up page is `/signup`.
- The service worker must never answer Worker-owned paths: keep `navigateFallbackDenylist` in
  `vite.config.ts` in step with `assets.run_worker_first` in `wrangler.jsonc`.
- Save-the-date is read-only here and opt-in per account, and save-the-date keeps the list of
  connected accounts. Connecting starts from its Todo app panel, which mints a one-time code and
  sends the browser to `/connect/save-the-date?code=…`, a server-rendered consent page like
  `/authorize`; approving redeems the code over the `STD` binding and redirects back to save-the-date.
  There is no todo-app UI or schema for this.
- Save-the-date entries arrive through `GET /api/std/dates`, which maps its rows to `ExternalEvent`
  and answers `{ connected: false, events: [] }` for an account that has not connected (MCP then
  leaves `save_the_date` out of `list_events`); the client caches each fetched range in IndexedDB
  (`std_cache`) for offline use.
