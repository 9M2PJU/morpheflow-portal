import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Parallel Build Dispatch & Pipeline Live Telemetry', () => {
  const routerPath = path.join(__dirname, '../../worker/router.ts');
  const appJsPath = path.join(__dirname, '../../web/frontend/js/app.js');

  const routerCode = fs.readFileSync(routerPath, 'utf8');
  const appJsCode = fs.readFileSync(appJsPath, 'utf8');

  it('router dispatches parallel builds concurrently using Promise.allSettled', () => {
    assert.ok(routerCode.includes('Promise.allSettled('), 'Missing Promise.allSettled for concurrent dispatch');
    assert.ok(routerCode.includes('packages.map(async (targetPkg)'), 'Missing parallel map over packages');
  });

  it('router batches log writes into a single storage.appendRunLogs call instead of a loop', () => {
    assert.ok(routerCode.includes('logsToAppend.length > 0'), 'Missing batched log array check');
    assert.ok(routerCode.includes('await storage.appendRunLogs(runId, logsToAppend)'), 'Missing batch log insert');
  });

  it('router safely releases lock and returns 502 if all dispatches fail', () => {
    assert.ok(routerCode.includes('await storage.releaseLock(runId)'), 'Missing lock release on total dispatch failure');
    assert.ok(routerCode.includes('502'), 'Missing 502 error status code on total dispatch failure');
  });

  it('frontend patchAllWaitingApps prevents mobile double-tap with busy loading state', () => {
    assert.ok(appJsCode.includes('btn.disabled = true'), 'Missing button disabled state on dispatch');
    assert.ok(appJsCode.includes('Dispatching…'), 'Missing dispatching feedback text');
  });

  it('frontend loadPipelineViewLogs starts active poller and updates parallel target badge', () => {
    assert.ok(appJsCode.includes('pipelinePollerTimer'), 'Missing pipeline poller timer definition');
    assert.ok(appJsCode.includes('loadPipelineViewLogs'), 'Missing loadPipelineViewLogs');
    assert.ok(appJsCode.includes('Parallel Targets') || appJsCode.includes('apps in parallel'), 'Missing parallel target badge label');
  });
});
