# MorpheFlow: Project Rebrand & Next-Gen Feature Roadmap Specification

**Author:** Antigravity  
**Date:** 2026-11-02  
**Target Brand:** `MorpheFlow` (Automated pipeline & mobile management)  
**Status:** Ready for Review & Approval  

---

## 1. Executive Summary

This specification outlines the complete transformation and rebranding of the project from **AutoMorph** to **MorpheFlow**, followed by phased implementation plans for 5 major feature additions derived from community feedback on Reddit (`r/MorpheApp` and `r/revancedapp`).

The work is partitioned into **6 independent, atomic execution phases**:
- **Phase 0:** Complete End-to-End System Rebrand (GitHub, Cloudflare Worker, D1 DB, Tools, Frontend, Workflows).
- **Phase 1:** Custom Keystore Management UI (Upload/Export `.keystore` / `.jks`).
- **Phase 2:** VirusTotal Automated Post-Build Safety Verification & Badges.
- **Phase 3:** MicroG-RE (GmsCore Redesign) Companion Hub & One-Click Distribution.
- **Phase 4:** Pre-Flight Patch Conflict & Dependency Validator.
- **Phase 5:** Direct APKMirror & Google Play Store Deep Link Integrations.

---

## 2. Phase 0: Complete Project Rebrand (AutoMorph ➔ MorpheFlow)

### 2.1 Scope of Changes
Every instance of `AutoMorph` (case variations: `AutoMorph`, `automorph`, `AUTOMORPH`, `automorph-db`, `automorph-data`) will be systematically migrated:

| Component | Current Asset | Target Asset |
| :--- | :--- | :--- |
| **GitHub Repository** | `wiwek13/AutoMorph` | `wiwek13/MorpheFlow` |
| **Git Remote Origin** | `git@github.com:wiwek13/AutoMorph.git` | `git@github.com:wiwek13/MorpheFlow.git` |
| **Cloudflare Worker** | `name = "automorph"` | `name = "morpheflow"` |
| **Worker Subdomain** | `automorph.w161112218.workers.dev` | `morpheflow.w161112218.workers.dev` |
| **Cloudflare D1 DB** | `automorph-db` (`0e753fd6-...`) | `morpheflow-db` (migrated with full data export/import) |
| **Runtime Data Dir** | `tools/automorph-data/` | `tools/morpheflow-data/` |
| **Workflow File** | `.github/workflows/automorph-cloud-builder.yaml` | `.github/workflows/morpheflow-cloud-builder.yaml` |
| **User Agent Strings** | `AutoMorph-EdgeWorker/2.4.0` | `MorpheFlow-EdgeWorker/2.4.0` |
| **Keystore Alias/Env**| `AUTOMORPH_KEYSTORE_*` | `MORPHEFLOW_KEYSTORE_*` |
| **Frontend Branding** | `AutoMorph` UI, Titles, Favicon, Logo | `MorpheFlow` Branding, Assets, LocalStorage Keys |
| **Obtainium Source** | Author `AutoMorph`, Repo `wiwek13/AutoMorph` | Author `MorpheFlow`, Repo `wiwek13/MorpheFlow` |

### 2.2 Phase 0 Checklist
- [ ] **Step 0.1: D1 Database Migration**
  - Export full JSON dump of existing `automorph-db` (packages, patch_repos, settings, run_logs, patched_apps).
  - Create new D1 database `morpheflow-db` via `npx wrangler d1 create morpheflow-db`.
  - Apply migrations `migrations/0001_initial.sql` to `morpheflow-db`.
  - Import restored data dump into `morpheflow-db`.
- [ ] **Step 0.2: Configuration & Wrangler Updates**
  - Update `wrangler.toml`: `name = "morpheflow"`, database binding name `morpheflow-db` and new database_id.
  - Update `package.json`: `"name": "morpheflow"`, scripts, description.
  - Update `worker/version.ts`: update `APP_USER_AGENT` to `MorpheFlow-EdgeWorker/...`.
- [ ] **Step 0.3: Directory & Code Refactoring**
  - Rename directory `tools/automorph-data` ➔ `tools/morpheflow-data`.
  - Update `scripts/morphe.py`: change `automorph-data` paths, default keystore aliases, log prefix.
  - Update `scripts/deploy-cf.cjs`: update database names, secrets references, and branding text.
  - Update `.github/workflows/automorph-cloud-builder.yaml` (rename to `morpheflow-cloud-builder.yaml`): update paths, release titles, notes, and secrets.
