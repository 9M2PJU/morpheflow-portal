#!/usr/bin/env node
/**
 * AutoMorph Automated Version Bumper & Synchronizer
 *
 * Automatically manages Semantic Versioning (SemVer) across the codebase:
 * - Detects changes (commits, Conventional Commits) to determine patch -> minor -> major.
 * - Atomically synchronizes:
 *   1. package.json
 *   2. worker/version.ts
 *   3. web/version.json
 *   4. web/frontend/index.html
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT_DIR, 'package.json');
const WORKER_VERSION_TS = path.join(ROOT_DIR, 'worker', 'version.ts');
const WEB_VERSION_JSON = path.join(ROOT_DIR, 'web', 'version.json');
const INDEX_HTML = path.join(ROOT_DIR, 'web', 'frontend', 'index.html');

function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function parseSemVer(ver) {
  const match = ver.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return { major: 0, minor: 0, patch: 1, prerelease: '' };
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || '',
  };
}

function formatSemVer({ major, minor, patch, prerelease }) {
  const core = `${major}.${minor}.${patch}`;
  return prerelease ? `${core}-${prerelease}` : core;
}

function detectBumpType(requested) {
  if (requested && ['major', 'minor', 'patch'].includes(requested.toLowerCase())) {
    return requested.toLowerCase();
  }

  // Auto-detect from git commit history since last tag or last 10 commits
  const logs = run('git log -n 15 --pretty=format:"%s%b"');
  if (/(BREAKING CHANGE|feat!|breaking:)/i.test(logs)) {
    return 'major';
  }
  if (/(feat\(|feat:)/i.test(logs)) {
    return 'minor';
  }
  return 'patch';
}

function bumpVersion(currentVer, type) {
  const parsed = parseSemVer(currentVer);
  if (type === 'major') {
    parsed.major += 1;
    parsed.minor = 0;
    parsed.patch = 0;
  } else if (type === 'minor') {
    parsed.minor += 1;
    parsed.patch = 0;
  } else {
    parsed.patch += 1;
  }
  return formatSemVer(parsed);
}

function syncAllVersionFiles(newVersion) {
  const currentBranch = run('git rev-parse --abbrev-ref HEAD') || 'main';
  const currentSha = run('git rev-parse --short HEAD') || 'cf-edge';
  const timestamp = new Date().toISOString();

  // 1. package.json
  if (fs.existsSync(PACKAGE_JSON)) {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    pkg.version = newVersion;
    fs.writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  // 2. worker/version.ts
  const workerContent = `/**
 * AutoMorph Version Specification
 * Single source of truth for runtime versioning and telemetry.
 * Automatically synchronized during release and deployment.
 */

export const APP_VERSION = '${newVersion}';
export const APP_BRANCH = '${currentBranch}';
export const APP_COMMIT = '${currentSha}';
export const APP_USER_AGENT = \`AutoMorph-EdgeWorker/\${APP_VERSION} (https://github.com/wiwek13/AutoMorph)\`;
`;
  fs.writeFileSync(WORKER_VERSION_TS, workerContent, 'utf8');

  // 3. web/version.json
  const webVersion = {
    version: newVersion,
    run_number: 1,
    branch: currentBranch,
    commit: currentSha,
    built_at: timestamp,
  };
  fs.writeFileSync(WEB_VERSION_JSON, JSON.stringify(webVersion, null, 2) + '\n', 'utf8');

  // 4. web/frontend/index.html
  if (fs.existsSync(INDEX_HTML)) {
    let indexHtml = fs.readFileSync(INDEX_HTML, 'utf8');
    indexHtml = indexHtml.replace(
      /<span class="brand-badge" id="site-version-tag"[^>]*>v[^<]*<\/span>/,
      `<span class="brand-badge" id="site-version-tag" title="Click to check for updates">v${newVersion}</span>`
    );
    indexHtml = indexHtml.replace(
      /css\/morphe\.css\?v=[^"'\s]+/g,
      `css/morphe.css?v=${newVersion}`
    );
    indexHtml = indexHtml.replace(
      /js\/app\.js\?v=[^"'\s]+/g,
      `js/app.js?v=${newVersion}`
    );
    fs.writeFileSync(INDEX_HTML, indexHtml, 'utf8');
  }

  return {
    version: newVersion,
    branch: currentBranch,
    commit: currentSha,
    timestamp,
  };
}

function main() {
  const arg = process.argv[2];
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const currentVer = pkg.version || '2.1.0';

  if (arg === 'sync') {
    const result = syncAllVersionFiles(currentVer);
    console.log(`\x1b[32m✔ Synchronized version ${result.version} across all files (${result.commit} on ${result.branch})\x1b[0m`);
    return result;
  }

  const bumpType = detectBumpType(arg);
  const newVer = bumpVersion(currentVer, bumpType);
  const result = syncAllVersionFiles(newVer);

  console.log(`\x1b[32m✔ Auto-bumped version (${bumpType.toUpperCase()}): ${currentVer} -> ${newVer}\x1b[0m`);
  console.log(`  • Worker:  ${WORKER_VERSION_TS}`);
  console.log(`  • Web:     ${WEB_VERSION_JSON}`);
  console.log(`  • Portal:  ${INDEX_HTML}`);
  return result;
}

if (require.main === module) {
  main();
}

module.exports = {
  detectBumpType,
  bumpVersion,
  syncAllVersionFiles,
  parseSemVer,
  formatSemVer,
};
