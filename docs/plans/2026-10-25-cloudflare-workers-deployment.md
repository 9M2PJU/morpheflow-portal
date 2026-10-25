# Cloudflare Workers Deployment & Metrics Mapping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a 100% Free Tier Cloudflare Workers deployment option for AutoMorph modeled after NodeWarden (`shuaiplus/nodewarden`), featuring a serverless edge control center (Workers + D1 + KV + Static Assets) and GitHub Actions cloud patch runner, with zero credit card required.

**Architecture:** 
- **Edge Control Plane:** Cloudflare Worker running on the 100% Free Plan serving the existing AutoMorph web dashboard via Workers Static Assets, handling REST API requests (`/api/*`), and maintaining system state, options, and metrics in Cloudflare D1 (serverless SQLite) and KV.
- **Serverless Build Runner:** GitHub Actions free runners (`ubuntu-latest` with Java 21 and Python 3.12, 7GB RAM, unlimited minutes for public repos) triggered via Worker `workflow_dispatch` on schedule or manual run, compiling APKs, publishing them to GitHub Releases, and syncing metrics back to the Worker via a secure webhook.
- **Card-Free Configuration:** Dual `wrangler.toml` and `wrangler.kv.toml` setup with automated D1 migrations and idempotent KV provisioning (`scripts/ensure-kv.cjs`), matching NodeWarden's 1-click Git deployment flow.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare D1 (SQLite), Cloudflare KV, Workers Static Assets, Wrangler, GitHub Actions, FastAPI/Python (existing container option).

---

## Metric Mapping & Research Specification

| # | Metric / State | AutoMorph Docker Origin | Cloudflare Free Tier Mapping (D1/KV) | Quota & Free Tier Compatibility |
|---|---|---|---|---|
| **M1** | **System Status (`is_running`, `active_run`)** | `runner.is_running`, `mutex.py` lock file (`state/lock.json`) | D1 `state` table (`key='active_run'`, `key='active_lock'`) + KV `active_run` key with heartbeat TTL | 1 write on start, 1 write on finish. Well within D1 100k writes/day and KV 1k writes/day. |
| **M2** | **Next Scheduled Run (`next_run`)** | `resolve_schedule_target()` computed from `schedule_time` + `timezone` in `config.yaml` | Computed in Worker `router.ts` from D1 `config` table setting (`schedule_time`, `timezone`) matched against Cloudflare Cron Trigger | Pure CPU calculation in V8 isolate (<0.1ms CPU). 0 database cost. |
| **M3** | **Last Run Summary (`last_run`)** | `tools/automorph-data/state/logs/last_run.json` (`run_id`, `status`, `duration_seconds`, `finished_at`, `source`) | D1 `run_history` table (ordered by `finished_at DESC LIMIT 1`) | 1 read query per status fetch. D1 free tier provides 5M reads/day (covers ~57 reads/sec 24/7). |
| **M4** | **Storage Statistics (`storage`)** | `get_storage_stats()` scanning `apps/patched/` and `patched.json` (`apk_count`, `total_bytes`, `formatted_size`) | D1 `patched_apps` table: `SELECT COUNT(*) AS apk_count, COALESCE(SUM(size_bytes), 0) AS total_bytes FROM patched_apps` | Fast indexed query on D1 SQLite. Cached in Worker in-memory isolate or KV for 15s. |
| **M5** | **Configured Apps & Repos (`stats`)** | `packages` count and distinct `repos` in `config.yaml` | D1 `packages` table: `COUNT(*)` for configured apps, distinct repos parsed from `repos` JSON array | Negligible cost. Fits easily within 5M D1 row reads/day. |
| **M6** | **Version Metadata (`version`)** | `web/version.json` (`version`, `branch`, `run_number`, `commit`) | Worker constant or `web/version.json` served via Workers Static Assets | Free & unlimited requests via Workers Static Assets. |
| **M7** | **Live Execution Logs (`/api/run/logs`, `/api/run/stream`)** | In-memory `deque` ring buffer (2000 lines) + SSE stream | D1 `run_logs` table (stored per run) or KV chunks; live SSE streaming via Worker `TransformStream` | Within 25MB KV limit and 500MB D1 DB limit. Automatically pruned to `max_logs`. |
| **M8** | **HTML Build Report (`/report`, `build_report.html`)** | `tools/automorph-data/state/reports/build_report.html` | Stored in D1/KV upon run completion and served directly at `/report` with `Content-Type: text/html` | Fast edge delivery, zero server required. |

