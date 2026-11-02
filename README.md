<div align="center">
  <img src="images/logo.png" alt="MorpheFlow Logo" width="340">
  <h1>MorpheFlow</h1>
  <p><strong>A Cloud-Native Edge Control Plane, Pure Patch Studio & Automated Build Pipeline for Android Packages</strong></p>

  <p>
    <a href="https://github.com/wiwek13/MorpheFlow/releases"><img src="https://img.shields.io/badge/version-v2.4.1-6366f1?style=for-the-badge&logo=android&logoColor=white" alt="Version 2.4.1"></a>
    <a href="https://workers.cloudflare.com"><img src="https://img.shields.io/badge/Cloudflare_Workers-Edge_D1-f38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Workers"></a>
    <a href="https://github.com/ImranR98/Obtainium"><img src="https://img.shields.io/badge/Obtainium-1--Click_Sync-10b981?style=for-the-badge&logo=googleplay&logoColor=white" alt="Obtainium Integration"></a>
    <a href="https://www.virustotal.com"><img src="https://img.shields.io/badge/VirusTotal-Automated_Auditing-3b82f6?style=for-the-badge&logo=virustotal&logoColor=white" alt="VirusTotal Auditing"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-gray?style=for-the-badge" alt="License MIT"></a>
  </p>
</div>

---

## 🌟 Overview

**MorpheFlow** is an open-source, self-hosted edge management portal and automated continuous-integration pipeline for patching, deterministically signing, and distributing Android applications.

