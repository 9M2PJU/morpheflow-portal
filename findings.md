# MorpheFlow Deep Logic & Code Quality Audit — Discovered Findings

## Executive Summary
This document records all bad code logic patterns, architectural anti-patterns, race conditions, edge-case vulnerabilities, and reliability bottlenecks discovered during the deep layer-by-layer audit of the MorpheFlow codebase.

---

## Layer 1: Frontend Client Architecture & State Flow
**Files**: `web/frontend/js/app.js`, `web/frontend/index.html`, `web/frontend/css/morphe.css`

### Finding F-01: Zombie / Phantom Route Subsystem & Hash Hijacking
- **Location**: `web/frontend/js/app.js` (lines 384-401, 10093-10330)
- **Severity**: Medium
- **Bad Logic Pattern**:
  `handleHashRouting()` listens for `#files` and `#files/<pkg>` and delegates to `switchTab('files')`. However, `switchTab()` (line 1180) redirects `files` to `apps`. Meanwhile, `app.js` contains over 220 lines of dead file-browser code (`loadFiles`, `files-table-body`, `files-breadcrumbs`, `btn-open-files`) that query DOM elements deleted from `index.html`. Furthermore, `loadFiles()` attempts to call `history.replaceState` with `#/files`, causing conflicting navigation loops and potential blank view rendering.
- **Root Cause**: Leftover relic from AutoMorph's legacy local-server file browser before migration to Cloudflare Worker + GitHub Releases storage.
- **Optimized Solution**:
  Prune the dead file-browser subsystem from `app.js`. Route any legacy `#files` hashes cleanly to the Releases / GitHub Artifacts view with a dismissible informative toast.

---

### Finding F-02: Busy-Waiting Polling Loop in Catalog Fetcher
- **Location**: `web/frontend/js/app.js` (lines 7800-7806)
- **Severity**: High
- **Bad Logic Pattern**:
  ```javascript
  if (isFetchingMorpheCatalog) {
    while (isFetchingMorpheCatalog) {
      await new Promise(r => setTimeout(r, 50));
    }
    return morpheCatalogData;
  }
  ```
  Uses an active polling loop sleeping 50ms repeatedly to wait for another in-flight catalog fetch. If the initial fetch hangs, is delayed by network throttles, or fails to reset the flag on unhandled rejection, all subsequent callers freeze in an infinite loop, thrashing the browser thread.
- **Optimized Solution**:
  Implement Promise coalescing (Singleflight memoization):
  ```javascript
  let inFlightCatalogPromise = null;
  export async function fetchMorpheCatalog(force = false) {
    if (inFlightCatalogPromise && !force) return inFlightCatalogPromise;
    inFlightCatalogPromise = (async () => {
      try {
        return await _doFetchCatalog(force);
      } finally {
        inFlightCatalogPromise = null;
      }
    })();
    return inFlightCatalogPromise;
  }
  ```

---

### Finding F-03: SemVer Parsing Discards Pre-release Identifiers
- **Location**: `web/frontend/js/app.js` (lines 1846-1869)
- **Severity**: High
- **Bad Logic Pattern**:
  ```javascript
  function parseSemVer(v) {
    const clean = v.replace(/^[vV]/, '').trim();
    const base = clean.split(/[-_+]/)[0];
    const parts = base.split('.').map(n => parseInt(n, 10));
    ...
  }
  ```
  `parseSemVer` strips everything after `-`, `+`, or `_`. Consequently, `compareSemVer('1.2.3-beta.1', '1.2.3')` returns `0` (equal).
  Per SemVer 2.0.0 §9 and §11, a pre-release version has lower precedence than the normal version (`1.2.3-beta.1 < 1.2.3`). Additionally, two beta versions (`1.2.3-beta.1` vs `1.2.3-beta.2`) compare as identical, preventing users from receiving notifications for subsequent beta or final release updates.
- **Optimized Solution**:
  Port the robust SemVer parser from `web/backend/update_checker.py` which tracks `(major, minor, patch, is_stable, prerelease_num)` tuples.

---

### Finding F-04: SessionStorage Quota Exceeded Crash on Large Bundles
- **Location**: `web/frontend/js/app.js` (lines 7996-7998)
- **Severity**: Medium
- **Bad Logic Pattern**:
  Entire raw bundles, compatibility matrices, and catalog datasets (which frequently exceed 3-5MB total JSON string size) are simultaneously saved to `sessionStorage`. On mobile WebViews and private tabs, the strict 5MB quota is exceeded, causing `QuotaExceededError`. While caught by `try/catch`, subsequent reloads fail to leverage client cache, re-downloading multi-megabyte payloads on every refresh.
