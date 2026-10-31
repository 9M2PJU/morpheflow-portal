import test from 'node:test';
import assert from 'node:assert/strict';

function validateBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be an object' };
  }
  if (!Array.isArray(payload.packages) && !Array.isArray(payload.patch_repos)) {
    return { valid: false, error: 'Payload missing packages or patch_repos array' };
  }
  const validPackages = (payload.packages || []).filter(p => p && (p.package || p.package_name));
  const validRepos = (payload.patch_repos || []).filter(r => typeof r === 'string' && r.trim().length > 0);
  return {
    valid: true,
    packageCount: validPackages.length,
    repoCount: validRepos.length,
  };
}

test('validateBackupPayload accepts valid backup with packages and repos', () => {
  const sample = {
    version: '2.1.0',
    exported_at: '2026-10-31T08:00:00.000Z',
    packages: [
      { package: 'com.reddit.frontpage', name: 'Reddit', enabled: true },
      { package: 'com.google.android.apps.youtube.music', name: 'YouTube Music', enabled: true }
    ],
    patch_repos: [
      'https://github.com/MorpheApp/morphe-patches',
      'https://github.com/heval99/Heval-Morphe-Patches'
    ]
  };

  const res = validateBackupPayload(sample);
  assert.equal(res.valid, true);
  assert.equal(res.packageCount, 2);
  assert.equal(res.repoCount, 2);
});

test('validateBackupPayload rejects corrupted or malformed payloads', () => {
  assert.equal(validateBackupPayload(null).valid, false);
  assert.equal(validateBackupPayload('string').valid, false);
  assert.equal(validateBackupPayload({ foo: 'bar' }).valid, false);
});