Built as a next-generation evolution of [AutoMorph](https://github.com/holjab/AutoMorph) and powered by [Morphe Desktop](https://morphe.software), MorpheFlow transitions Android bytecode patching from heavy, local servers into a sleek, serverless edge architecture running **100% within the Cloudflare Free Tier** with zero VPS maintenance and zero credit card required.

---

## 📸 Screenshots

<div align="center">
  <h3>Operations Queue & Live Telemetry</h3>
  <p><em>Modern glassmorphic dashboard featuring real-time build telemetry, SemVer target tracking, and live VirusTotal security verdicts.</em></p>
  <img src="images/dashboard.png" alt="MorpheFlow Operations Dashboard" width="95%">
</div>

<br>

<div align="center">
  <table width="100%">
    <tr>
      <td width="50%" align="center">
        <h4>Obtainium 1-Click Sync & Feeds</h4>
        <img src="images/obtainium_sync.png" alt="Obtainium Sync Modal" width="100%">
        <p><em>Bulk deep-link import & dedicated per-app release feeds for background auto-updates.</em></p>
      </td>
      <td width="50%" align="center">
        <h4>Pure Patch Studio & App Provisioning</h4>
        <img src="images/add_package.png" alt="Pure Patch Studio" width="100%">
        <p><em>Multi-bundle exploration, conflict linting, and universal vs app-matched patch separation.</em></p>
      </td>
    </tr>
    <tr>
      <td width="50%" align="center">
        <h4>Settings, Storage & Keystore Hub</h4>
        <img src="images/settings.png" alt="Settings & Tunnels" width="100%">
        <p><em>Cloudflare D1 management, deterministic keystores, and tunnel endpoints.</em></p>
      </td>
      <td width="50%" align="center">
        <h4>Mobile Responsive Monolith</h4>
        <img src="images/mobile_dashboard.png" alt="Mobile Dashboard" width="55%">
        <p><em>Horizontally scrollable navigation dock, phone autosizing, and native bottom sheets.</em></p>
      </td>
    </tr>
  </table>
</div>

---

## ⚡ Key Features

- **🌐 Serverless Cloudflare Edge Architecture (100% Free)**:
  - Runs natively on Cloudflare Workers with **Cloudflare D1** (serverless distributed SQLite) and **Workers Static Assets**.
  - Isolate memoization and `db.batch()` execution ensures sub-millisecond edge response times with zero cold start overhead.
  - Zero VPS required, zero maintenance, zero hosting bills.
- **📱 Obtainium 1-Click Sync & Deep Links**:
  - Direct integration with [Obtainium](https://github.com/ImranR98/Obtainium) via `obtainium://apps/` bulk deep links.
  - Generates dedicated per-app release tags (`app-<package_name>`) and zero-token public edge manifest feeds (`/api/obtainium/manifest.json`), enabling seamless background auto-updates on Android.
- **🛡️ Automated VirusTotal Security Telemetry**:
  - Automatically calculates SHA-256 binary digests for every compiled APK and surfaces prominent `0/72 Clean` security shields directly on app cards.
  - One-click permalinks launch the full VirusTotal file report in a new tab.
- **🔑 Deterministic & Custom Keystore Engine**:
  - Ships with a pre-configured, hardened deterministic keystore to ensure consistent signature fingerprints across builds, preventing Android "App not installed: signature mismatch" errors.
  - Full UI export and import support for custom keystores with automated GitHub Actions Cloud Runner synchronization.
- **🧩 Pure Patch Studio & Conflict Resolution**:
  - Multi-source aggregation across Morphe, ReVanced, and community patch repositories.
  - Clean separation between active patches, app-specific features, and universal mutators.
  - Bytecode conflict detection flags mutually incompatible patches before compiling.
- **🔄 SemVer 2.0 Pre-release Precedence**:
  - Handles 2, 3, 4, and 5-segment Android version numbers.
  - Adheres strictly to SemVer 2.0.0 pre-release precedence so stable releases always take precedence over beta/alpha releases.
- **📥 Robust APK Ingestion Cascade**:
  - Automatic download cascade prioritising Google Play Store ([`goopdl`](https://github.com/Villoh/goopdl)), with automatic fallbacks to Uptodown, APKCombo, and APKPure.
  - Manual base APK upload with real-time percentage and megabyte upload progress bars.
- **🚀 Parallel Concurrency & Process Safety**:
  - Concurrent batch dispatch using `Promise.allSettled` with instant lock release for failed packages.
  - Atomic OS file locks (`O_CREAT | O_EXCL`) and D1 relational `active_locks` table to prevent race conditions.
  - Subprocess cancellation cleans child process groups via `SIGINT` escalating to `SIGKILL` before lock release.
- **🔒 Single-User Airtight Security**:
  - Timing-safe HMAC session authentication, automated brute-force rate-limiting with auto-pruning, and strict Content Security Policies.

---

## 🏗️ Architecture & Mental Model

```mermaid
graph TD
    User([Android User / Browser]) -->|HTTPS / Edge CDN| CFW[Cloudflare Worker<br/>Edge Portal & REST API]
    CFW -->|Serves UI| Assets[Workers Static Assets<br/>web/frontend]
    CFW -->|Atomic SQL & State| D1[(Cloudflare D1<br/>Serverless SQLite)]
    
    Cron[Cloudflare Cron Trigger<br/>Daily 03:00 UTC / Hourly] -->|Fires Scheduled Check| CFW
    User -->|Click 'Run Pipeline'| CFW

    CFW -->|workflow_dispatch<br/>GitHub REST API| GHA[GitHub Actions Cloud Runner<br/>Ubuntu 24.04 + Java 21 + Python 3.12]
    GHA -->|Downloads Base APK| Ingest[Google Play / Uptodown / APKPure]
    GHA -->|Applies Bytecode Patches| Morphe[Morphe Desktop CLI]
    GHA -->|Signs Deterministically| Keystore[Hardened Keystore Engine]
    GHA -->|Calculates SHA-256| VT[VirusTotal Telemetry]
    GHA -->|Rolling Release Upload| GHRel[GitHub Releases<br/>Dedicated App Feeds]
    GHA -->|POST /api/webhook/report| CFW
    
    User -->|Obtainium 1-Click Sync| GHRel
    User -->|Direct APK Download| CFW
```

---

## 🚀 Quick Start & Deployment

MorpheFlow provides two deployment methods: **Cloudflare Workers (Serverless)** and **Docker Compose (Self-Hosted)**.

### Method 1: Cloudflare Workers (Recommended · 100% Free · Zero VPS)

Deploy the entire serverless portal and configure the cloud runner in under 2 minutes:

#### 1. Prerequisites
- **Node.js** (v18+) & **npm**
- **Cloudflare Wrangler CLI**: Run `npx wrangler login` to authorize your Cloudflare account.
- **GitHub CLI (`gh`)**: Run `gh auth login` to authorize private repo linking and GitHub Actions automation.

#### 2. Run the 1-Click Deployer
```bash
# Clone the repository
git clone https://github.com/wiwek13/MorpheFlow.git
cd MorpheFlow

# Run the automated deployer
./deploy.sh          # macOS / Linux
.\deploy.ps1         # Windows PowerShell
```
*(Or execute `npm run deploy`)*

The script automatically:
1. Verifies Cloudflare and GitHub CLI credentials.
2. Creates or connects your Cloudflare D1 database (`morpheflow-db`) and pins the UUID into `wrangler.toml`.
3. Applies database schema migrations atomically.
4. Generates a secure, random single-user master password.
5. Deploys the edge worker and static assets to `https://morpheflow.<subdomain>.workers.dev`.
6. Sets up your private GitHub Actions cloud builder and synchronizes secrets (`CLOUDFLARE_WORKER_URL`, `WEBHOOK_SECRET`, `GITHUB_TOKEN`).

---

### Method 2: Docker Compose (Self-Hosted Server / Homelab)

If you prefer self-hosting on your own homelab (Unraid, Proxmox, TrueNAS) or an Oracle Cloud Always Free VPS:

1. **Clone & Setup Environment**:
   ```bash
   git clone https://github.com/wiwek13/MorpheFlow.git
   cd MorpheFlow
   cp example.env .env
   ```
2. **Configure Remote Access & Tunnels**:
   Edit `.env` to configure your preferred tunnel ([Pangolin, Tailscale Funnel, or Cloudflare](docs/tunnels.md)) and email notification settings.
3. **Start the Container**:
   ```bash
   docker compose pull
   docker compose up -d
   ```
4. Access your portal at `http://localhost:8080` (or via your configured tunnel).

---

## 📱 Android Auto-Updates with Obtainium

MorpheFlow provides native first-class support for [Obtainium](https://github.com/ImranR98/Obtainium):

1. Open your MorpheFlow portal on your Android device (or desktop).
2. Click **Obtainium Sync** in the top navigation bar.
3. Tap **Add All to Obtainium** to bulk import all your active packages in one click via `obtainium://apps/` deep links.
4. *Private Repository Support*: If your GitHub build repository is private, create a GitHub Personal Access Token (PAT) with `read-only` contents permission and add it once in **Obtainium Settings > GitHub**.
5. Obtainium will now automatically poll, download, and update all your patched apps silently in the background!

---

## 📚 Documentation Hub

Explore comprehensive guides in our **[Documentation Hub](docs/README.md)**:

* ⚡ **[Cloudflare Workers Setup Guide](docs/cloudflare-workers-setup.md)**: Deep dive into D1 database schemas, edge routing, and GitHub Actions cloud runners.
* 📖 **[User Guide & Web Interface](docs/user-guide.md)**: Managing packages, Pure Patch Studio, custom patch options, and daily scheduling.
* 🚇 **[Remote Access & Tunnels Guide](docs/tunnels.md)**: Setting up Pangolin, Tailscale Funnel, or Cloudflare Tunnels for self-hosted instances.
* ☁️ **[Oracle Free Tier VPS Guide (Optional)](docs/oracle-setup.md)**: How to launch an Always Free VPS on Oracle Cloud Infrastructure.

---

## 🧪 Testing & Verification

MorpheFlow features a comprehensive test suite covering SemVer resolution, atomic locking, VirusTotal integration, Obtainium filtering, and mobile viewport responsiveness:

```bash
# Run unit and integration tests
npm test

# Run TypeScript static type verification
npm run types:check
```

---

## ❤️ Credits & Acknowledgements

MorpheFlow stands on the shoulders of incredible open-source projects and communities:

* **[AutoMorph](https://github.com/holjab/AutoMorph) & [holjab](https://github.com/holjab)**: Heartfelt gratitude to holjab and the AutoMorph community. AutoMorph created the foundational concept, Python scheduling orchestration, and base APK scraping logic that inspired MorpheFlow.
* **[Morphe Desktop](https://morphe.software)**: The cutting-edge Android patching engine that powers MorpheFlow's APK bytecode modification.
* **[ReVanced Team & Community](https://revanced.app)**: The pioneers of modern Android reverse engineering, patcher architecture, and modular patch bundles.
* **[Obtainium](https://github.com/ImranR98/Obtainium) by ImranR98**: The unmatched open-source Android package manager that makes seamless app auto-updates possible.
* **[goopdl](https://github.com/Villoh/goopdl) by Villoh**: Fast, automated package downloads directly from the Google Play Store.
* **[Inotia00 & ReVanced Extended](https://github.com/inotia00)**: For extended patch sets, microg compatibility components, and community support.
* **Team Vanced**: In memory of the pioneers who originally demonstrated the potential of client-side Android enhancement.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
All patched applications and third-party trademarks belong to their respective copyright holders.
