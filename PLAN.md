# Todo + Calendar app: implementation plan (long-horizon handoff)

## Context

Matteo wants a personal TODO app with an integrated calendar, usable on desktop web and as an offline-capable PWA on phone. It must show dates from his existing save-the-date app, and expose all data to Claude through an MCP connector so he can say "create an event", "what's my day look like", etc.

The repo `/home/matte/todo-app` is empty (one commit, README only). This plan was refined with Matteo; every decision below is settled unless listed under Open items. The executing agent should treat it as the spec.

## Settled decisions

| Area | Decision |
|---|---|
| Users | Single user in practice, but real accounts: `users` table, per-user data scoping, invite-code registration. Copy the dungeon-manager auth pattern. |
| Stack | Clone dungeon-manager's architecture: one Cloudflare Worker serving Vite + React 19 SPA as static assets, hand-written router, D1, zod schemas in `shared/`, lucide-react, Figtree, **custom CSS (no Tailwind)**. |
| Hosting | Own subdomain `todo.matteob.dev` (Worker custom domain on zone `matteob.dev`). App at `/`, API at `/api/*`, MCP at `/mcp`, OAuth at `/authorize`, `/token`, `/register`, `/.well-known/*`. No base path. |
| Offline | Offline-first. IndexedDB mirror + mutation outbox, syncs on reconnect. Last-write-wins per record. |
| Reminders | None in v1. |
| Save-the-date | **Read-only**, fetched live through a service binding. Shows proposed (hatched), upcoming and saved. |
| Recurrence | RRULE subset (daily / weekly on chosen weekdays / monthly / yearly, interval, end: never / until date / count). Edit or delete "this occurrence" or "whole series". Todo items do not recur. |
| Week view | Sunday to Saturday around the selected date (the month grid starts on Sunday too). |
| Item order | Auto: overdue, then by due date/time, then undated (by created), each item followed by its open subtasks (one level deep). Completed collapsed at bottom as "Completed (n)". Long-press and drop an item onto another to make it a subtask, or onto empty space to make it top-level; dragging never reorders items. A parent's subtasks fold away behind a chevron (remembered per device). Lists are reordered by long-press and drag. |
| Overdue | Red in lists; pinned in an "Overdue" section at the top of today's agenda and in Claude's rundown. |
| Timezone | Floating local times (`YYYY-MM-DD`, `HH:MM`, no zone), same as save-the-date. A per-user `timezone` setting (default `America/Los_Angeles`) is used only by the server to know "today" (MCP rundown, overdue). |

## Reference code to reuse (read, don't import)

- `/home/matte/dungeon-manager`: overall layout (`worker/router.ts`, `worker/http.ts`, `shared/`), `wrangler.jsonc` with `run_worker_first`, `vite.config.ts`, auth (`worker/auth/password.ts` PBKDF2 100k, `worker/auth/session.ts` sha256-hashed session ids, `worker/routes/auth.ts` invite via `REGISTRATION_SECRET`, `migrations/0001_init.sql`), tests (`vitest.config.ts` with `unit` + `worker` projects, `test/worker/apply-migrations.ts`), npm scripts (`test`, `typecheck`, `types`, `deploy`). Drop the base-path handling since this app lives at `/`.
- `/home/matte/webtunes`: PWA icons script `scripts/generate-icons.mjs`, IndexedDB patterns in `src/lib/offline/`.
- `/home/matte/save-the-date/sw.js`: network-first navigations + `updateViaCache: "none"` lesson for picking up deploys.
- Conventions: D1 ids are TEXT UUIDs, timestamps INTEGER unix ms, numbered SQL migrations, `wrangler types`.

## Data model (D1)

Every user-owned table has `user_id`, `created_at`, `updated_at`, `seq` (INTEGER, from a per-user monotonic counter bumped on every write), `deleted_at` (soft delete, for sync tombstones).

- `users(id, email, password_hash, timezone, created_at)`; `sessions(id = sha256(token), user_id, expires_at)` with 90-day sliding expiry so the PWA stays logged in.
- `user_seq(user_id PK, value)`: sync cursor source.
- `lists(id, name, color, sort_order)`. `color` is a palette key.
- `items(id, list_id, title, notes, due_date?, due_time?, completed_at?, parent_id?)`. `parent_id` makes a subtask of a top-level item in the same list.
- `events(id, title, notes, color, all_day, start_date, start_time?, end_date, end_time?, rrule?)`. Date ranges via `start_date..end_date`; time ranges via times; timed events may cross midnight via `end_date`.
- `event_exceptions(id, event_id, occurrence_date, cancelled, title?, notes?, color?, start_date?, start_time?, end_date?, end_time?, all_day?)`: per-occurrence override or cancellation. Unique on `(event_id, occurrence_date)`.
- OAuth state lives in KV (`OAUTH_KV`) as required by `@cloudflare/workers-oauth-provider`.

