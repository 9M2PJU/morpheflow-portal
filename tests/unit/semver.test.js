import test from 'node:test';
import assert from 'node:assert/strict';

function parseSemVer(v) {
  if (!v || typeof v !== 'string') return null;
  const clean = v.replace(/^[vV]/, '').trim();
  const match = clean.match(/^([0-9]+(?:\.[0-9]+)*)(?:[-_+](.+))?$/);
  if (!match) return null;
  const base = match[1];
  const prerelease = match[2] || null;
  const parts = base.split('.').map(n => parseInt(n, 10));
  if (!parts.every(n => !isNaN(n))) return null;
  if (prerelease) {
    Object.defineProperty(parts, 'prerelease', { value: prerelease, enumerable: false });
  }
  return parts;
}

function compareSemVer(v1, v2) {
  const p1 = parseSemVer(v1);
  const p2 = parseSemVer(v2);
  if (!p1 || !p2) {
    if (v1 === v2) return 0;
    return (v1 || '') > (v2 || '') ? 1 : -1;
  }
  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  const pre1 = p1.prerelease;
  const pre2 = p2.prerelease;
  if (!pre1 && pre2) return 1;
  if (pre1 && !pre2) return -1;
  if (pre1 && pre2) return pre1.localeCompare(pre2, undefined, { numeric: true });
  return 0;
}

function classifyAppUpdate(currentVer, targetVer) {
  if (!currentVer) return 'awaiting_build';
  if (!targetVer) return 'uptodate';
  const cmp = compareSemVer(currentVer, targetVer);
  if (cmp < 0) return 'update_available';
  if (cmp > 0) return 'ahead';
  return 'uptodate';
}

test('SemVer parsing handles 2-segment, 3-segment, 4-segment, and 5-segment Android APK versions', () => {
  assert.deepEqual(parseSemVer('v1.0.0'), [1, 0, 0]);
  assert.deepEqual(parseSemVer('9.42.52'), [9, 42, 52]);
  assert.deepEqual(parseSemVer('2026.43.0'), [2026, 43, 0]);
  assert.deepEqual(parseSemVer('v435.0.0.37.76'), [435, 0, 0, 37, 76]);
  assert.equal(parseSemVer('invalid_alpha'), null);
});

test('compareSemVer accurately identifies newer, older, and identical versions', () => {
  assert.equal(compareSemVer('v2026.41.0', 'v2026.43.0'), -1);
  assert.equal(compareSemVer('v2026.43.0', 'v2026.41.0'), 1);
  assert.equal(compareSemVer('v9.42.52', '9.42.52'), 0);
  assert.equal(compareSemVer('v26.10.6', 'v26.42.5'), -1);
  assert.equal(compareSemVer('v435.0.0.37.76', 'v435.0.0.37.75'), 1);
  // Pre-release precedence tests (SemVer 2.0.0)
  assert.equal(compareSemVer('1.2.3-beta.1', '1.2.3'), -1);
  assert.equal(compareSemVer('1.2.3', '1.2.3-beta.1'), 1);
  assert.equal(compareSemVer('1.2.3-beta.1', '1.2.3-beta.2'), -1);
  assert.equal(compareSemVer('1.2.3-beta.2', '1.2.3-beta.1'), 1);
});

test('classifyAppUpdate correctly flags App Update Available when target is newer', () => {
  const status = classifyAppUpdate('2026.35.0', '2026.41.0');
  assert.equal(status, 'update_available');
});

test('classifyAppUpdate correctly flags Ahead when installed base is newer than target', () => {
  const status = classifyAppUpdate('2026.43.0', '2026.41.0');
  assert.equal(status, 'ahead');
});

test('classifyAppUpdate correctly flags Up to Date when versions match', () => {
  const status = classifyAppUpdate('v9.42.52', 'v9.42.52');
  assert.equal(status, 'uptodate');
});

test('classifyAppUpdate flags Awaiting Build when installed base is null or empty', () => {
  assert.equal(classifyAppUpdate(null, 'v9.42.52'), 'awaiting_build');
  assert.equal(classifyAppUpdate('', 'v9.42.52'), 'awaiting_build');
});