- **Optimized Solution**:
  Store only indexed metadata in memory / `localStorage` or utilize lightweight IndexedDB (`idb-keyval`) for catalog payloads with in-memory fallback.

---

### Finding F-05: Unsafe JSON Parsing on Non-200 HTTP Gateway Errors
- **Location**: `web/frontend/js/app.js` (line 10020, line 9091)
- **Severity**: Low
- **Bad Logic Pattern**:
  ```javascript
  if (!cfgRes.ok) {
    const err = await cfgRes.json();
    throw new Error(err.detail || 'Failed to update app config');
  }
  ```
  If Cloudflare edge returns an HTML 502/504 gateway error or 403 Forbidden page, `cfgRes.json()` throws a confusing `SyntaxError: Unexpected token < in JSON at position 0`, masking the true HTTP error from the user.
- **Optimized Solution**:
  ```javascript
  const errData = await cfgRes.json().catch(() => ({}));
  throw new Error(errData.detail || errData.message || `Server returned HTTP ${cfgRes.status}`);
  ```

---

## Layer 2: Cloudflare Workers Edge Router & D1 Storage Engine
**Files**: `worker/router.ts`, `worker/storage.ts`, `worker/auth.ts`, `worker/index.ts`

### Finding W-01: 11 Sequential Schema Statements Executed on EVERY HTTP Request
- **Location**: `worker/router.ts` (line 281), `worker/storage.ts` (lines 96-138)
- **Severity**: Critical
- **Bad Logic Pattern**:
  `worker/router.ts` executes `await storage.initializeDatabase()` at line 281 for EVERY single incoming HTTP request (including status polling every 30 seconds). `initializeDatabase()` iterates through 8 `CREATE TABLE IF NOT EXISTS` queries, 1 `CREATE INDEX` query, and 2 `getConfig()` queries sequentially.
  - Adds 150-300ms latency to every single API call.
  - Consumes tens of thousands of D1 database queries per day, prematurely exhausting Cloudflare Free Tier limits (100k writes/day, 5M reads/day).
- **Optimized Solution**:
  1. Guard database initialization using a Worker isolate memory flag:
     ```typescript
     let dbInitialized = false;
     export async function ensureDatabase(storage: StorageService): Promise<void> {
       if (dbInitialized) return;
       await storage.initializeDatabase();
       dbInitialized = true;
     }
     ```
  2. Use Cloudflare D1 batching (`db.batch(...)`) to execute all schema statements in a single roundtrip transaction instead of 11 sequential roundtrips.

---

### Finding W-02: TOCTOU Race Condition in Distributed Lock Manager
- **Location**: `worker/storage.ts` (lines 443-557)
- **Severity**: Critical
- **Bad Logic Pattern**:
  Locks are serialized as a JSON array inside a single text row in the `state` table (`key = 'active_locks'`).
  When concurrent requests arrive to trigger builds:
  1. Request A reads `state` table (`active_locks = []`).
  2. Request B reads `state` table (`active_locks = []`).
  3. Both evaluate `conflicting === false`.
  4. Both write their lock back via `saveActiveLocks(...)`.
  5. Request B silently overwrites Request A's lock in D1, or both dispatch redundant concurrent workflows for the exact same package.
- **Optimized Solution**:
  Replace JSON blob locking with a relational `active_locks` table:
  ```sql
  CREATE TABLE IF NOT EXISTS active_locks (
    package TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    source TEXT NOT NULL,
    acquired_at REAL NOT NULL,
    expires_at REAL NOT NULL
  );
  ```
  Acquiring a lock becomes an atomic SQL query:
  ```sql
  INSERT INTO active_locks (package, run_id, source, acquired_at, expires_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(package) DO UPDATE SET
    run_id = excluded.run_id,
    acquired_at = excluded.acquired_at,
    expires_at = excluded.expires_at
  WHERE active_locks.expires_at < ?;
  ```
  If another process holds an unexpired lock, the statement affects 0 rows, guaranteeing atomic race-free concurrency.

---

### Finding W-03: Permanent Table Bloat in Rate-Limiting Engine
- **Location**: `worker/auth.ts` (lines 201-242)
- **Severity**: High
- **Bad Logic Pattern**:
  `checkRateLimit` and `recordFailedLogin` insert rows into the persistent `config` table using keys like `ratelimit_login_<ip>`.
  There is no TTL, no expiration index, and no cleanup routine. Over weeks of uptime, automated web crawlers and malicious bots hit the login endpoint with spoofed or rotating IPs, permanently filling the `config` table with orphaned rate-limit rows.
