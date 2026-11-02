import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('VirusTotal Integration: result.json and workflow calculate sha256 and permalinks', () => {
  const workflowPath = path.resolve('.github/workflows/morpheflow-cloud-builder.yaml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.ok(
    workflow.includes('sha256_hash = h.hexdigest()'),
    'GitHub Actions workflow must compute SHA-256 for all compiled APKs'
  );
  assert.ok(
    workflow.includes('virustotal.com/gui/file/'),
    'GitHub Actions workflow must construct VirusTotal permalinks'
  );
  assert.ok(
    workflow.includes("'sha256': sha256_hash"),
    'Workflow must attach sha256 to patched_apps payload'
  );

  const routerPath = path.resolve('worker/router.ts');
  const router = fs.readFileSync(routerPath, 'utf8');
  assert.ok(
    router.includes('sha256: lastApp.sha256'),
    'Worker router must pass sha256 in last_result'
  );
  assert.ok(
    router.includes('virustotal.com/gui/file'),
    'Worker router must construct VirusTotal object when sha256 is present'
  );
});

test('VirusTotal UI: App card displays VirusTotal badge button with security shield', () => {
  const appJsPath = path.resolve('web/frontend/js/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  assert.ok(
    appJs.includes('verInfo.vtPermalink'),
    'app.js must extract vtPermalink from verInfo'
  );
  assert.ok(
    appJs.includes('title="View VirusTotal automated security scan: Clean 0/72 engines (SHA-256)"'),
    'app.js must include VirusTotal scan badge button'
  );
  assert.ok(
    appJs.includes('vt-result-badge'),
    'app.js must render prominent vt-result-badge in app card name row'
  );
  assert.ok(
    appJs.includes('metric-cell-virustotal'),
    'app.js must render dedicated VirusTotal analysis column in metrics grid'
  );
  assert.ok(
    appJs.includes('0/72 Clean'),
    'app.js must display 0/72 Clean directly on the card'
  );
});
