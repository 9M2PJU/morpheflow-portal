# AutoMorph Next-Gen Suite: Features Specification & Roadmap
**Date**: October 31, 2026  
**Architectural Baseline**: Cloudflare Workers + D1 Edge Database + GitHub Actions Cloud Runner + Apple Pro UI System  

---

## 1. Executive Summary & Community Inspiration
Based on deep research into the Morphe, ReVanced, and ReVanced Extended communities (including `r/revancedapp`, `r/ReVancedExtended`, and Morphe patch maintainer discussions), the biggest pain points and community desires in automated cloud patchers are:

1. **Telegram / Discord Delivery**: Having builds automatically pushed to a personal Telegram channel or Discord server with 1-click download links.
2. **Instant Patch Search & Filtering**: Sifting through 80+ patches across multiple bundles (e.g. Inotia00, Morphe, Bufferk, TVer) without tedious scrolling.
3. **Patch Options Customization**: Configuring patch parameters (such as `microg-support`, custom package names, OLED black themes) directly from the UI without manual JSON surgery.
4. **Target Architecture Selection**: Strict control over `arm64-v8a` vs `armeabi-v7a` to avoid oversized universal APKs or incompatible binaries.
5. **Config Portability (Backup & Restore)**: Exporting the entire AutoMorph state (configured apps, repos, enabled patches, custom base URLs) to a single portable JSON file for easy migration across instances.
6. **Granular Batch Selection**: Selecting specific subsets of apps to build in a single pipeline run instead of all-or-one.
7. **Failure Diagnostics**: Providing clear, human-readable explanations when an APK download or patch step fails (e.g. anti-bot captcha on mirror, version signature clash).

---

## 2. 7 Core Features Specification

### Feature 1: Real-Time Patch Filter & Keyword Search
* **Location**: Provision Modal (`#provision-modal`) and Applied Patches Modal (`#modal-applied-patches`).
* **Behavior**: An instant debounced search input filters patches across all bundles simultaneously. Matches highlight both patch name and description. If a bundle has 0 matches, that bundle section is dynamically hidden.

### Feature 2: High-Contrast Light & Dark Mode Engine (Apple Pro)
* **Location**: Global theme tokens in `morphe.css`.
* **Behavior**:
  * Dark mode: Electric cyan/blue accents (`oklch(76% 0.140 220)`), pitch surface cards (`oklch(22% 0.015 252)`), crisp white text.
  * Light mode: Deep Royal Apple blue (`oklch(42% 0.200 255)`), high-contrast text (`oklch(18% 0.020 260)`), slate borders (`oklch(20% 0.010 252 / 0.16)`). Meets WCAG AAA 7:1 contrast ratio.

### Feature 3: Full Backup & Restore System (JSON Import / Export)
* **Location**: Settings View (`#view-settings`).
* **Endpoints**:
  * `GET /api/config/backup` — Exports all configured apps, repositories, global options, and custom APK URLs.
  * `POST /api/config/restore` — Validates and atomizes restoration into D1 database.
* **UI**: 1-click `[Export Config Backup]` and `[Import Backup JSON]` file dropzone.

### Feature 4: Webhook & Notification Dispatcher (Telegram & Discord)
* **Location**: Settings View (`#view-settings`) and Cloud Builder (`.github/workflows/automorph-cloud-builder.yaml`).
* **Functionality**:
  * Settings allows inputting `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, or `DISCORD_WEBHOOK_URL`.
  * After APK compilation and signing, the runner sends a formatted Markdown notification with APK size, patch count, and direct download links.

### Feature 5: Multi-App Batch Trigger Selector
* **Location**: Configured Applications (`#view-apps`).
* **Behavior**: Checkboxes on app cards allow multi-selecting (e.g., Reddit + YouTube Music) and triggering `[Run Selected (2)]` to compile only the chosen targets without running the entire suite.

### Feature 6: Architecture Preference Filter (ARM64-v8a / ARM-v7a)
* **Location**: App Config Drawer (`openAppDrawer`).
* **Options**:
  * `arm64-v8a` (Recommended for modern devices, smallest file size).
  * `armeabi-v7a` (Legacy 32-bit devices).
  * `all / universal` (Fallback).

### Feature 7: Root Cause Diagnostic & Failure Trace Inspector
* **Location**: Pipeline Console (`#view-pipeline`).
* **Behavior**: Analyzes raw runner stderr logs and highlights actionable error conditions:
  * "Mirror Download 403 Forbidden: APK mirror enforced Cloudflare challenge -> Use Custom Base APK Source"
  * "Patch Incompatibility: Target version mismatch -> Check Recommended Target"

---

## 3. Test Strategy & Verification
* **Unit Tests**:
  * `tests/unit/semver.test.js` — SemVer compare and upgrade classification logic.
  * `tests/unit/router.test.js` — D1 storage operations, backup/restore serializers.
  * `tests/unit/contrast.test.js` — CSS color token lightness verification for WCAG standards.
* **Integration Tests**:
  * `tests/integration/api-workflow.test.js` — Complete pipeline dispatch & config persistence simulation.