- **Optimized Solution**:
  Use an in-memory sliding window cache per Worker isolate (using `Map<string, { attempts: number; expiresAt: number }>`), or create a dedicated ephemeral table `rate_limits` with auto-pruning (`DELETE FROM rate_limits WHERE expires_at < now`).

---

### Finding W-04: Lock Stalling on Partial GitHub Dispatch Failures
- **Location**: `worker/router.ts` (lines 1451-1514)
- **Severity**: High
- **Bad Logic Pattern**:
  In `/api/run/batch`, locks for all packages are acquired upfront. If 5 packages are requested, and GitHub dispatch succeeds for 4 but fails for 1 (e.g. GitHub rate limit or secondary throttle), the overall request returns success (`dispatchCount > 0`). However, the lock for the failed package is NEVER released because `releaseLock` is only invoked if `dispatchCount === 0`. The failed package remains locked for 45 minutes, preventing the user from retrying it.
- **Optimized Solution**:
  Inspect `dispatchResults` from `Promise.allSettled`. For any package that returned `ok: false` or rejected, immediately call `storage.releaseLock(failedPkg)`.

---

## Layer 3: Local Backend & Python Execution Engine
**Files**: `web/backend/runner.py`, `web/backend/mutex.py`, `scripts/morphe.py`, `scripts/scheduler.py`

### Finding P-01: Orphaned Process Leak and Subprocess Desync on Task Cancellation
- **Location**: `web/backend/runner.py` (lines 181-240)
- **Severity**: Critical
- **Bad Logic Pattern**:
  When `PipelineRunner._execute_process` receives an `asyncio.CancelledError`, it logs an error message and enters `finally:`.
  Inside `finally:`, it sets `self.is_running = False`, calls `mutex.release_lock()`, and nulls `self.current_process = None`.
  Crucially, it NEVER sends `SIGTERM` or `SIGKILL` to the running OS process (`self.current_process`). The subprocess (`python scripts/main.py` and its spawned Java processes) continues executing in the background. Because the mutex was released, the web portal allows a new build to be triggered immediately. Two builds now execute concurrently in the same directory, writing to the same APK files and corrupting the build workspace.
- **Optimized Solution**:
  Inside `except asyncio.CancelledError:`, invoke `_kill_process_group(self.current_pgid, self.current_process.pid, signal.SIGTERM)`, wait with timeout, escalate to `signal.SIGKILL`, and ensure `await self.current_process.wait()` resolves before proceeding to `finally:`.

---

### Finding P-02: Filesystem Mutex TOCTOU Race Condition
- **Location**: `web/backend/mutex.py` (lines 79-95)
- **Severity**: High
- **Bad Logic Pattern**:
  ```python
  active = get_active_lock()
  if active is not None:
      return False, active
  ...
  lock_path.write_text(json.dumps(lock_data, indent=2), encoding="utf-8")
  ```
  Non-atomic check-then-write on the filesystem. If the web API handler and background scheduler execute `acquire_lock` concurrently, both see `get_active_lock() is None`, and both proceed to write the lock file. Both return `True` and execute simultaneous builds.
- **Optimized Solution**:
  Use atomic file creation via OS flags:
  ```python
  fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
  with os.fdopen(fd, 'w', encoding='utf-8') as f:
      json.dump(lock_data, f)
  ```
  If the file already exists, the OS kernel raises `FileExistsError` atomically.

---

### Finding P-03: Scheduler Daemon Lock Hijacking on Long Builds
- **Location**: `scripts/scheduler.py` (lines 60-85, 97-110)
- **Severity**: High
- **Bad Logic Pattern**:
  `scheduler.py` writes the lock file with `updated_at = time.time()`, then calls `subprocess.run([sys.executable, "scripts/main.py"])`. Unlike `runner.py`, `scheduler.py` does NOT run a background heartbeat thread to refresh `updated_at`.
  If the build takes longer than 300 seconds (5 minutes), any check by `get_active_lock()` or the web portal detects `age > 300s`, marks the lock as stale, deletes the lock file, and allows another process to start building while the scheduled job is still running.
- **Optimized Solution**:
  Implement a lightweight background daemon thread in `scheduler.py` that refreshes `updated_at` in the lock file every 15 seconds until the subprocess exits.

---

