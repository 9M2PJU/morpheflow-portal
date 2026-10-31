import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  detectBumpType,
  bumpVersion,
  parseSemVer,
  formatSemVer,
} = require('../../scripts/bump-version.cjs');

test('Version Automation: parseSemVer and formatSemVer work accurately', () => {
  const parsed = parseSemVer('2.2.0');
  assert.equal(parsed.major, 2);
  assert.equal(parsed.minor, 2);
  assert.equal(parsed.patch, 0);

  const formatted = formatSemVer({ major: 2, minor: 2, patch: 0 });
  assert.equal(formatted, '2.2.0');

  const prerelease = parseSemVer('3.0.0-beta.1');
  assert.equal(prerelease.major, 3);
  assert.equal(prerelease.prerelease, 'beta.1');
});

test('Version Automation: bumpVersion correctly transitions patch -> minor -> major', () => {
  // Patch bump
  assert.equal(bumpVersion('2.2.0', 'patch'), '2.2.1');
  assert.equal(bumpVersion('2.2.9', 'patch'), '2.2.10');

  // Minor bump (resets patch)
  assert.equal(bumpVersion('2.2.5', 'minor'), '2.3.0');

  // Major bump (resets minor and patch)
  assert.equal(bumpVersion('2.2.5', 'major'), '3.0.0');
});

test('Version Automation: Single source of truth is synchronized across files', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const currentVer = pkg.version;
  assert.ok(currentVer, 'package.json must specify a version');

  const workerVerTs = fs.readFileSync('worker/version.ts', 'utf8');
  assert.ok(
    workerVerTs.includes(`APP_VERSION = '${currentVer}'`),
    `worker/version.ts must have APP_VERSION matching package.json (${currentVer})`
  );

  const webVerJson = JSON.parse(fs.readFileSync('web/version.json', 'utf8'));
  assert.equal(webVerJson.version, currentVer, 'web/version.json must match package.json version');

  const indexHtml = fs.readFileSync('web/frontend/index.html', 'utf8');
  assert.ok(
    indexHtml.includes(`id="site-version-tag" title="Click to check for updates">v${currentVer}</span>`),
    `index.html must match fallback version v${currentVer}`
  );
});