Palette: ~10 fixed colour keys, each with a light and dark theme value, defined once in `shared/palette.ts`. Save-the-date uses a fixed pink (`#d6336c`, its theme colour).

## Shared logic (`shared/`, used by client, API and MCP)

- zod schemas for every entity and every mutation.
- `recurrence.ts`: parse/serialize the RRULE subset and `expandOccurrences(event, exceptions, from, to)`. Hand-written, since floating times make `rrule.js` awkward and the subset is small. Heavily unit tested (month-end days, Feb 29 yearly, weekly multi-day, COUNT with cancelled occurrences, multi-day events overlapping the range start).
- `agenda.ts`: builds a day's ordered agenda (all-day and multi-day bars first, then timed by start; due items with time slotted in; items without time listed after) and the overdue set. Used by the calendar UI and `get_agenda`, so the UI and Claude agree.

## API (`/api/*`, session cookie)

- Auth: `POST /api/auth/register` (invite), `/login`, `/logout`, `GET /api/auth/me`, `PATCH /api/settings` (timezone).
- Sync: `GET /api/sync?since=<seq>` returns all rows (including tombstones) with `seq > since` plus the new cursor. `POST /api/mutations` takes a batch of `{op_id, entity, action: upsert|delete, record}` with client-generated UUIDs; idempotent by `op_id`; LWW by server arrival order. Returns applied seqs.
- Save-the-date proxy: `GET /api/std/dates?from&to` calls save-the-date through the service binding and maps rows to a read-only `ExternalEvent` shape (`title`, `start_date`, `end_date` from `duration`, `start_time`, `status`, `location`).
- All writes (API and MCP) go through one service layer in `worker/services/` so seq bumping and validation live in one place.

## Client data layer

- IndexedDB (`idb`) stores mirroring D1 tables, plus `outbox`, `meta` (cursor) and `std_cache` (last fetched ranges, for offline read).
- Writes apply optimistically to IDB, enqueue in outbox, then flush. Flush triggers: app start, `online`, `visibilitychange` to visible, after each write, and a 60 s interval while visible. No Background Sync API (iOS lacks it).
- Pull `/api/sync` after each flush and on the same triggers, so changes Claude makes via MCP appear within a minute or on focus.
- A small store (zustand or React context) exposes live queries over IDB to components.

## UI

Two tabs (bottom tab bar on mobile, top/side on desktop): **Todo** and **Calendar**. Light and dark themes via CSS variables. Safe-area insets for the installed PWA.

**Todo tab**
- List index: each list shows colour, name, and `uncompleted / completed` counts. Create, rename, recolour, delete (confirm).
- List detail: add item inline; item row has checkbox, title, due date/time chip (red if overdue); tap opens editor (title, notes, due date, optional due time, move to list, delete). Ordering per settled decision.

**Calendar tab**
- Header shows the current period (e.g. "September 2026", or the week / day range), prev/next, a Today button, and a Month / Week / Day toggle. The selected date carries across views.
- Month: grid with today highlighted and selected date outlined. Under each date number, dots in list colours for uncompleted items due that day (max 3, then "+"). Events and save-the-date dates render as coloured bars, multi-day bars spanning cells; save-the-date proposed ones hatched. Selecting a date shows that day's agenda below the grid (see `agenda.ts`), with item checkboxes working inline and an Overdue section when the date is today.
- Week (Sunday to Saturday) and Day: all-day row with bars and untimed due items, then an hourly time grid with timed events as blocks (overlaps laid out side by side), timed due items as small markers, a now-line on today, auto-scrolled to the current time.
- Event editor: title, notes, colour, all-day toggle, start/end date, start/end time, repeat (preset + custom interval/weekdays/end). Editing a recurring occurrence asks "This event / All events". Save-the-date entries open a read-only sheet with a link to save-the-date.

## PWA

- `vite-plugin-pwa` (generateSW) to precache hashed build assets; navigation fallback to `index.html`; exclude `/api`, `/mcp`, `/authorize`, `/token`, `/register`, `/.well-known`. Register with `updateViaCache: "none"`; show a "New version, reload" toast on update.
- Manifest (standalone, theme colours, 192/512/maskable icons generated as in webtunes), apple-touch-icon and iOS meta tags.
- Offline acceptance: installed app cold-starts with network off, shows data, accepts edits, and syncs them when network returns.

## Save-the-date change (separate repo)

Matteo authorised editing and pushing save-the-date for this. **Pull first** (`git pull` in `/home/matte/save-the-date`; last seen at `57222d5`). Follow its `CLAUDE.md` (no co-author trailer, commit message plain, end replies with "What do you think, Matteo?").

