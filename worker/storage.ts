/**
 * MorpheFlow D1 Storage Service
 * Provides SQLite operations matching MorpheFlow's data contract on Cloudflare Free Tier.
 */

import {
  Env,
  PackageRecord,
  PatchedAppRecord,
  RunHistoryRecord,
  StorageStats,
  SystemSettings,
  EmailSettings,
  KeystoreSettings,
} from './types';

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  for (const unit of units) {
    if (val < 1024.0) {
      return `${val.toFixed(2)} ${unit}`;
    }
    val /= 1024.0;
  }
  return `${val.toFixed(2)} PB`;
}

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS packages (
    package TEXT PRIMARY KEY,
    package_name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    repos TEXT NOT NULL DEFAULT '[]',
    patch_aliases TEXT NOT NULL DEFAULT '[]',
    options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS patched_apps (
    package TEXT NOT NULL,
    version TEXT NOT NULL,
    arch TEXT NOT NULL DEFAULT 'arm64-v8a',
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    formatted_size TEXT NOT NULL DEFAULT '0 B',
    sha256 TEXT,
    download_url TEXT NOT NULL,
    release_url TEXT,
    applied_patches TEXT NOT NULL DEFAULT '[]',
    result_json TEXT,
    patched_at TEXT NOT NULL,
    PRIMARY KEY (package, version)
  );`,
  `CREATE TABLE IF NOT EXISTS run_history (
    run_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    returncode INTEGER NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0.0,
    duration_formatted TEXT NOT NULL DEFAULT '--',
    source TEXT NOT NULL DEFAULT 'manual',
    package TEXT,
    finished_at REAL NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    log_text TEXT NOT NULL,
    created_at REAL NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs (run_id);`,
  `CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at REAL NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS app_sources (
    package TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'github',
    repo TEXT,
    asset_pattern TEXT,
    version TEXT DEFAULT 'most_recent',
    arch TEXT,
    url TEXT
  );`,
];

export class StorageService {
  constructor(private db: D1Database) {}

  async initializeDatabase(): Promise<void> {
    for (const statement of SCHEMA_STATEMENTS) {
      await this.db.prepare(statement).run();
    }

    // Seed default settings if not existing
    const existingSys = await this.getConfig('system');
    if (!existingSys) {
      const defaultSys: SystemSettings = {
        architecture: 'arm64-v8a',
        striplibs: true,
        low_spec_mode: true,
        schedule_time: '03:00',
        run_on_startup: false,
        timezone: 'Etc/UTC',
        max_logs: 5,
        max_original_packages: null,
        max_patched_packages: null,
        update_check_interval_hours: 4,
        status_poll_interval_seconds: 30,
      };
      await this.setConfig('system', defaultSys);
    }

    const existingEmail = await this.getConfig('email');
    if (!existingEmail) {
      const defaultEmail: EmailSettings = {
        enabled: false,
        smtp_server: '',
        smtp_port: 587,
        use_tls: true,
        use_ssl: false,
        sender_name: 'MorpheFlow',
        sender_email: '',
        recipients: [],
        subject_prefix: '[MorpheFlow]',
        attach_result_json: false,
        layout_mode: 'auto',
        compact_threshold: 15,
      };
      await this.setConfig('email', defaultEmail);
    }
  }

  // --- Config Table ---
  async getConfig<T = any>(key: string): Promise<T | null> {
    const row = await this.db.prepare('SELECT value FROM config WHERE key = ?').bind(key).first<{ value: string }>();
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  async setConfig(key: string, value: any): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.db
      .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
      .bind(key, serialized, serialized)
      .run();
  }

  // --- Keystore Management ---
  async getKeystore(): Promise<KeystoreSettings | null> {
    return this.getConfig<KeystoreSettings>('keystore');
  }

  async saveKeystore(keystore: KeystoreSettings): Promise<void> {
    await this.setConfig('keystore', keystore);
  }

  async resetKeystore(): Promise<void> {
    await this.setConfig('keystore', {
      has_custom: false,
      updated_at: new Date().toISOString(),
    });
  }

  // --- Packages ---
  async listPackages(): Promise<PackageRecord[]> {
    const { results } = await this.db.prepare('SELECT * FROM packages ORDER BY package ASC').all();
    return (results || []).map((row: any) => ({
      package: row.package,
      package_name: row.package_name,
      enabled: Boolean(row.enabled),
      repos: JSON.parse(row.repos || '[]'),
      patch_aliases: JSON.parse(row.patch_aliases || '[]'),
      options: JSON.parse(row.options || '{}'),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async getPackage(pkgName: string): Promise<PackageRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM packages WHERE package = ?')
      .bind(pkgName)
      .first<any>();
    if (!row) return null;
    return {
      package: row.package,
      package_name: row.package_name,
      enabled: Boolean(row.enabled),
      repos: JSON.parse(row.repos || '[]'),
      patch_aliases: JSON.parse(row.patch_aliases || '[]'),
      options: JSON.parse(row.options || '{}'),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async savePackage(data: Partial<PackageRecord> & { package: string }): Promise<PackageRecord> {
    const existing = await this.getPackage(data.package);
    const now = new Date().toISOString();

    const enabledInt = data.enabled !== undefined ? (data.enabled ? 1 : 0) : (existing?.enabled ? 1 : 1);
    const reposJson = JSON.stringify(data.repos || existing?.repos || []);
    const aliasesJson = JSON.stringify(data.patch_aliases || existing?.patch_aliases || []);
    const optionsJson = JSON.stringify(data.options || existing?.options || {});
    const pkgName = data.package_name || existing?.package_name || null;
    const createdAt = existing?.created_at || now;

    await this.db
      .prepare(`
        INSERT INTO packages (package, package_name, enabled, repos, patch_aliases, options, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(package) DO UPDATE SET
          package_name = excluded.package_name,
          enabled = excluded.enabled,
          repos = excluded.repos,
          patch_aliases = excluded.patch_aliases,
          options = excluded.options,
          updated_at = excluded.updated_at
      `)
      .bind(data.package, pkgName, enabledInt, reposJson, aliasesJson, optionsJson, createdAt, now)
      .run();

    return (await this.getPackage(data.package))!;
  }

  async togglePackageEnabled(pkgName: string, enabled: boolean): Promise<boolean> {
    const res = await this.db
      .prepare('UPDATE packages SET enabled = ?, updated_at = ? WHERE package = ?')
      .bind(enabled ? 1 : 0, new Date().toISOString(), pkgName)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async deletePackage(pkgName: string): Promise<boolean> {
    const res = await this.db.prepare('DELETE FROM packages WHERE package = ?').bind(pkgName).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  // --- Patch Repos ---
  async getPatchRepos(): Promise<string[]> {
    const reposList = (await this.getConfig<string[]>('patch_repos')) || [];
    const packages = await this.listPackages();
    const all = new Set(reposList);
    for (const p of packages) {
      for (const r of p.repos) {
        if (r && typeof r === 'string') all.add(r.trim());
      }
    }
    return Array.from(all);
  }

  async addPatchRepo(repoUrl: string): Promise<boolean> {
    const clean = repoUrl.trim();
    if (!clean) return false;
    const current = (await this.getConfig<string[]>('patch_repos')) || [];
    if (current.includes(clean)) return true;
    current.push(clean);
    await this.setConfig('patch_repos', current);
    return true;
  }

  async deletePatchRepo(repoUrl: string): Promise<boolean> {
    const clean = repoUrl.trim();
    const current = (await this.getConfig<string[]>('patch_repos')) || [];
    const filtered = current.filter((r) => r !== clean);
    await this.setConfig('patch_repos', filtered);
    return true;
  }

  // --- Patched Apps & Storage Stats ---
  async listPatchedApps(): Promise<PatchedAppRecord[]> {
    const { results } = await this.db.prepare('SELECT * FROM patched_apps ORDER BY package ASC, version DESC').all();
    return (results || []).map((row: any) => ({
      package: row.package,
      version: row.version,
      arch: row.arch,
      filename: row.filename,
      size_bytes: row.size_bytes,
      formatted_size: row.formatted_size,
      sha256: row.sha256,
      download_url: row.download_url,
      release_url: row.release_url,
      applied_patches: JSON.parse(row.applied_patches || '[]'),
      result_json: row.result_json,
      patched_at: row.patched_at,
    }));
  }

  async recordPatchedApp(app: PatchedAppRecord): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO patched_apps (
          package, version, arch, filename, size_bytes, formatted_size, sha256,
          download_url, release_url, applied_patches, result_json, patched_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(package, version) DO UPDATE SET
          arch = excluded.arch,
          filename = excluded.filename,
          size_bytes = excluded.size_bytes,
          formatted_size = excluded.formatted_size,
          sha256 = excluded.sha256,
          download_url = excluded.download_url,
          release_url = excluded.release_url,
          applied_patches = excluded.applied_patches,
          result_json = excluded.result_json,
          patched_at = excluded.patched_at
      `)
      .bind(
        app.package,
        app.version,
        app.arch,
        app.filename,
        app.size_bytes,
        app.formatted_size,
        app.sha256 || null,
        app.download_url,
        app.release_url || null,
        JSON.stringify(app.applied_patches || []),
        app.result_json || null,
        app.patched_at || new Date().toISOString()
      )
      .run();
  }

  async getStorageStats(): Promise<StorageStats> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS apk_count, COALESCE(SUM(size_bytes), 0) AS total_bytes FROM patched_apps')
      .first<{ apk_count: number; total_bytes: number }>();

    const apkCount = row?.apk_count || 0;
    const totalBytes = row?.total_bytes || 0;

    return {
      apk_count: apkCount,
      total_bytes: totalBytes,
      formatted_size: formatBytes(totalBytes),
    };
  }

  // --- Run History & Logs ---
  async getLastRunInfo(): Promise<RunHistoryRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM run_history ORDER BY finished_at DESC LIMIT 1')
      .first<any>();
    if (!row) return null;
    return {
      run_id: row.run_id,
      status: row.status as 'success' | 'failed',
      returncode: row.returncode,
      duration_seconds: row.duration_seconds,
      duration_formatted: row.duration_formatted,
      source: row.source,
      package: row.package,
      finished_at: row.finished_at,
    };
  }

  async recordRunHistory(run: RunHistoryRecord): Promise<void> {
    await this.db
      .prepare(`
        INSERT OR REPLACE INTO run_history (
          run_id, status, returncode, duration_seconds, duration_formatted, source, package, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        run.run_id,
        run.status,
        run.returncode,
        run.duration_seconds,
        run.duration_formatted,
        run.source,
        run.package || null,
        run.finished_at
      )
      .run();
  }

  async appendRunLogs(runId: string, logLines: string[]): Promise<void> {
    if (!logLines || logLines.length === 0) return;
    const now = Date.now() / 1000;
    const fullText = logLines.join('\n');
    await this.db
      .prepare('INSERT INTO run_logs (run_id, log_text, created_at) VALUES (?, ?, ?)')
      .bind(runId, fullText, now)
      .run();
  }

  async getRunLogs(runId?: string): Promise<{ logs: string[]; run_id: string | null }> {
    let targetRunId = runId;
    if (!targetRunId) {
      const activeLock = await this.getActiveLock();
      const now = Date.now() / 1000;
      if (activeLock && activeLock.run_id && (!activeLock.expires_at || activeLock.expires_at > now)) {
        targetRunId = activeLock.run_id;
      } else {
        const lastRun = await this.getLastRunInfo();
        targetRunId = lastRun?.run_id;
      }
    }
    if (!targetRunId) {
      return { logs: ['No build executions recorded yet.'], run_id: null };
    }

    const { results } = await this.db
      .prepare('SELECT log_text FROM run_logs WHERE run_id = ? ORDER BY created_at ASC')
      .bind(targetRunId)
      .all<{ log_text: string }>();

    const lines: string[] = [];
    for (const r of results || []) {
      lines.push(...r.log_text.split('\n'));
    }

    if (lines.length === 0) {
      const activeLock = await this.getActiveLock();
      if (activeLock && activeLock.run_id === targetRunId) {
        return {
          logs: [
            `[*] MorpheFlow build pipeline in progress for ${activeLock.package || 'all packages'}...`,
            '[*] Waiting for runner logs.',
          ],
          run_id: targetRunId,
        };
      }
    }

    return { logs: lines, run_id: targetRunId };
  }

  // --- State Lock (Parallel & Per-Package Aware) ---
  async getActiveLocks(): Promise<any[]> {
    const now = Date.now() / 1000;
    let locks: any[] = [];
    
    // Check parallel locks store
    const multiRow = await this.db.prepare("SELECT value FROM state WHERE key = 'active_locks'").first<{ value: string }>();
    if (multiRow?.value) {
      try {
        const parsed = JSON.parse(multiRow.value);
        if (Array.isArray(parsed)) {
          locks = parsed;
        }
      } catch {}
    }

    // Fallback/sync with legacy single active_lock if present
    if (locks.length === 0) {
      const singleRow = await this.db.prepare("SELECT value FROM state WHERE key = 'active_lock'").first<{ value: string }>();
      if (singleRow?.value) {
        try {
          const parsedSingle = JSON.parse(singleRow.value);
          if (parsedSingle && typeof parsedSingle === 'object') {
            locks = [parsedSingle];
          }
        } catch {}
      }
    }

    // Purge expired locks
    const validLocks = locks.filter((l) => !l.expires_at || l.expires_at > now);
    if (validLocks.length !== locks.length) {
      await this.saveActiveLocks(validLocks);
    }
    return validLocks;
  }

  async saveActiveLocks(locks: any[]): Promise<void> {
    const now = Date.now() / 1000;
    if (locks.length === 0) {
      await this.db.prepare("DELETE FROM state WHERE key IN ('active_locks', 'active_lock')").run();
      return;
    }
    const valMulti = JSON.stringify(locks);
    const valSingle = JSON.stringify(locks[locks.length - 1]);
    await this.db
      .prepare("INSERT INTO state (key, value, updated_at) VALUES ('active_locks', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?")
      .bind(valMulti, now, valMulti, now)
      .run();
    await this.db
      .prepare("INSERT INTO state (key, value, updated_at) VALUES ('active_lock', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?")
      .bind(valSingle, now, valSingle, now)
      .run();
  }

  async getActiveLock(pkg?: string | null): Promise<any | null> {
    const locks = await this.getActiveLocks();
    if (locks.length === 0) return null;
    if (pkg) {
      return (
        locks.find(
          (l) => l.package === pkg || !l.package || l.package === '__all__' || l.package === 'all'
        ) || null
      );
    }
    return locks[locks.length - 1] || null;
  }

  async acquireLock(data: any): Promise<boolean> {
    const locks = await this.getActiveLocks();
    const now = Date.now() / 1000;
    const timeout = data.timeout_seconds || 2700; // 45 min default
    const expires_at = now + timeout;

    const requestedPkg = data.package || null;
    const requestedPkgs: string[] = Array.isArray(data.packages)
      ? data.packages
      : requestedPkg
      ? [requestedPkg]
      : [];

    // Check if a global lock is already active
    const globalLockActive = locks.some((l) => !l.package || l.package === '__all__' || l.package === 'all');
    if (globalLockActive) {
      return false; // Global execution already in progress
    }

    if (requestedPkgs.length === 0) {
      // Requested a global run: only permitted if no other locks are active
      if (locks.length > 0) {
        return false;
      }
      const newLock = { ...data, package: null, acquired_at: now, expires_at };
      await this.saveActiveLocks([newLock]);
      return true;
    }

    // Specific packages requested: verify none of them are currently locked
    const conflicting = requestedPkgs.some((p) => locks.some((l) => l.package === p));
    if (conflicting) {
      return false;
    }

    // Add lock entries for all requested packages
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

  async releaseLock(pkgOrRunId?: string | null): Promise<void> {
    if (!pkgOrRunId) {
      await this.resetAllLocks();
      return;
    }
    const locks = await this.getActiveLocks();
    const remaining = locks.filter(
      (l) => l.package !== pkgOrRunId && l.run_id !== pkgOrRunId
    );
    await this.saveActiveLocks(remaining);
  }

  async resetAllLocks(): Promise<void> {
    await this.db.prepare("DELETE FROM state WHERE key IN ('active_locks', 'active_lock')").run();
  }

  // --- Session Lifecycle & Revocation (Security Audit) ---
  async getSessionRevocationTimestamp(): Promise<number> {
    const row = await this.db.prepare("SELECT value FROM state WHERE key = 'auth_revoked_before'").first<{ value: string }>();
    return row ? parseInt(row.value, 10) || 0 : 0;
  }

  async revokeAllSessions(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .prepare("INSERT INTO state (key, value, updated_at) VALUES ('auth_revoked_before', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?")
      .bind(String(now), now, String(now), now)
      .run();
    return now;
  }
}
