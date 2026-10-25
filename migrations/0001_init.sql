-- AutoMorph Cloudflare D1 Initial Migration Schema
-- Modeled after NodeWarden for zero-credit-card serverless persistence.

PRAGMA foreign_keys = ON;

-- System and service configuration key-value store
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Configured application packages (mirroring config.yaml packages)
CREATE TABLE IF NOT EXISTS packages (
  package TEXT PRIMARY KEY,
  package_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  repos TEXT NOT NULL DEFAULT '[]',
  patch_aliases TEXT NOT NULL DEFAULT '[]',
  options TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Registry of successfully patched packages (mirroring state/patched.json)
CREATE TABLE IF NOT EXISTS patched_apps (
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
);

-- Execution history (mirroring state/logs/last_run.json)
CREATE TABLE IF NOT EXISTS run_history (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  returncode INTEGER NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0.0,
  duration_formatted TEXT NOT NULL DEFAULT '--',
  source TEXT NOT NULL DEFAULT 'manual',
  package TEXT,
  finished_at REAL NOT NULL
);

-- Real-time and historical run logs (mirroring state/logs/last_run.log)
CREATE TABLE IF NOT EXISTS run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  log_text TEXT NOT NULL,
  created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs (run_id);

-- System state and execution locks (mirroring mutex and active run tracking)
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at REAL NOT NULL
);

-- Custom app source definitions (mirroring tools/automorph-data/app_sources.yaml)
CREATE TABLE IF NOT EXISTS app_sources (
  package TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'github',
  repo TEXT,
  asset_pattern TEXT,
  version TEXT DEFAULT 'most_recent',
  arch TEXT,
  url TEXT
);
