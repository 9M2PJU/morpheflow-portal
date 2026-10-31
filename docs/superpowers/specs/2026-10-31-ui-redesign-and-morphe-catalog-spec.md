# AutoMorph UI Revamp & Morphe Catalog Integration Specification

## 1. Context & Objective
The user requested a **complete ground-up UI redesign** of AutoMorph (an automated edge Android APK patching and distribution platform) and the native integration of the **Morphe-Patches Community Catalog** (`1,342` apps and `365` patch bundles from `https://morphe-patches.software`).

### What We Are Achieving
1. **Eradicate Legacy Design**:
   - The original UI suffered from muddy dark cyan/teal-tinted glassmorphism, heavy backdrop blurs, uncalibrated Inter typography, and fragile centered cards.
   - Replaced with an **Apple / Linear / Vercel-tier engineered developer console** combining the mechanical rigor of the **Hallmark Design System** with the high-agency layout dynamism of the **Taste Design System**.
2. **Community Store & 1-Click Provisioning**:
   - Directly browse the 1,342 apps and 365 bundles sourced from `https://morphe-patches.software/data/bundles.json`.
   - 1-Click "Provision" button that automatically registers the package, display name, recommended patch bundle repository, and verified compatible version into AutoMorph's Cloudflare D1 database.
3. **Deterministic Keystore Transparency**:
   - AutoMorph now uses a dedicated, permanent PKCS12 keystore (`tools/automorph-data/automorph.keystore`).
   - The UI surfaces a prominent **Deterministic Signing Seal** displaying the keystore SHA-256 fingerprint (`0b:30:8b:4c...`), assuring users that new builds will cleanly install over existing builds without signature collisions.
4. **Standardized Distribution & Obtainium Deep Links**:
   - Patched APKs follow the versioned naming convention: `{package}_{app_version}_{patch_version}_patched.apk`.
   - 1-Click `obtainium://app/...` deep links allow mobile users to install/track updates directly on Android devices.

---

## 2. Design Skills Used & Locations on Disk

Any agent continuing this work should review the following local skills:

### 1. Hallmark Design System
- **Location on Disk**: `/Users/wi15d0m/.agents/skills/hallmark/`
  - Main file: `/Users/wi15d0m/.agents/skills/hallmark/SKILL.md`
  - Genre spec: `/Users/wi15d0m/.agents/skills/hallmark/references/genres/modern-minimal.md`
  - Scope: App screen (`/Users/wi15d0m/.agents/skills/hallmark/references/flow.md` § App screens)
  - Dark mode rules: `/Users/wi15d0m/.agents/skills/hallmark/references/dark-mode.md`
  - States & patterns: `interaction-and-states.md`, `patterns.md`
- **Linting Tool**:
  ```bash
  node ~/.agents/skills/hallmark/scripts/sloplint.mjs <path/to/file> --scope app
  ```
  *(Must pass with 0 FAIL and 0 REFLEX)*

### 2. Taste Design System (`design-taste-frontend`)
- **Location on Disk**:
  - `/Users/wi15d0m/.gemini/antigravity-cli/skills/design-taste-frontend/SKILL.md`
  - `/Users/wi15d0m/.agents/skills/design-taste-frontend/SKILL.md`
- **Calibrated Dials**:
  - `DESIGN_VARIANCE: 8` — Asymmetric fractional grids (`minmax(0, 1.8fr) : minmax(0, 1.1fr)`), masonry catalog flows.
  - `MOTION_INTENSITY: 4` — Calibrated down for daily app usability (0.15s–0.24s transitions, tactile `:active` press `translateY(1px)`).
  - `VISUAL_DENSITY: 4.5` — High-efficiency Daily App density (no nested cards; negative space and 1px dividers).

### 3. GPT-Taste (Motion & Anti-Slop Discipline)
- **Location on Disk**:
  - `/Users/wi15d0m/.gemini/antigravity-cli/skills/gpt-taste/SKILL.md`
  - `/Users/wi15d0m/.agents/skills/gpt-taste/SKILL.md`
