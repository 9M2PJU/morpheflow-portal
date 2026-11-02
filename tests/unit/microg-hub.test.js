import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('MicroG-RE Hub: Endpoints are defined and publicly accessible without authentication', () => {
  const routerPath = path.resolve('worker/router.ts');
  const router = fs.readFileSync(routerPath, 'utf8');

  assert.ok(
    router.includes("path === '/api/gmscore/latest' || path === '/api/gmscore/download'"),
    'Router must exempt /api/gmscore/latest and /api/gmscore/download from authentication'
  );
  assert.ok(
    router.includes("https://api.github.com/repos/MorpheApp/GmsCore/releases/latest"),
    'Router must proxy upstream MorpheApp/GmsCore releases'
  );
  assert.ok(
    router.includes("Response.redirect(apkAsset.browser_download_url, 302)"),
    'Router must redirect /api/gmscore/download directly to latest APK binary'
  );
});

test('MicroG-RE UI: Overview includes MicroG-RE Companion Hub and Play Protect guide modal', () => {
  const htmlPath = path.resolve('web/frontend/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(
    html.includes('MicroG-RE Companion Hub'),
    'Overview must render MicroG-RE Companion Hub card'
  );
  assert.ok(
    html.includes('id="gmscore-version-badge"'),
    'Overview must include dynamic GmsCore version badge'
  );
  assert.ok(
    html.includes('id="modal-microg-help"'),
    'HTML must include MicroG Setup & Play Protect Guide modal'
  );

  const appJsPath = path.resolve('web/frontend/js/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(
    appJs.includes('function loadGmsCoreStatus'),
    'app.js must define loadGmsCoreStatus'
  );
  assert.ok(
    appJs.includes('function openMicroGHelpModal'),
    'app.js must define openMicroGHelpModal'
  );
});
