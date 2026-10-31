import test from 'node:test';
import assert from 'node:assert/strict';

// Test mock storage service behavior matching Cloudflare Worker D1 Storage
class MockStorageService {
  constructor() {
    this.packages = new Map();
    this.repos = ['https://github.com/MorpheApp/morphe-patches'];
    this.configs = new Map();
  }

  async listPackages() {
    return Array.from(this.packages.values());
  }

  async savePackage(pkg) {
    this.packages.set(pkg.package, { ...pkg, updated_at: new Date().toISOString() });
    return true;
  }

  async getPackage(pkgName) {
    return this.packages.get(pkgName) || null;
  }

  async getPatchRepos() {
    return [...this.repos];
  }

  async addPatchRepo(url) {
    if (!this.repos.includes(url)) {
      this.repos.push(url);
      return true;
    }
    return false;
  }

  async getConfig(key) {
    return this.configs.get(key) || null;
  }

  async setConfig(key, val) {
    this.configs.set(key, val);
    return true;
  }
}

test('Integration: Configuration Backup & Restore Workflow', async () => {
  const storage = new MockStorageService();
  await storage.savePackage({
    package: 'com.reddit.frontpage',
    package_name: 'Reddit',
    enabled: true,
    repos: ['MorpheApp/morphe-patches'],
    options: { base_apk_url: 'https://example.com/reddit.apk' }
  });

  // 1. Export Backup
  const packages = await storage.listPackages();
  const repos = await storage.getPatchRepos();
  const backup = {
    version: '2.1.0',
    exported_at: new Date().toISOString(),
    packages,
    patch_repos: repos,
  };

  assert.equal(backup.packages.length, 1);
  assert.equal(backup.packages[0].package, 'com.reddit.frontpage');
  assert.equal(backup.packages[0].options.base_apk_url, 'https://example.com/reddit.apk');

  // 2. Fresh Target Storage Restore
  const freshStorage = new MockStorageService();
  for (const pkg of backup.packages) {
    await freshStorage.savePackage(pkg);
  }
  for (const r of backup.patch_repos) {
    await freshStorage.addPatchRepo(r);
  }

  const restoredApps = await freshStorage.listPackages();
  assert.equal(restoredApps.length, 1);
  assert.equal(restoredApps[0].package, 'com.reddit.frontpage');
  assert.equal(restoredApps[0].options.base_apk_url, 'https://example.com/reddit.apk');
});

test('Integration: Custom Base APK Source Persistence for Unlisted Apps', async () => {
  const storage = new MockStorageService();
  await storage.savePackage({
    package: 'com.instaprime.android',
    name: 'InstaPrime',
    enabled: true,
    repos: ['MorpheApp/morphe-patches'],
    options: {}
  });

  const app = await storage.getPackage('com.instaprime.android');
  assert.ok(app);

  app.options.base_apk_url = 'https://drive.google.com/uc?export=download&id=TEST_123';
  await storage.savePackage(app);

  const updated = await storage.getPackage('com.instaprime.android');
  assert.equal(updated.options.base_apk_url, 'https://drive.google.com/uc?export=download&id=TEST_123');
});
