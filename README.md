# LINKUP

A creator-focused persistent **Mind** product built for the Creative Minds Jam.

A creator has a persistent Mind that remembers their preferences and history,
discovers compatible creators, negotiates collaborations with other Minds,
follows up autonomously, and learns from collaboration outcomes — all aimed at
audience growth and engagement.

> **Status:** creator features are landing in phases on a proven foundation.
> Onboarding, persistent per-creator memory (with semantic search), discovery
> & matching, Mind queries against the real Hello Minds provider (env-gated,
> with a safe stub fallback), collaborations with follow-ups, two-sided
> negotiation (counter + history), append-only negotiation history, and
> structured Mind decision layer (accept/reject/counter with reasoning) are
> implemented and tested end to end. Production readiness audit (config
> validation, Node ≥22 alignment with `@animocabrands/minds-client-lib`,
> mocked-provider contract tests, no-leak guarantees, human-confirmed
> mutations) is complete — real Minds activation is the only remaining step
> before final production cutover.

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
  api/        Express server — creators / mind / memory / collaborations routes,
              Minds provider adapter, serves the built web app
  web/        Vite + React frontend — landing page, onboarding, Mind page
              (query + memory search), dev proxy to the API
packages/
  db/         Database layer — SQLite connection, migration runner, migrations/
scripts/
  smoke.mjs   Production smoke test against the built API
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

## Architecture direction

The core concept is a persistent per-creator **Mind** that acts as an
autonomous agent with memory. The planned shape:

- **Memory store** — a durable, queryable record of a creator's preferences,
  history, and collaboration outcomes; the foundation everything else builds
  on. Designed to live in the `db` package (new migrations add domain tables).
- **Discovery & matching** — find compatible creators and score potential
  collaborations, driven by the memory store.
- **Negotiation** — Minds negotiate collaboration terms with each other;
  structured, logged, and resumable (a prerequisite for autonomous follow-up).
- **Follow-up** — autonomous, schedule-driven follow-ups that don't require the
  creator to be present, backed by the persistence layer for continuity.
- **Learning loop** — outcomes feed back into memory so the Mind improves.

### Intended service boundary

The `api` package will expose REST endpoints for the web app today; the agentic
parts (negotiation, follow-ups) can later run as background workers sharing the
same `db` package, or be extracted behind a queue. Nothing in this foundation
commits the project to a specific agent framework — the persistence and API
layers are framework-agnostic so the Minds integration can be added cleanly.

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
- Domain tables live in migrations `0002_*`–`0009_*` (creator profiles, memories,
  discovery, collaborations, follow-ups, mind interactions, counter-proposal,
  collaboration proposals); the baseline `0001_*` migration only proves the migration pipeline.
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
- All mutations require `confirm:true` (`mind_collaboration`, `mind_negotiation`); `decision` is read-only (`512` tests verify no `collaboration`/`history`/`memory`/`interaction` write).
- Smoke validates both stub and production paths without network and validates `MINDS_REPLY_TIMEOUT_MS` rejection.