---

## Bite-Sized Implementation Tasks

### Task 1: Database Schema & D1 Migrations
**Files:**
- Create: `migrations/0001_init.sql`

**Step 1: Write D1 migration script**
Create `migrations/0001_init.sql` with tables:
- `config`: `key TEXT PRIMARY KEY, value TEXT NOT NULL`
- `packages`: `package TEXT PRIMARY KEY, package_name TEXT, enabled INTEGER NOT NULL DEFAULT 1, repos TEXT NOT NULL DEFAULT '[]', patch_aliases TEXT NOT NULL DEFAULT '[]', options TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL`
- `patched_apps`: `package TEXT NOT NULL, version TEXT NOT NULL, arch TEXT NOT NULL, filename TEXT NOT NULL, size_bytes INTEGER NOT NULL, formatted_size TEXT NOT NULL, sha256 TEXT, download_url TEXT NOT NULL, release_url TEXT, applied_patches TEXT NOT NULL DEFAULT '[]', result_json TEXT, patched_at TEXT NOT NULL, PRIMARY KEY(package, version)`
- `run_history`: `run_id TEXT PRIMARY KEY, status TEXT NOT NULL, returncode INTEGER NOT NULL, duration_seconds REAL NOT NULL, duration_formatted TEXT NOT NULL, source TEXT NOT NULL, package TEXT, finished_at REAL NOT NULL`
- `run_logs`: `run_id TEXT NOT NULL, log_text TEXT NOT NULL, created_at REAL NOT NULL, PRIMARY KEY(run_id, created_at)`
- `state`: `key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at REAL NOT NULL`

**Step 2: Commit**
`git add migrations/0001_init.sql`
`git commit -m "feat(cf): add initial D1 database schema for automorph"`

---

### Task 2: Cloudflare Worker Configuration & Scripts
**Files:**
- Create: `wrangler.toml`
- Create: `wrangler.kv.toml`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `scripts/ensure-kv.cjs`

**Step 1: Create `package.json` with NodeWarden-style scripts**
- Scripts: `build`, `dev`, `dev:kv`, `deploy`, `deploy:kv`.
- Dependencies: `@cloudflare/workers-types`, `typescript`, `wrangler`.

**Step 2: Create `wrangler.toml` and `wrangler.kv.toml`**
- Configure Workers Static Assets pointing to `./web/frontend`.
- Configure D1 binding `DB` and Cron Trigger `["0 3 * * *"]`.
- `wrangler.kv.toml` adds KV binding `STATE_KV`.

**Step 3: Create `scripts/ensure-kv.cjs`**
- Idempotently creates and pins KV namespace `STATE_KV` if not already pinned, identical to NodeWarden.

**Step 4: Commit**
`git add wrangler.toml wrangler.kv.toml package.json tsconfig.json scripts/ensure-kv.cjs`
`git commit -m "feat(cf): add wrangler configuration and zero-card KV setup script"`

---

### Task 3: Worker TypeScript Types & Storage Service
**Files:**
- Create: `worker/types.ts`
- Create: `worker/storage.ts`

**Step 1: Define `worker/types.ts`**
- Cloudflare `Env` with `DB: D1Database`, `STATE_KV?: KVNamespace`, `ASSETS: Fetcher`, `GITHUB_TOKEN?: string`, `GITHUB_REPO?: string`, `WEBHOOK_SECRET?: string`.
- Data interfaces matching AutoMorph FastAPI models: `StatusResponse`, `AppConfig`, `SystemSettings`, `EmailSettings`, `StorageStats`, `RunSummary`.

**Step 2: Implement `worker/storage.ts`**
- `initializeDatabase(db: D1Database): Promise<void>` (runs schema statements idempotently).
- CRUD methods for `config`, `packages`, `patched_apps`, `run_history`, `run_logs`, `state`.
- Calculations for `getStorageStats()` and `getAggregatedStatus()`.

**Step 3: Commit**
`git add worker/types.ts worker/storage.ts`
`git commit -m "feat(cf): implement D1 storage service and data models"`

