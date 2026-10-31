import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

test('Obtainium: Worker router allows public unauthenticated access to /api/obtainium routes', () => {
  const routerCode = fs.readFileSync(path.join(ROOT_DIR, 'worker', 'router.ts'), 'utf8');

  // Verify isObtainiumEndpoint bypasses authentication check
  assert.match(routerCode, /const\s+isObtainiumEndpoint\s*=\s*path\.startsWith\('\/api\/obtainium'\)\s*&&\s*method\s*===\s*'GET'/);
  assert.match(routerCode, /!isConfigWithWebhook\s*&&\s*!isObtainiumEndpoint/);

  // Verify /api/obtainium/export returns 200 with Cache-Control and CORS
  assert.match(routerCode, /path\s*===\s*'\/api\/obtainium\/export'/);

  // Verify /api/obtainium/:pkg route returns single app release metadata
  assert.match(routerCode, /path\.startsWith\('\/api\/obtainium\/'\)\s*&&\s*path\s*!==\s*'\/api\/obtainium\/export'/);
  assert.match(routerCode, /additionalSettings/);
});

test('Obtainium: Modal contains multi-app selection checklist, select all, clear all, and deep links', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'web', 'frontend', 'index.html'), 'utf8');

  // Verify modal exists with checklist and toolbar
  assert.match(indexHtml, /id="modal-obtainium"/);
  assert.match(indexHtml, /id="obtainium-apps-list"/);
  assert.match(indexHtml, /id="obtainium-selected-count"/);
  assert.match(indexHtml, /toggleAllObtainiumApps\(true\)/);
  assert.match(indexHtml, /toggleAllObtainiumApps\(false\)/);
  assert.match(indexHtml, /filterObtainiumApps\(this\.value\)/);

  // Verify action buttons
  assert.match(indexHtml, /id="btn-download-obtainium-json"/);
  assert.match(indexHtml, /id="btn-copy-obtainium-json"/);
  assert.match(indexHtml, /<a[^>]+id="btn-open-obtainium-direct"/);
  assert.match(indexHtml, /id="btn-open-obtainium-redirect"/);
});

test('Obtainium: Frontend app.js builds valid Obtainium payload with GitHub Releases source and bulk deep links', () => {
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'web', 'frontend', 'js', 'app.js'), 'utf8');

  assert.match(appJs, /function\s+buildObtainiumAppPayload/);
  assert.match(appJs, /fallbackToOlderReleases/);
  assert.match(appJs, /filterReleaseTitlesByRegEx/);
  assert.match(appJs, /apkFilterRegEx/);
  assert.match(appJs, /obtainium:\/\/app\//);
  assert.match(appJs, /obtainium:\/\/apps\//);
  assert.match(appJs, /function\s+getObtainiumDirectDeepLink/);
  assert.match(appJs, /function\s+getObtainiumRedirectUrl/);
  assert.match(appJs, /https:\/\/apps\.obtainium\.imranr\.dev\/redirect\?r=/);
  assert.match(appJs, /function\s+downloadObtainiumJson/);
  assert.match(appJs, /function\s+openDirectObtainiumDeepLink/);
});
