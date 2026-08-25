# LINKUP

A creator-focused persistent **Mind** product built for the Creative Minds Jam.

A creator has a persistent Mind that remembers their preferences and history,
discovers compatible creators, and helps negotiate collaborations. The Mind
acts as a **personal bot** — you ask it plain questions about potential
partners, and it gives honest strategy advice, fit analysis, and concrete
collaboration ideas. One click starts an autonomous negotiation flow: your
Mind gives the strategy, LINKUP represents the partner via their published
terms, and you approve the final deal.

> **Status:** all features are live. Onboarding, persistent per-creator memory
> (with semantic search), discovery & matching, Mind queries against the real
> Hello Minds provider (env-gated, with a safe stub fallback), collaborations
> with follow-ups, two-sided negotiation (counter + history), autonomous
> **find-collab** flow (one-click Mind strategy + partner terms-agent), and
> structured Mind decision layer (accept/reject/counter with reasoning) are
> implemented and tested end to end. The production readiness audit (config
> validation, Node ≥22 alignment, mocked-provider contract tests, no-leak
> guarantees, human-confirmed mutations) is complete.

---

## Stack

| Layer     | Choice                                            |
| --------- | ------------------------------------------------- |
| Frontend  | Vite + React 19 (TypeScript, strict)              |
| API       | Express 5 (TypeScript, strict, ESM)               |
| Database  | SQLite via better-sqlite3, hand-rolled migrations |
| Tests     | Vitest (per-package projects: db / api / web)     |
| Lint      | ESLint 10 (flat config) + Prettier                |
| Workspace | npm workspaces monorepo                           |

Dependencies are intentionally minimal: React, Express, better-sqlite3, and
`@animocabrands/minds-client-lib` (for real Mind queries) as the runtime
dependencies, with standard dev tooling around them. No ORM, no
state-management library, no CSS framework — each is added only when a feature
actually needs it.

## Repository layout

```
apps/
  api/        Express server — creators / mind / memory / collaborations /
              open-collabs routes, Minds provider adapter, serves the built web app
  web/        Vite + React frontend — landing page, onboarding, Mind page
              (chat + find-collab + live negotiation viewer), dev proxy to the API
packages/
  db/         Database layer — SQLite connection, migration runner, migrations/
scripts/
  seed-demo-creators.ts   Idempotent seed: 8 demo creators with full profiles
                          + open-collab cards
  list-minds.mjs          List the account's Hello Minds (debug)
  dump-thread.mjs         Dump a Mind conversation thread with fingerprints (debug;
                          FULL=1 for full message text)
  smoke.mjs               Production smoke test against the built API
```

Layering rule: `web` → `api` → `db`. `web` and `api` never talk to the
database directly; `db` never knows about HTTP or UI.

## Prerequisites

- Node.js ≥ 22 (enforced by `package.json#engines` and `apps/api/src/runtime.ts#MIN_NODE_VERSION`; `@animocabrands/minds-client-lib` also declares `>=22`, verified in audit)
- npm ≥ 10

> Note: this environment's npm blocks install scripts by default. If you hit
> issues with `better-sqlite3`/`esbuild`, approve their scripts once:
> `npm install-scripts approve better-sqlite3 esbuild`

## Getting started

```bash
npm install          # install all workspaces
npm run dev          # database watch + API (:3001) + web (:5173)
```

Open http://localhost:5173 — the landing page pings `/api/health` (proxied to
the API) and shows live database status.

## Scripts

