import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const cssPath = path.resolve('web/frontend/css/morphe.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

test('morphe.css defines high-contrast --metric-recommended token for both dark and light themes', () => {
  // Dark mode in :root
  const rootMatch = cssContent.match(/--metric-recommended:\s*oklch\(\s*(\d+)%/);
  assert.ok(rootMatch, 'Must define --metric-recommended in :root');
  const darkLightness = parseInt(rootMatch[1], 10);
  assert.ok(darkLightness >= 70, `Dark mode recommended version should be >=70% lightness, got ${darkLightness}%`);

  // Light mode in [data-theme="light"]
  const lightBlock = cssContent.slice(cssContent.indexOf('[data-theme="light"]'));
  const lightMatch = lightBlock.match(/--metric-recommended:\s*oklch\(\s*(\d+)%/);
  assert.ok(lightMatch, 'Must define --metric-recommended in [data-theme="light"]');
  const lightLightness = parseInt(lightMatch[1], 10);
  assert.ok(lightLightness <= 50, `Light mode recommended version should be <=50% lightness (high contrast), got ${lightLightness}%`);
});

test('.metric-cell-value.highlight-recommended must never use var(--accent-ink)', () => {
  const ruleMatch = cssContent.match(/\.metric-cell-value\.highlight-recommended\s*\{([^}]+)\}/);
  assert.ok(ruleMatch, 'Must find .metric-cell-value.highlight-recommended rule');
  assert.ok(!ruleMatch[1].includes('var(--accent-ink)'), 'Rule must not use var(--accent-ink) which causes white-on-white text');
  assert.ok(ruleMatch[1].includes('var(--metric-recommended)'), 'Rule must use var(--metric-recommended)');
});