- [ ] **Step 0.4: Web Frontend Rebrand**
  - Update `web/frontend/index.html`: page title `MorpheFlow: Edge Patching and Distribution Console`, brand badges, gateway header, footer.
  - Update `web/frontend/js/app.js`: storage keys (`morpheflow-theme`, `morpheflow-poll-sec`), default repo fallback (`wiwek13/MorpheFlow`), author strings.
- [ ] **Step 0.5: GitHub Repository Rename & Remote Update**
  - Rename GitHub repository from `AutoMorph` to `MorpheFlow` via `gh repo rename MorpheFlow --yes`.
  - Update local git remote: `git remote set-url origin git@github.com:wiwek13/MorpheFlow.git`.
  - Update GitHub Secrets: `CLOUDFLARE_WORKER_URL = https://morpheflow.w161112218.workers.dev`.
- [ ] **Step 0.6: Verification & Deployment**
  - Run all 54 unit tests (`npm test`) and typechecks (`npm run types:check`).
  - Deploy new Cloudflare Worker (`npm run deploy`).
  - Verify live web portal on `https://morpheflow.w161112218.workers.dev`.

---

## 3. Phase 1: Custom Keystore Import & Export UI

### 3.1 Motivation
Users migrating from Morphe Mobile or ReVanced Manager encounter `INSTALL_FAILED_UPDATE_INCOMPATIBLE` because their existing apps were signed with a different key. Allowing users to import their own keystore or download the MorpheFlow keystore eliminates this pain point completely.

### 3.2 Architectural Plan
1. **D1 Secure Store**:
   - Store base64-encoded custom keystore binary in `settings` table under key `keystore_blob`, along with alias, keystore password, and entry password.
2. **Endpoints**:
   - `POST /api/settings/keystore/upload`: Multipart upload of `.keystore` / `.jks` file with alias and password.
   - `GET /api/settings/keystore/download`: Authenticated export of the active keystore file.
   - `DELETE /api/settings/keystore`: Reset back to default deterministic keystore.
3. **Cloud Runner Synchronization**:
   - In `/api/runner/sync`: Provide the custom keystore binary to GitHub Actions runner, which unpacks it to `tools/morpheflow-data/keystore/custom.keystore`.
4. **UI Panel**:
   - In **Settings ➔ Keystore Management**:
     * Current Keystore Status badge (Default Generated vs Custom Imported).
     * File upload dropzone for `.keystore` / `.jks` with alias & password inputs.
     * "Download Active Keystore" backup button.

### 3.3 Phase 1 Checklist
- [ ] Create D1 storage methods for keystore metadata and binary in `worker/storage.ts`.
- [ ] Add `/api/settings/keystore/*` routes in `worker/router.ts`.
- [ ] Update `/api/runner/sync` and `.github/workflows/morpheflow-cloud-builder.yaml` to dynamically restore uploaded custom keystores during build.
- [ ] Add Keystore Management card into `web/frontend/index.html` and wire upload/download events in `web/frontend/js/app.js`.
- [ ] Write integration test in `tests/unit/keystore-management.test.js`.

---

## 4. Phase 2: VirusTotal Automated Post-Build Safety Scan & Badges

### 4.1 Motivation
Users on Reddit want proof that cloud-built APKs are clean and free of malicious injections.

### 4.2 Architectural Plan
1. **GitHub Runner Post-Build Step**:
   - After compiling each APK, compute `SHA-256`.
   - Query `https://www.virustotal.com/api/v3/files/{sha256}` using optional secret `VIRUSTOTAL_API_KEY`.
   - If not yet scanned, upload for analysis if size allows or link to hash search.
   - Store verdict (e.g. `positives: 0`, `total: 72`, `permalink: "https://www.virustotal.com/gui/file/..."`).
2. **Result Persistence**:
   - Include `virustotal` payload inside `result.json` and report webhook to Cloudflare Worker.
3. **Frontend UI Badge**:
   - On app cards and the result viewer modal:
     * `🟢 VirusTotal: Clean 0/72` with a link opening the scan report in a new tab.