- **Strict Anti-Patterns**:
  - BANNED: `Inter` font, emojis as icons, pure `#000000` pitch black, AI purple/cyan glows, 3-equal-card rows, generic startup names.

---

## 3. Synthesized Hybrid Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                      THE SYNTHESIZED MASTER SYSTEM                     │
├────────────────────────────┬───────────────────────────────────────────┤
│ Hallmark Non-Waivable Base │ • 0 FAIL sloplint passability             │
│                            │ • OKLCH mathematical dual-mode derivation │
│                            │ • 8 control states + 4 data region states │
│                            │ • overflow-x: clip; prefers-reduced-motion│
├────────────────────────────┼───────────────────────────────────────────┤
│ Taste High-Agency Identity │ • Asymmetric Bento 2.0 Operations Deck    │
│                            │ • Geist + Geist Mono (tabular numerals)   │
│                            │ • 1px optical refraction rim (no mud blur)│
│                            │ • Tactile press physics (scale/translate) │
│                            │ • Top Telemetry Monolith & Quick Actions  │
└────────────────────────────┴───────────────────────────────────────────┘
```

### 3.1 Token System (`OKLCH` Anchor Hue $h = 252^\circ$)
- **Dark Mode**: Canvas `oklch(15.5% 0.010 252)` (Obsidian Zinc), Card `oklch(18.5% 0.012 252)`, Elevated `oklch(22.0% 0.015 252)`.
- **Light Mode**: Canvas `oklch(98.6% 0.005 252)` (Clean Slate), Card `oklch(97.0% 0.006 252)`.
- **Primary Accent**: Signal Cobalt `oklch(58% 0.190 255)` (`#3b82f6` dark / `#2563eb` light).
- **Typography**: `Geist` for display/UI, `Geist Mono` for package names, SHA-256 fingerprints, cron timestamps, and durations.

---

## 4. Master Mockup & Rendered Assets

The complete production mockup has been verified and committed to the repository:

| Artifact | Local Path in Repository |
| :--- | :--- |
| **HTML Mockup (Verified 0 FAIL)** | [`docs/mockups/automorph_nextgen_mockup.html`](file:///Users/wi15d0m/Documents/Projects/AutoMorph/docs/mockups/automorph_nextgen_mockup.html) |
| **Overview Deck Screenshot** | [`docs/mockups/nextgen_overview.png`](file:///Users/wi15d0m/Documents/Projects/AutoMorph/docs/mockups/nextgen_overview.png) |
| **Community Store Screenshot** | [`docs/mockups/nextgen_store.png`](file:///Users/wi15d0m/Documents/Projects/AutoMorph/docs/mockups/nextgen_store.png) |
| **App Detail Drawer Screenshot** | [`docs/mockups/nextgen_drawer.png`](file:///Users/wi15d0m/Documents/Projects/AutoMorph/docs/mockups/nextgen_drawer.png) |

---

## 5. Design Proposals & Evaluation Documents

Additional deep-dive research artifacts generated during the analysis:
- **Hallmark Proposal**: `/Users/wi15d0m/.gemini/antigravity-cli/brain/20a210da-9b4d-460c-8666-912e6715b33e/hallmark_design_proposal.md`
- **Taste Proposal**: `/Users/wi15d0m/.gemini/antigravity-cli/brain/20a210da-9b4d-460c-8666-912e6715b33e/taste_design_proposal.md`
- **Comparison & Synthesis**: `/Users/wi15d0m/.gemini/antigravity-cli/brain/20a210da-9b4d-460c-8666-912e6715b33e/design_system_comparison_hallmark_vs_taste.md`
- **Full Feature Mental Model**: `/Users/wi15d0m/.gemini/antigravity-cli/brain/20a210da-9b4d-460c-8666-912e6715b33e/automorph_feature_brainstorm_and_mental_model.md`
