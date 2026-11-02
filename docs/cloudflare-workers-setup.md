[🏠 Documentation Hub](README.md) › **Cloudflare Workers Free Tier Setup Guide**

---

# ☁️ Cloudflare Workers Deployment Guide (100% Free Tier)

Deploy MorpheFlow as a **serverless edge management portal and build distribution hub** directly on **Cloudflare Workers**.

This deployment method runs **100% within the Cloudflare Free Plan** and requires **zero credit card**:
* 🌐 **Global Edge Control Center**: Hosts the MorpheFlow Web Portal and REST management API across Cloudflare's 330+ edge locations with ultra-low latency and built-in DDoS mitigation.
* 💾 **Serverless SQLite (Cloudflare D1)**: Stores package configs, patch aliases, options, execution logs, and metrics (5 million reads/day and 100,000 writes/day free).
* 🔒 **Atomic Distributed Locking**: Relational `active_locks` table with SQL transactions prevents overlapping or duplicate build dispatches.
* ⏰ **Automated Daily Scheduling**: Cloudflare Workers Cron Triggers (`0 3 * * *` and `0 * * * *`) poll for upstream patch bundle updates and trigger builds automatically.
* ⚡ **Serverless Cloud Patch Runner**: Automatically dispatches heavy APK patching tasks (Java 21 + Python + Morphe) to GitHub Actions free runners (unlimited minutes on public repos, 2,000 min/mo on private repos), releases builds, and syncs live metrics back to your Cloudflare dashboard.
* 📱 **Obtainium Zero-Token Feeds**: Serves public `/api/obtainium/manifest.json` and per-app release endpoints so Android devices can track updates without requiring GitHub API tokens.

---

## 🏗️ Architecture & Mental Model

```mermaid
graph TD
    User([User Browser / Mobile]) -->|HTTPS / Edge CDN| CFW[Cloudflare Worker<br/>Edge Portal & REST API]
    CFW -->|Serves UI| Assets[Workers Static Assets<br/>web/frontend]
    CFW -->|Queries & Updates| D1[(Cloudflare D1<br/>Serverless SQLite)]
    
    Cron[Cloudflare Cron Trigger<br/>Daily 03:00 UTC / Hourly] -->|Triggers Check| CFW
    User -->|Click 'Run Pipeline'| CFW

    CFW -->|workflow_dispatch<br/>GitHub REST API| GHA[GitHub Actions Cloud Runner<br/>Java 21 + Python 3.12 + 7GB RAM]
    GHA -->|Downloads & Patches APK| Morphe[Morphe Desktop Engine]
    GHA -->|In-Place Rolling Release| GHRel[GitHub Releases<br/>Free Hosting & Feeds]
    GHA -->|POST /api/webhook/report| CFW
    
    User -->|Obtainium 1-Click Sync| GHRel
    User -->|Direct Authenticated Download| CFW
```

---

## 📊 Dashboard Metric Mapping & Free Tier Quotas

MorpheFlow's web interface displays 6 primary metric categories. Here is how each metric maps to the Cloudflare Workers Free Tier:

| Metric Card | Source in Docker | Cloudflare Free Tier Implementation | Free Tier Allowance & Safety |
| :--- | :--- | :--- | :--- |
| **System Status** (`is_running`, `active_run`) | `runner.is_running` & file lock `state/lock.json` | Stored in D1 `active_locks` table with atomic SQL operations | **100k requests/day**: Lock is checked on status queries (<1ms CPU in V8 isolate). |
| **Next Run Countdown** (`stat-next-run`) | In-memory `resolve_schedule_target()` | Calculated in Worker `router.ts` from D1 `schedule_time` + `timezone` against Cloudflare Cron Trigger | **0 database cost**: Computed on-the-fly in Worker memory (<0.1ms CPU). |
| **Last Run Status & Duration** (`stat-last-status`) | `tools/morpheflow-data/state/logs/last_run.json` | Queried from D1 `run_history` table (`ORDER BY finished_at DESC LIMIT 1`) | **5M row reads/day**: Single indexed SQLite lookup; well within free quotas. |
| **Storage Stats** (`stat-storage-size`, `stat-apk-count`) | Local disk scan of `apps/patched/` and `patched.json` | SQL aggregation in D1: `SELECT COUNT(*), SUM(size_bytes) FROM patched_apps` | **Fast SQLite Index**: Real-time aggregation of ready APK files and total bytes. |
| **Configured Totals** (`stat-apps-count`, `stat-repos-count`) | `len(config['packages'])` & distinct repos | Queried from D1 `packages` table and `patch_repos` JSON list | **5 GB Storage**: Minimal storage footprint (<100 KB for thousands of apps). |
| **App Version & Updates** (`site-version-val`) | `web/version.json` & GitHub Releases API | Served from Workers Static Assets and queried with ETag caching | **Unlimited Static Requests**: Zero quota cost for serving frontend assets. |
| **Execution Logs & Reports** (`/api/run/logs`, `/report`) | `last_run.log` & `build_report.html` | Stored in D1 `run_logs` and `config.latest_report_html` (pruned automatically) | **Automatic Pruning**: Keeps DB size well under free quota limits. |

---

## 🚀 1-Click Deployment (Recommended)

MorpheFlow includes an automated setup script that configures everything in one step:

```bash
# 1. Authenticate CLIs
npx wrangler login
gh auth login

# 2. Deploy MorpheFlow to Cloudflare Workers
./deploy.sh          # macOS / Linux
.\deploy.ps1         # Windows PowerShell
```
*(Or run `npm run deploy`)*

### What the Automated Script Does:
1. **Checks Cloudflare Authentication**: Uses Wrangler CLI credentials.
2. **Pins D1 Database**: Checks for `morpheflow-db` in your Cloudflare account, creates it if not found, and updates `wrangler.toml` with the database UUID.
3. **Applies Schema Migrations**: Executes batched SQL statements creating all required tables (`packages`, `active_locks`, `run_logs`, `run_history`, `patched_apps`, `rate_limits`, etc.).
4. **Configures Worker Secrets**:
   * `AUTH_PASSWORD`: Automatically generates and sets a 24-character master password.
   * `WEBHOOK_SECRET`: Secure cryptographic token for authenticating reports from GitHub Actions.
   * `GITHUB_TOKEN` & `GITHUB_REPO`: Sets credentials for triggering cloud builds.
5. **Deploys Worker & Static Assets**: Uploads the bundle and static UI to Cloudflare edge.
6. **Configures GitHub Cloud Runner**: Sets `CLOUDFLARE_WORKER_URL` and `WEBHOOK_SECRET` in your GitHub repository secrets so cloud builds report results back automatically.

---

## 🔒 Security Architecture

* **Single-User Master Protection**: Access to the portal is guarded by a single-user master password.
* **Timing-Safe HMAC Authentication**: Session tokens use SHA-256 HMAC signatures verified with constant-time equality comparisons to prevent timing attacks.
* **Brute-Force Rate Limiting**: Consecutive failed login attempts trigger an IP-based lockout in the D1 `rate_limits` table with automatic cleanup upon expiry or successful login.
* **Content Security Policy (CSP)**: Strict HTTP headers restrict scripts, styles, frames, and connections to trusted origins.

---

[← Back to Documentation Hub](README.md)