- In `worker/src/index.ts` auth check (around lines 54-58): also accept `Authorization: Bearer <TODO_APP_TOKEN>` (new Worker secret), allowed **only** for `GET /api/dates`. Everything else keeps requiring `APP_PASSWORD`.
- No CORS change (the call is Worker-to-Worker). No schema change.
- Update `README.md`/`CLAUDE.md` there to mention the token.
- Commit and push with no co-author. Setting the secret (`wrangler secret put TODO_APP_TOKEN`) and deploying save-the-date are outward-facing: confirm with Matteo before running them.
- In todo-app `wrangler.jsonc`: `services: [{ binding: "STD", service: "save-the-date" }]`, secret `STD_TOKEN` with the same value.

## MCP connector

- `@cloudflare/workers-oauth-provider` wraps the Worker: `/authorize` renders a consent page that requires the normal session login, then completes the grant with `{ userId }` props. Dynamic client registration enabled (claude.ai custom connectors need it).
- MCP server over Streamable HTTP at `/mcp` using the Cloudflare `agents` package. Prefer the stateless handler if current docs support it with the OAuth provider; otherwise `McpAgent` on a Durable Object. Check the `agents-sdk` / `cloudflare` skills for the current API before writing it.
- Tools (all call `worker/services/`, all scoped to the OAuth user; dates as `YYYY-MM-DD` in the user's timezone; lists accept id or case-insensitive name):
  - `get_agenda(date?, days?)`: the day rundown: overdue items, events (expanded), due items, save-the-date dates.
  - `list_lists`, `create_list`, `update_list`, `delete_list`
  - `list_items(list?, status?, due_from?, due_to?)`, `create_item`, `update_item` (includes complete/uncomplete, move), `delete_item`
  - `list_events(from, to)` (expanded occurrences, includes read-only save-the-date entries marked `source: "save-the-date"`), `create_event`, `update_event(id, scope: "occurrence"|"series", occurrence_date?)`, `delete_event(same scope args)`
  - `search(query)` across items and events.
- Tool descriptions state the timezone and read-only nature of save-the-date entries so Claude doesn't try to edit them.

## Build order (review each step when it lands)

1. Scaffold from dungeon-manager layout; `wrangler.jsonc` (custom domain `todo.matteob.dev`, D1 `DB`, KV `OAUTH_KV`, service binding `STD`, `run_worker_first` for API/MCP/OAuth paths); vitest projects; npm scripts. Verify: `npm test`, `npm run typecheck` pass on an empty app.
2. Auth + migrations. Verify: worker tests for register/login/session like dungeon-manager.
3. Data model, service layer, sync and mutation endpoints, `shared/` schemas, `recurrence.ts`, `agenda.ts`. Verify: unit tests for recurrence and agenda; worker tests for sync cursor, tombstones, idempotent mutations, user isolation.
4. Client data layer (IDB, outbox, sync loop). Verify: unit tests with `fake-indexeddb` for outbox flush and cursor handling.
5. Todo tab. 6. Calendar month + agenda. 7. 7-day and Day views. Verify each in the browser (`run` skill) on desktop and a mobile viewport.
8. Save-the-date: repo change and push, then proxy endpoint and rendering. Verify: worker test with a mocked `STD` binding; manual check against real data after Matteo approves deploy.
9. PWA hardening. Verify offline acceptance above in Chrome DevTools and on a phone.
10. OAuth + MCP. Verify: worker tests calling each tool; MCP Inspector against `wrangler dev`; then add as a custom connector in claude.ai and ask for a day rundown and to create/delete an event.
11. Independent architecture review by a subagent (spans many files); full test suite; report failures by cause.

## Operating rules for the executing agent

- Long horizon: use the strongest model for subagents; plan per step, review per step.
- Global `CLAUDE.md` applies: custom CSS only, minimal code, comments only for invariants, no AI-slop prose.
- **Do not commit in todo-app unless Matteo asks.** The only pre-authorised git action is the save-the-date commit + push (no co-author).
- Confirm before any deploy, DNS/custom-domain creation, D1/KV creation on the real account, or secret setting.
- Add a `CLAUDE.md` to todo-app documenting commands, bindings, secrets (`REGISTRATION_SECRET`, `STD_TOKEN`), and the sync model.

## Verification (end to end)

- `npm test` (unit + worker projects) and `npm run typecheck` green.
- Browser: create a list, add items with due dates, see coloured dots on the calendar and items in the day agenda; complete one and see counts update; create a weekly recurring timed event, edit one occurrence, delete another; check month bars, 7-day grid, day grid, now-line.
- Offline: install PWA, go offline, edit, reconnect, confirm server has the edits.
- Save-the-date dates appear with correct stage styling and are not editable.
- Claude connector: "give me a rundown of today", "create an event tomorrow 3 to 4pm called Dentist", "mark X done"; changes appear in the open app within a minute.

## Open items (small, executing agent may decide and note)

- Exact palette values and dark-theme treatment.
- Whether completed items with due dates still show in the day agenda (suggest: yes, struck through, no dot).
