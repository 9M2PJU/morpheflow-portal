import { test } from 'node:test';
import assert from 'node:assert/strict';

// In-memory simulation of Storage Lock logic
class MockStorageLocks {
  constructor() {
    this.state = new Map();
  }

  async getActiveLocks() {
    const now = Date.now() / 1000;
    const raw = this.state.get('active_locks');
    let locks = raw ? JSON.parse(raw) : [];
    const valid = locks.filter(l => !l.expires_at || l.expires_at > now);
    if (valid.length !== locks.length) {
      await this.saveActiveLocks(valid);
    }
    return valid;
  }

  async saveActiveLocks(locks) {
    const now = Date.now() / 1000;
    if (locks.length === 0) {
      this.state.delete('active_locks');
      this.state.delete('active_lock');
      return;
    }
    this.state.set('active_locks', JSON.stringify(locks));
    this.state.set('active_lock', JSON.stringify(locks[locks.length - 1]));
  }

  async acquireLock(data) {
    const locks = await this.getActiveLocks();
    const now = Date.now() / 1000;
    const timeout = data.timeout_seconds || 2700;
    const expires_at = now + timeout;

    const requestedPkg = data.package || null;
    const requestedPkgs = Array.isArray(data.packages)
      ? data.packages
      : requestedPkg
      ? [requestedPkg]
      : [];

    const globalLockActive = locks.some(l => !l.package || l.package === '__all__' || l.package === 'all');
    if (globalLockActive) return false;

    if (requestedPkgs.length === 0) {
      if (locks.length > 0) return false;
      const newLock = { ...data, package: null, acquired_at: now, expires_at };
      await this.saveActiveLocks([newLock]);
      return true;
    }

    const conflicting = requestedPkgs.some(p => locks.some(l => l.package === p));
    if (conflicting) return false;

    const newLocks = [...locks];
    for (const p of requestedPkgs) {
      newLocks.push({
        ...data,
        package: p,
        acquired_at: now,
        expires_at,
      });
    }
    await this.saveActiveLocks(newLocks);
    return true;
  }

  async releaseLock(pkgOrRunId) {
    if (!pkgOrRunId) {
      await this.resetAllLocks();
      return;
    }
    const locks = await this.getActiveLocks();
    const remaining = locks.filter(
      l => l.package !== pkgOrRunId && l.run_id !== pkgOrRunId
    );
    await this.saveActiveLocks(remaining);
  }

  async resetAllLocks() {
    this.state.delete('active_locks');
    this.state.delete('active_lock');
  }
}

test('Parallel Locks: Allows two different packages to acquire locks concurrently', async () => {
  const storage = new MockStorageLocks();

  const lockA = await storage.acquireLock({
    run_id: 'run-1',
    source: 'manual',
    package: 'com.google.android.youtube',
  });
  assert.equal(lockA, true, 'Package A should successfully acquire lock');

  const lockB = await storage.acquireLock({
    run_id: 'run-2',
    source: 'manual',
    package: 'com.instaprime.android',
  });
  assert.equal(lockB, true, 'Package B should concurrently acquire lock without 409 conflict');

  const active = await storage.getActiveLocks();
  assert.equal(active.length, 2, 'Both package locks should be active');
  assert.deepEqual(active.map(l => l.package), ['com.google.android.youtube', 'com.instaprime.android']);
});

test('Parallel Locks: Blocks acquiring a duplicate lock for an already executing package', async () => {
  const storage = new MockStorageLocks();

  await storage.acquireLock({
    run_id: 'run-1',
    source: 'manual',
    package: 'com.google.android.youtube',
  });

  const duplicate = await storage.acquireLock({
    run_id: 'run-2',
    source: 'manual',
    package: 'com.google.android.youtube',
  });
  assert.equal(duplicate, false, 'Duplicate lock for the same package must be rejected');
});

test('Parallel Locks: Batch acquisition locks all specified packages', async () => {
  const storage = new MockStorageLocks();

  const batchAcquired = await storage.acquireLock({
    run_id: 'batch-1',
    source: 'batch_waiting',
    packages: ['com.truecaller', 'com.reddit.frontpage'],
  });
  assert.equal(batchAcquired, true, 'Batch lock acquisition should succeed');

  const active = await storage.getActiveLocks();
  assert.equal(active.length, 2);
  assert.deepEqual(active.map(l => l.package), ['com.truecaller', 'com.reddit.frontpage']);
});

test('Parallel Locks: Release for a specific package releases only that package', async () => {
  const storage = new MockStorageLocks();

  await storage.acquireLock({ run_id: 'run-1', package: 'pkg.one' });
  await storage.acquireLock({ run_id: 'run-2', package: 'pkg.two' });

  await storage.releaseLock('pkg.one');

  const remaining = await storage.getActiveLocks();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].package, 'pkg.two');
});

test('Parallel Locks: resetAllLocks immediately clears all active locks', async () => {
  const storage = new MockStorageLocks();

  await storage.acquireLock({ run_id: 'run-1', package: 'pkg.one' });
  await storage.acquireLock({ run_id: 'run-2', package: 'pkg.two' });

  await storage.resetAllLocks();

  const remaining = await storage.getActiveLocks();
  assert.equal(remaining.length, 0, 'All locks must be cleared after reset');
});