### 4.3 Phase 2 Checklist
- [ ] Add VirusTotal API helper step in `.github/workflows/morpheflow-cloud-builder.yaml`.
- [ ] Save VirusTotal stats in `result.json` and report webhook in `scripts/morphe.py`.
- [ ] Store `virustotal_report` in D1 `patched_apps` table.
- [ ] Render VirusTotal badge on app cards in `web/frontend/js/app.js`.

---

## 5. Phase 3: MicroG-RE (GmsCore Redesign) Companion Hub

### 5.1 Motivation
MicroG mismatch is the #1 cause of crashes, Google account login failures, and Google Play Protect blocks reported on `r/MorpheApp`.

### 5.2 Architectural Plan
1. **Upstream Catalog Link**:
   - Query `https://api.github.com/repos/MorpheApp/GmsCore/releases/latest` (cached in Cloudflare Worker edge).
2. **Dedicated UI Hub**:
   - Add a "MicroG-RE Companion" card in Community Store and Overview:
     * Latest release tag (e.g. `v0.3.1.240913`).
     * Direct one-click download of the latest APK.
     * Expandable FAQ on bypassing Google Play Protect false-positive warnings on MIUI/HyperOS, One UI, and ColorOS.
3. **Obtainium 1-Click Track**:
   - Add a button to track `MorpheApp/GmsCore` directly in Obtainium alongside patched apps.

### 5.3 Phase 3 Checklist
- [ ] Add `/api/gmscore/latest` proxy endpoint in `worker/router.ts`.
- [ ] Add MicroG-RE component card to `web/frontend/index.html`.
- [ ] Render version status and direct download links in `web/frontend/js/app.js`.
- [ ] Provide Play Protect bypass instructions modal.

---

## 6. Phase 4: Pre-Flight Patch Conflict & Dependency Validator

### 6.1 Motivation
Users combining multiple patch sources often select overlapping or mutually exclusive patches, causing compilation crashes or runtime crashes on Android.

### 6.2 Architectural Plan
1. **Conflict Matrix Rulebook**:
   - In `tools/morpheflow-data/rules/conflicts.json` (and bundled in frontend):
     Define known mutually exclusive patch patterns (e.g., duplicate ad-blockers, incompatible spoofers).
2. **Pure Patch Studio Live Linting**:
   - As the user toggles patches in Pure Patch Studio, evaluate conflicts against selected items in real-time.
   - If a conflict occurs, display an inline warning: `⚠️ Conflict: 'Patch A' conflicts with 'Patch B'`.
   - Provide a "Resolve Conflict" 1-click button that disables the redundant patch.

### 6.3 Phase 4 Checklist
- [ ] Define conflict definition schemas.
- [ ] Add validation engine in `web/frontend/js/app.js`.
- [ ] Add pre-flight check in `scripts/morphe.py` before executing `morphe.jar`.
- [ ] Add unit test in `tests/unit/patch-conflicts.test.js`.

---

## 7. Phase 5: Direct APKMirror & Google Play Store Deep Links

### 7.1 Motivation
Users want to quickly check Play Store listings and download recommended clean base APK versions from APKMirror with zero manual searching.

### 7.2 Architectural Plan
1. **Deep Link Formula**:
   - Play Store: `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`
   - APKMirror: `https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s=${encodeURIComponent(pkg)}+${encodeURIComponent(targetVersion || '')}`
2. **Integration Touchpoints**:
   - Configured Apps card footer.
   - Community Store Details modal.
   - Base APK Upload modal: "Find Recommended APK on APKMirror" helper button.

### 7.3 Phase 5 Checklist
- [ ] Add Play Store and APKMirror deep link generators in `web/frontend/js/app.js`.
- [ ] Add deep link icon buttons to App Cards and Store Details.
- [ ] Add "Search on APKMirror" button in the Custom Base APK switcher.

---

## 8. Verification & Rollback Strategy

1. **Phase 0 Rollback Plan**:
   - D1 data is backed up to JSON before migration; `automorph-db` remains untouched until `morpheflow-db` is verified.
   - If Cloudflare DNS/subdomain encounters propagation delay, traffic can still hit previous endpoints.
2. **Continuous Testing**:
   - All 54 existing unit tests must pass before and after every phase.
   - `npm run types:check` must emit 0 TypeScript errors.
   - Live browser automated testing via Playwright will verify zero console errors and successful rendering.
