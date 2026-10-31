# AutoMorph UI Revamp & Morphe Catalog Implementation Plan

This implementation plan details the exact technical steps required to migrate the live AutoMorph web application (`web/frontend/`) and edge worker API (`worker/`) to the new **Hallmark + Taste Hybrid Design System** specified in [`docs/superpowers/specs/2026-10-31-ui-redesign-and-morphe-catalog-spec.md`](../specs/2026-10-31-ui-redesign-and-morphe-catalog-spec.md).

---

## 1. User Goal & High-Level Scope

The user is transitioning AutoMorph from its legacy appearance (muddy dark-teal glassmorphism, uncalibrated Inter font, centered layouts) into an aerospace-grade developer console featuring:
1. **Community Store Tab**: Live browsing of 1,342 Android apps and 365 patch bundles from `https://morphe-patches.software` with 1-click provisioning into the pipeline.
2. **Deterministic Keystore Dashboard**: Displaying the active permanent keystore fingerprint (`0b:30:8b:4c...`) ensuring signature consistency across builds.
3. **Obtainium & Patch-Versioned APK Distribution**: Standardized filenames (`{pkg}_{app_ver}_{patch_ver}_patched.apk`) and `obtainium://app/...` deep links.
4. **All-New Hybrid UI Architecture**: Asymmetric Bento 2.0 overview deck, top telemetry monolith, slide-over drawer, and full dual-mode (Dark & Light) theme parity.

---

## 2. Skills & References Reference Table

| Tool / Skill | Location on Disk | Role in Redesign |
| :--- | :--- | :--- |
| **Hallmark Skill** | `/Users/wi15d0m/.agents/skills/hallmark/` | Rules against generic AI defaults; OKLCH tokens; mechanical discipline. |
| **Sloplint Validator** | `/Users/wi15d0m/.agents/skills/hallmark/scripts/sloplint.mjs` | Automated CSS and markup linter (must pass with 0 FAIL / 0 REFLEX). |
| **Taste Frontend Skill** | `/Users/wi15d0m/.gemini/antigravity-cli/skills/design-taste-frontend/` | Bento 2.0 asymmetric layouts, fractional grids, 5 card archetypes, tactile physics. |
| **GPT-Taste Skill** | `/Users/wi15d0m/.gemini/antigravity-cli/skills/gpt-taste/` | Anti-slop constraints: Banning Inter, emojis, pure `#000`, and AI purple gradients. |

---

## 3. Step-by-Step Execution Plan

### Step 1: Worker Edge Proxy for Morphe Catalog (`worker/router.ts`)
- **Objective**: Expose `GET /api/catalog` and `POST /api/catalog/provision` without exposing the browser to cross-origin issues or rate limits.
- **Tasks**:
  1. In `worker/router.ts`, implement `GET /api/catalog`:
     - Fetch `https://morphe-patches.software/data/bundles.json`.
     - Cache via Cloudflare Workers Cache API (`cacheTtl: 21600` / 6 hours).
     - Return `{ store, bundles, compatibilities, featured }`.
  2. Implement `POST /api/catalog/provision`:
     - Validate input `{ package, package_name, repo }`.
     - Insert package into D1 `packages` table:
       ```sql
       INSERT OR REPLACE INTO packages (package, package_name, enabled, repos, patch_aliases, options, created_at, updated_at)
       VALUES (?, ?, 1, ?, '[]', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
       ```
  3. Deploy worker: `npm run deploy:raw`.

### Step 2: CSS Architecture Migration (`web/frontend/css/morphe.css`)
- **Objective**: Replace legacy CSS with the Hallmark + Taste token system derived in [`docs/mockups/automorph_nextgen_mockup.html`](../../mockups/automorph_nextgen_mockup.html).
- **Tasks**:
  1. Stamp the CSS source at line 1:
     ```css
     /* Hallmark · genre: modern-minimal · scope: app · theme: cobalt-console
      * posture: restrained · paper: light+dark · modes: dual · states: 8 · contrast: pass
      * floor: 0 FAIL · reflex: 0 · v2.0.0 */
     ```
  2. Define OKLCH tokens for `:root` and `[data-theme="light"]`.
  3. Implement layout styles:
     - `.app-shell`: Centered 1440px max-width container with `overflow-x: clip`.
     - `.top-chrome`: Monolith bar with segmented navigation dock and breathing status beacon.
     - `.bento-overview-deck`: Asymmetric `minmax(0, 1.8fr)` : `minmax(0, 1.1fr)` grid.
     - `.store-catalog-grid`: Responsive card grid for the 1,342 apps.
     - `.slide-drawer`: 580px slide-over sheet for patch configuration.
  4. Run `node ~/.agents/skills/hallmark/scripts/sloplint.mjs web/frontend/css/morphe.css --scope app` and ensure 0 FAIL.

### Step 3: Markup Structure Overhaul (`web/frontend/index.html`)
- **Objective**: Refactor the page shell into the 5 core views.
- **Tasks**:
  1. Update Google Fonts: Load `Geist` (400, 500, 600, 700) and `Geist Mono` (400, 500, 600). Remove `Inter`.
  2. Structure the navigation dock with 5 buttons: `Overview`, `Configured Apps`, `Community Store`, `Pipeline Logs`, `Settings`.
  3. Create view containers:
     - `<main id="view-overview" class="view-panel">`
     - `<main id="view-apps" class="view-panel">`
     - `<main id="view-store" class="view-panel">`
     - `<main id="view-pipeline" class="view-panel">`
     - `<main id="view-settings" class="view-panel">`
  4. Port the Slide-Over Drawer `<div class="drawer-backdrop" id="app-drawer-backdrop">` and 1-Click Provisioning Modal `<div class="modal-overlay" id="provision-modal">`.

### Step 4: JavaScript State & Interactivity (`web/frontend/js/app.js`)
- **Objective**: Wire all dynamic data, catalog search, category pills, drawer management, and 1-click provisioning into `app.js`.
- **Tasks**:
  1. Add `state.catalog = null` and `state.currentTab = 'overview'`.
  2. Implement `async function loadCatalog()`:
     - Call `GET /api/catalog`.
     - Render store cards with app icons, package names, description, and "Provision" CTA.
  3. Implement catalog search filter (`#store-search-input`) with debouncing and category pill click filtering.
  4. Implement `openDrawer(pkg)` / `closeDrawer()` for patch sub-option editing.
  5. Implement `confirmProvision()` which triggers `POST /api/catalog/provision` and updates the active app queue.
  6. Hook up the theme toggle to persist in `localStorage` under `automorph-theme`.

### Step 5: Verification & Quality Assurance
- **Tasks**:
  1. Verify zero lint errors:
     ```bash
     node ~/.agents/skills/hallmark/scripts/sloplint.mjs web/frontend/index.html --scope app
     ```
  2. Verify build output & bundle size.
  3. Verify responsive layout collapse on mobile viewports (< 768px).
  4. Deploy to live Cloudflare Worker via `npm run deploy:raw` and verify live database updates.