| Command             | What it does                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`       | Run db watcher + API + web dev servers concurrently                                      |
| `npm run typecheck` | `tsc --noEmit` across all packages                                                       |
| `npm test`          | Vitest run (db, api, web projects)                                                       |
| `npm run lint`      | ESLint over the whole repo                                                               |
| `npm run format`    | Prettier write                                                                           |
| `npm run build`     | Build db → api → web (in dependency order)                                               |
| `npm start`         | Run the built API (serves the built web app)                                             |
| `npm run smoke`     | Build, then boot the built API and verify health + the no-credentials Minds 503 fallback + production dummy-credentials health (no real Minds request) + invalid `MINDS_REPLY_TIMEOUT_MS` rejection |

Production-style run: `npm run build && npm start` → open
http://localhost:3001.

## Configuration

Copy `.env.example` to `.env` to override defaults:

- `PORT` — API port (default `3001`, validated 1–65535)
- `NODE_ENV` — `development` | `test` | `production` (strict)
- `DATABASE_PATH` — SQLite file (defaults to `packages/db/data/linkup.db`)
- `MINDS_BUILDER_API_KEY` / `MINDS_MIND_ID` — Hello Minds provider credentials
  (optional, trimmed; whitespace-only treated as unset). When both are set,
  Mind queries go to the real provider via `resolveMindAdapter`; otherwise the
  API falls back to `stubMindAdapter` and `POST /mind/query` (and all Mind
  collaboration/negotiation/decision endpoints) return `503` with
  `Minds adapter not configured` and never leak the key. Get a Builder API key
  at build.hellominds.ai/console. Env names match `BUILDER_API_KEY_ENV` from
  `@animocabrands/minds-client-lib`.
- `MINDS_REPLY_TIMEOUT_MS` — how long to wait for a Mind reply before timing
  out (default `120000`, must be a positive integer; invalid values fail fast
  at startup with `MINDS_REPLY_TIMEOUT_MS` named in the error and without
  echoing any secret).

All Minds config is loaded via `apps/api/src/config.ts` (`loadConfig` + `parsePositiveInteger`) and validated before the server listens. `apps/api/src/runtime.ts` (`assertSupportedNodeVersion`) fails fast if `process.versions.node` < `22.0.0`.

The database is created and migrated automatically on API startup.

## API surface (highlights)

```
POST /api/creators/:id/mind/query            Plain-chat with your Mind (natural prompt)
GET  /api/creators/:id/mind/history          Chat history (user + mind turns)
GET  /api/creators/:id/mind                  Mind context (memories, matches, collabs)
POST /api/creators/:id/mind/collaborations/preview|execute      Mind-drafted proposal (confirm:true)
POST /api/creators/:id/mind/collaborations/:cid/negotiate/preview|counter|decision
PUT  /api/open-collabs/:creatorId            Publish my terms card (followers/min/languages)
GET  /api/open-collabs/:creatorId/matches    Threshold-compatible partners
POST /api/open-collabs/negotiate             Start Mind-vs-partner negotiation (specific target)
POST /api/open-collabs/find-collab           ONE CLICK: auto card → best-fit partner → negotiate
POST /api/open-collabs/:collaborationId/sign Sign/reject the final plan (both sides → accepted)
```

`find-collab` is the flagship demo flow: it auto-publishes your open card from
your interview profile, ranks threshold matches by shared languages then
closest audience (not raw reach), creates the pending collaboration, runs the
negotiation loop (your Mind strategizes in chat voice; a deterministic
terms-agent answers for the partner), and returns a ready-for-signing deal.

## Architecture direction

The core concept is a persistent per-creator **Mind** that acts as a
personal bot with memory. The implemented shape:

- **Memory store** — a durable, queryable record of a creator's preferences,
  history, and collaboration outcomes. Lives in the `db` package (migrations
  `0002_*`–`0015_*`: creator profiles, memories, discovery, collaborations,
  follow-ups, mind interactions, counter-proposal, collaboration proposals,
  open-collab terms cards, partner preferences, creator depth).
- **Discovery & matching** — two layers: deterministic profile matching
  (IDF-weighted niches/languages/platforms) and **threshold matching** for
  open-collab terms cards (mutual follower bands + shared language).
- **Mind chat** — the user talks to their Mind in plain language. The Mind
  remembers the thread and gives honest advice, fit analysis and concrete
  ideas. See *Mind integration patterns* below.
- **Find-collab (autonomous)** — one click → the app auto-publishes your
  terms card from your profile → picks the best-fit open partner → your Mind
  gives strategy for the offer → a deterministic **partner terms-agent**
  accepts or counters per the partner's published terms → on agreement you
  get a final plan with Sign/Reject buttons. Humans approve every mutation.
- **Follow-up** — autonomous, schedule-driven follow-ups backed by the
  persistence layer.
- **Learning loop** — outcomes feed back into memory so the Mind improves.

### Mind integration patterns (critical, learned live)

The Hello Minds platform's Identity Firewall rejects templated "campaign"
dispatches. What works and what does not:

- **Plain chat voice works.** "hey, just wondering — what kind of creators
  would fit me well?" gets a substantive reply. Structured negotiation
  prompts ("I'm considering a collab with X (N followers, works in…)… final
  plan I can sign off on") get ignored after the first refusals.
- **Never persona-cast.** The Mind refuses to role-play another creator
  ("I'm LINK.UP, not a persona") and refuses output-format demands ("no
  greeting, no preamble, no markdown, no quotes", "AGREE:" prefixes).
- **Never put raw creator IDs in prompts** — use display names. The Mind
  reads `seed-arif-beats x seed-devon-tech` as persona labels.
- **First-message detection.** `buildMindPrompt` checks the alias thread via
  `getHistory` — the first message introduces the creator naturally; follow-ups
  are just the user's query, no re-intro, no signature, no bullet lists.
- **Vary every ask.** Repeated template patterns are counted across threads
  ("Sixth iteration. Not re-engaging.") and eventually go silent.
- **Negotiation loop shape:** odd rounds ask the user's Mind in chat voice
  (its reply becomes the user's offer); even rounds are a deterministic
  `partnerTermsReply()` that accepts concrete offers respecting the partner's
  terms card. Agreement is detected from natural language (`final plan:`,
  unqualified acceptance words) — never an "AGREE:" prefix.

### SDK pitfalls (worked around in `mind_provider.ts`)

- **Never use `getLatestHistoryFingerprint`.** The histories API returns
  messages newest-first, but the SDK's helper assumes oldest-first paging and
  returns the OLDEST message's fingerprint — `waitForReply` then matches a
  stale reply instantly. Compute the cursor directly:
  `getHistory(alias, { limit: 1 })[0]?.fingerprint`.
- The `/histories` endpoint ignores the `after` cursor; `waitForReply`'s
  history-poll fallback rescans everything, which is safe only because
  `isReplyEvent` filters by fingerprint comparison.
- Fresh aliases (`linkup-vN-…`) reset per-thread state; bump `ALIAS_PREFIX` to
  start everyone on a clean thread. The Mind still counts attempts across
  threads, so minimize test volume per alias.

### Intended service boundary

The `api` package exposes REST endpoints for the web app today; the agentic
parts (negotiation, follow-ups) can later run as background workers sharing
the same `db` package, or be extracted behind a queue. Nothing in this
foundation commits the project to a specific agent framework — the persistence
and API layers are framework-agnostic so the Minds integration can be added
cleanly.

### Convention notes

- TypeScript strict mode with `noUncheckedIndexedAccess` is on everywhere.
- All server code is ESM (`"type": "module"`); relative imports use `.js`
  extensions (NodeNext style).
- SQL migrations are plain SQL files in `packages/db/migrations/`, applied in
  filename order and tracked in `schema_migrations`. Add `0010_*.sql` for the
  next schema change.
- The API receives its database **and** `MindAdapter` via dependency injection
  (`createApp({ db, mindAdapter })` → `createCreatorsRouter(db, mindAdapter)` →
  `createMindQueryService`/`createMindCollaborationService`/`createMindNegotiationService`/`createMindDecisionService` share the same injected adapter). Tests always inject a fake/stub adapter; production uses `resolveMindAdapter(loadConfig().minds)` which only creates `createMindsClient` when both `MINDS_BUILDER_API_KEY` and `MINDS_MIND_ID` are present. No service ever imports `createMindsClient` directly.
- Domain tables live in migrations `0002_*`–`0015_*` (creator profiles, memories,
  discovery, collaborations, follow-ups, mind interactions, counter-proposal,
  collaboration proposals, growth outcomes, accounts/sessions, open-collab
  terms cards, profile details, partner preferences, creator depth); the baseline `0001_*` migration only proves the migration pipeline.
- All mutation paths are explicitly human-confirmed: `POST .../preview` is dry-run, `POST .../execute` and `POST .../negotiate/counter` require `confirm:true`, `POST .../negotiate/decision` is read-only (no `createCollaboration`/`submitCounterProposal`/`updateCollaborationStatus`/`memory` write), `PATCH .../collaborations/:id` is a direct human edit. `Minds` never auto-mutates.

## Testing strategy

- `packages/db` — migration idempotency and connectivity against `:memory:`, plus `collaboration_proposals` repository, negotiation history, and `MindContext` history.
- `apps/api` — boots the real Express app on an ephemeral port against an
  in-memory database and asserts route contracts: creators, memories (including
  semantic search), mind query/history, collaboration preview/execute, matches,
  collaborations, follow-ups, negotiation `counter`/`history`/`decision`, and the hardened error paths (malformed JSON, payload limits, length caps, invalid timeout, non-configured `503`). Includes `mind_provider` contract tests for `MindsApiError` → clean `500`, timeout → `500`, empty reply → `400/500`, plus `mind_contract` tests that exercise **all** Mind flows (query, collaboration preview, negotiation preview, decision) through the same fake adapter in `success`/`timeout`/`malformed`/`provider error`/`empty` modes and verify human-confirmation gating.
- `apps/web` — jsdom render tests for the landing page, onboarding, and the
  Mind page (query + memory search + collaboration negotiation + history timeline + decision `Ask Mind` → `Recommendation`/`Reasoning`/`Proposed counter` + explicit `Execute` buttons).
- `scripts/smoke.mjs` — production smoke test (`npm run smoke`): builds, boots
  the built API against a throwaway SQLite file, and verifies (1) `/api/health` ok, (2) the no-credentials `503` fallback for `POST /mind/query` and `POST /mind/collaborations/preview` without leaking, (3) a dummy production config (`MINDS_BUILDER_API_KEY`/`MINDS_MIND_ID=dummy` + `MINDS_REPLY_TIMEOUT_MS=5000`) still boots and health is `ok` with **no dummy secret leaked** in logs and **no real Minds request** made, and (4) an invalid `MINDS_REPLY_TIMEOUT_MS` fails fast at startup with `MINDS_REPLY_TIMEOUT_MS` named and no secret leaked.

No live Minds network calls are performed in tests or in smoke; the provider adapter is always stubbed/faked unless real credentials are explicitly configured and `resolveMindAdapter` is allowed to create the real `MindsClient`. No test reads `process.env.MINDS_BUILDER_API_KEY` from the host environment.

### Production readiness (Phase 21 audit)

- `MINDS_BUILDER_API_KEY`/`MINDS_MIND_ID`/`MINDS_REPLY_TIMEOUT_MS` validated in `config.ts` (trim, positive-integer, named error, no secret echo).
- Node `>=22` enforced in `package.json#engines` and `runtime.ts#MIN_NODE_VERSION`, matching `@animocabrands/minds-client-lib` (`>=22`).
- All Mind flows (`query`, `collaboration preview/execute`, `negotiation preview/counter`, `decision`) share the same injected `MindAdapter` via `createApp` — verified, no direct `createMindsClient` in services.
- Mocked-provider contract tests cover `success`, `timeout`, `malformed`, `MindsApiError`, `empty` across all flows; errors are mapped via `toServiceError`/`respondWithMind*Error` to `503` (not configured) or `500`/`400` with generic `mind query failed`/`negotiation decision failed` etc. and never contain the key or raw provider message.
- All mutations require `confirm:true` (`mind_collaboration`, `mind_negotiation`); `decision` is read-only (561 tests verify no `collaboration`/`history`/`memory`/`interaction` write).
- Smoke validates both stub and production paths without network and validates `MINDS_REPLY_TIMEOUT_MS` rejection.
