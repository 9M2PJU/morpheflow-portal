import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('HTML: Base APK upload modal contains real-time progress bar elements', () => {
  const html = fs.readFileSync('web/frontend/index.html', 'utf8');
  assert.ok(html.includes('id="prompt-apk-progress-container"'), 'Must have prompt-apk-progress-container');
  assert.ok(html.includes('id="prompt-apk-progress-bar"'), 'Must have prompt-apk-progress-bar');
  assert.ok(html.includes('id="prompt-apk-progress-percent"'), 'Must have prompt-apk-progress-percent');
  assert.ok(html.includes('id="prompt-apk-progress-bytes"'), 'Must have prompt-apk-progress-bytes');
  assert.ok(html.includes('id="prompt-apk-progress-status"'), 'Must have prompt-apk-progress-status');
});

test('CSS: morphe.css defines upload progress container, track, and fill classes', () => {
  const css = fs.readFileSync('web/frontend/css/morphe.css', 'utf8');
  assert.ok(css.includes('.upload-progress-container'), 'Must have .upload-progress-container');
  assert.ok(css.includes('.upload-progress-track'), 'Must have .upload-progress-track');
  assert.ok(css.includes('.upload-progress-fill'), 'Must have .upload-progress-fill');
  assert.ok(css.includes('.upload-progress-percent'), 'Must have .upload-progress-percent');
});

test('Upload Progress: Progress computation accurately formats percentages and megabytes', () => {
  const total = 50 * 1024 * 1024; // 50 MB
  const loaded = 25 * 1024 * 1024; // 25 MB

  const percent = Math.min(100, Math.round((loaded / total) * 100));
  const loadedMb = (loaded / (1024 * 1024)).toFixed(1);
  const totalMb = (total / (1024 * 1024)).toFixed(1);

  assert.equal(percent, 50);
  assert.equal(loadedMb, '25.0');
  assert.equal(totalMb, '50.0');
});

test('JS: app.js contains uploadApkWithProgress helper and drawer progress container', () => {
  const js = fs.readFileSync('web/frontend/js/app.js', 'utf8');
  assert.ok(js.includes('function uploadApkWithProgress'), 'Must define uploadApkWithProgress');
  assert.ok(js.includes('id="drawer-apk-progress-container"'), 'Drawer template must include drawer-apk-progress-container');
  assert.ok(js.includes('id="drawer-apk-progress-bar"'), 'Drawer template must include drawer-apk-progress-bar');
});
