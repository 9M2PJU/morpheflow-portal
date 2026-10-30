# AutoMorph & Obtainium Release Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed 1-click Obtainium direct add links and AutoMorph web dashboard links across all GitHub releases (batch and per-app) and ensure seamless tracking in Obtainium.

**Architecture:** Update GitHub Actions workflow to generate deep links (`obtainium://app/...`) with verified filters (`fallbackToOlderReleases: true`, `filterReleaseTitlesByRegEx: "Truecaller"`, `apkFilterRegEx: "truecaller"`) and render rich markdown buttons for each APK in both batch and per-app releases.

**Tech Stack:** GitHub Actions, Python, YAML, Cloudflare Workers, Obtainium deep-link protocol.

## Global Constraints
- Every line of the GitHub Actions `run: |` step must maintain consistent indentation to avoid YAML parsing failures.
- No raw backslashes inside JSON strings that could break Dart `jsonDecode`.
- Must link AutoMorph portal (`https://automorph.w161112218.workers.dev`) and repository (`wiwek13/AutoMorph`).

---

### Task 1: Update GitHub Actions Release Generator in Workflow

**Files:**
- Modify: `.github/workflows/automorph-cloud-builder.yaml:180-265`

- [ ] **Step 1: Update the release notes generator in the workflow**
Update `.github/workflows/automorph-cloud-builder.yaml` so that:
1. The batch release header includes the AutoMorph web portal link (`https://automorph.w161112218.workers.dev`).
2. Inside the per-APK loop, `OBTAINIUM_URL` is generated using Python, and the 1-click link `👉 [**📲 Add to Obtainium**](${OBTAINIUM_URL})` is appended directly to both `$NOTES_FILE` (batch release) and `$PER_APP_NOTES` (per-app release).

- [ ] **Step 2: Validate YAML syntax locally**
Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/automorph-cloud-builder.yaml')); print('Valid!')"`
Expected output: `Valid!`

- [ ] **Step 3: Commit workflow changes**
```bash
git add .github/workflows/automorph-cloud-builder.yaml
git commit -m "feat(release): embed 1-click obtainium and automorph links in all releases"
```

---

### Task 2: Verify and Sync Cloudflare Worker Links

**Files:**
- Modify: `worker/router.ts`

- [ ] **Step 1: Check router.ts for matching Obtainium payload**
Ensure `worker/router.ts` `/api/files` and `/api/obtainium/export` use identical parameters:
`fallbackToOlderReleases: true`, `filterReleaseTitlesByRegEx: appName`, `apkFilterRegEx: appName.toLowerCase()`.

- [ ] **Step 2: Deploy worker**
Run: `npm run deploy:raw`
Expected: `Deployed automorph triggers`

- [ ] **Step 3: Commit worker changes if any**
```bash
git add worker/router.ts
git commit -m "feat(worker): align obtainium export payload with workflow" || true
```

---

### Task 3: Trigger Live Build and Verify GitHub Releases

**Files:**
- Test via GitHub CLI: `gh workflow run`, `gh run view`, `gh release view`

- [ ] **Step 1: Push all commits to GitHub main**
Run: `git push origin main`

- [ ] **Step 2: Trigger workflow for com.truecaller**
Run: `gh workflow run automorph-cloud-builder.yaml -f target_package="com.truecaller" -f runner_callback_url="https://automorph.w161112218.workers.dev"`

- [ ] **Step 3: Wait for workflow completion and verify release notes**
Run: `gh release view --json body,name,tagName` on the newly created batch and per-app releases.
Verify that:
1. AutoMorph portal link is present.
2. `[📲 Add to Obtainium]` button is clickable and formatted cleanly.