### Finding P-04: Inverted SemVer Precedence in Patch Listing
- **Location**: `scripts/morphe.py` (lines 940-942)
- **Severity**: Medium
- **Bad Logic Pattern**:
  ```python
  version_digits = re.findall(r"\d+", first_ver_line)
  tup_ver = tuple(int(d) for d in version_digits) if version_digits else (0, 0, 0)
  ```
  For version strings like `5.20.57-beta01`, `re.findall` yields `['5', '20', '57', '01']`, creating tuple `(5, 20, 57, 1)`.
  When compared against release `5.20.57` which yields `(5, 20, 57)`, Python evaluates `(5, 20, 57, 1) > (5, 20, 57)`.
  The script erroneously considers pre-release beta builds as NEWER than the stable release.
- **Optimized Solution**:
  Extract SemVer components using strict regex, isolating pre-release tags and assigning lower sort rank to pre-releases.

---

### Finding P-05: Unbounded Subprocess Execution & Memory Buffering
- **Location**: `scripts/morphe.py` (line 1205)
- **Severity**: Medium
- **Bad Logic Pattern**:
  `subprocess.run(cmd, capture_output=True, text=True, check=True)` executes the Java patcher without a timeout. If the JVM hangs or encounters an infinite loop on a malformed Dex file, the script blocks indefinitely. Additionally, `capture_output=True` buffers all output in RAM instead of streaming it.
- **Optimized Solution**:
  Enforce explicit timeout (e.g. `timeout=900` seconds) and stream output to avoid memory spikes.

---

### Finding P-06: Command-Line Password Exposure in Keytool
- **Location**: `scripts/morphe.py` (lines 105-114)
- **Severity**: Low
- **Bad Logic Pattern**:
  `-storepass` and `-keypass` arguments are passed directly on the command line to `keytool`. On Linux/macOS systems, command line arguments of all running processes are visible to other users via `ps aux` or `/proc/<pid>/cmdline`.
- **Optimized Solution**:
  Pass passwords via standard input or environment variables (`-storepass:env`).

---

## Layer 4: GitHub Actions Cloud Builder & Workflows
**Files**: `.github/workflows/morpheflow-cloud-builder.yaml`, `scripts/obtainium_link.py`

### Finding C-01: Eventual Consistency Race Condition in Per-App Rolling Release
- **Location**: `.github/workflows/morpheflow-cloud-builder.yaml` (lines 291, 308-311)
- **Severity**: High
- **Bad Logic Pattern**:
  ```bash
  gh release delete "${PER_APP_TAG}" --yes --cleanup-tag 2>/dev/null || true
  ...
  gh release create "${PER_APP_TAG}" "$apk" ... || gh release upload "${PER_APP_TAG}" "$apk" --clobber
  ```
  The workflow deletes the GitHub Release and Git Tag ref, then immediately tries to recreate it. GitHub's Git backend has eventual consistency on ref deletion. Recreating the release 100ms later frequently triggers `HTTP 422: Reference already exists`. The fallback `gh release upload` then fails because the release object was deleted. Furthermore, during the deletion window, any user checking for updates via Obtainium receives a 404 Not Found.
- **Optimized Solution**:
  Never delete the release. Instead, update the existing release in-place:
  ```bash
  if gh release view "${PER_APP_TAG}" >/dev/null 2>&1; then
    gh release edit "${PER_APP_TAG}" --title "${app_name} (${pkg_dir}) v${ver_dir}" --notes-file "$PER_APP_NOTES"
    gh release upload "${PER_APP_TAG}" "$apk" --clobber
  else
    gh release create "${PER_APP_TAG}" "$apk" --title "${app_name} (${pkg_dir}) v${ver_dir}" --notes-file "$PER_APP_NOTES" --latest=false
  fi
  ```

---

### Finding C-02: Misleading VirusTotal Scan Verification
- **Location**: `.github/workflows/morpheflow-cloud-builder.yaml` (lines 404-408), `scripts/morphe.py` (lines 1326-1330)
- **Severity**: Medium
- **Bad Logic Pattern**:
  Both the workflow and Python script inject:
  ```json
  "virustotal": {
    "permalink": "https://www.virustotal.com/gui/file/<sha256>",
    "sha256": "<sha256>",
    "status": "clean"
  }
  ```
  It generates the VirusTotal search link from the APK SHA-256 hash, but hardcodes `"status": "clean"` without actually verifying scan results via the VirusTotal API. The web UI displays "Clean 0/72 engines" even if the file has never been submitted to VirusTotal.
- **Optimized Solution**:
  1. Default status to `"unscanned"` or `"link_ready"`.
  2. If an optional `VT_API_KEY` secret is provided, invoke the VirusTotal v3 API (`/api/v3/files/{hash}`) to check actual scan reports; otherwise clearly indicate "Unscanned (Permalink Available)".