---

### Task 4: Worker API Router & Main Entrypoint
**Files:**
- Create: `worker/router.ts`
- Create: `worker/index.ts`

**Step 1: Implement `worker/router.ts`**
- Route handlers for all AutoMorph API endpoints:
  - `GET /api/status`, `GET /api/version`, `GET /api/config`, `GET /api/settings`
  - `POST /api/config/app`, `POST /api/config/app/toggle`, `DELETE /api/config/app/:pkg`
  - `GET /api/config/repos`, `POST /api/config/repos`, `DELETE /api/config/repos`
  - `POST /api/settings/system`, `POST /api/settings/tunnels`, `POST /api/settings/email`, `POST /api/settings/email/test`
  - `GET /api/catalog` (fetches/caches Morphe bundles JSON)
  - `GET /api/options/:pkg`, `POST /api/options-fetch/:pkg`, `POST /api/options/:pkg/:owner`
  - `GET /api/files`, `GET /files/*`
  - `POST /api/run`, `POST /api/run/:pkg`, `POST /api/run/stop`
  - `GET /api/run/logs`, `GET /api/run/stream`
  - `POST /api/webhook/report` (runner callback for build completion)
  - `GET /report`, `GET /api/run/report`

**Step 2: Implement `worker/index.ts`**
- `fetch(request, env, ctx)`: Serves static assets via `env.ASSETS.fetch(request)` or routes to `handleRequest(request, env, ctx)`.
- `scheduled(event, env, ctx)`: Invoked by Cloudflare Cron Trigger, launches automated daily run.

**Step 3: Commit**
`git add worker/router.ts worker/index.ts`
`git commit -m "feat(cf): implement worker router, asset serving, and cron handler"`

---

### Task 5: Serverless Cloud Patch Runner on GitHub Actions
**Files:**
- Create: `.github/workflows/automorph-cloud-builder.yaml`

**Step 1: Write cloud build workflow**
- Triggered by `workflow_dispatch` (with optional package input) or repository dispatch.
- Matrix setup: Ubuntu runner with Java 21 JRE, Python 3.12, Android tools.
- Syncs configured packages from Worker API or local config.
- Runs `python scripts/main.py`.
- On success, creates a GitHub Release with the patched APK and `result.json`.
- Dispatches run summary, duration, and download links back to Cloudflare Worker `/api/webhook/report`.

**Step 2: Commit**
`git add .github/workflows/automorph-cloud-builder.yaml`
`git commit -m "feat(ci): add serverless GitHub Actions cloud patch runner"`

---

### Task 6: Cloudflare Worker CI/CD Deployment Workflow
**Files:**
- Create: `.github/workflows/deploy-cloudflare.yaml`

**Step 1: Write Cloudflare Worker deployment workflow**
- Runs on push to `main` when `worker/**`, `migrations/**`, `wrangler*.toml`, or `web/frontend/**` changes.
- Uses `cloudflare/wrangler-action` to deploy to Cloudflare Workers automatically.

**Step 2: Commit**
`git add .github/workflows/deploy-cloudflare.yaml`
`git commit -m "feat(ci): add automated Cloudflare Worker deployment workflow"`

---

### Task 7: Comprehensive Documentation & User Guides
**Files:**
- Create: `docs/cloudflare-workers-setup.md`
- Modify: `docs/README.md`
- Modify: `README.md`

**Step 1: Write `docs/cloudflare-workers-setup.md`**
- Detailed visual guide explaining:
  - Architecture (Edge Control Center + Free Cloud Runner).
  - 100% Free Tier confirmation (0 card required with D1 + KV + GitHub Actions).
  - 1-Click Deploy via Cloudflare Dashboard or Wrangler CLI (`npm run deploy:kv`).
  - GitHub Token configuration for automated workflow dispatch.
  - Custom domain vs `*.workers.dev`.

**Step 2: Update `docs/README.md` and `README.md`**
- Add Cloudflare Workers as a first-class deployment option alongside Docker and Oracle Cloud.

**Step 3: Commit**
`git add docs/cloudflare-workers-setup.md docs/README.md README.md`
`git commit -m "docs: add Cloudflare Workers deployment guide and update documentation hub"`
