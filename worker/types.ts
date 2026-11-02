/**
 * TypeScript Interfaces for MorpheFlow Cloudflare Worker
 */

export interface Env {
  // Bindings
  DB: D1Database;
  STATE_KV?: KVNamespace;
  ASSETS: Fetcher;

  // Secrets & Environment Variables
  AUTH_PASSWORD?: string;
  AUTH_SECRET?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  WEBHOOK_SECRET?: string;
  MORPHEFLOW_RUNNER_URL?: string;
  AUTOMORPH_RUNNER_URL?: string;
  CLOUDFLARE_WORKER_URL?: string;
  SCHEDULE_TIME?: string;
  TZ?: string;
}

export interface PackageRecord {
  package: string;
  package_name?: string | null;
  enabled: boolean;
  repos: string[];
  patch_aliases: Array<{ alias: string; patches: Record<string, string> }>;
  options?: Record<string, any>;
  last_result?: any;
  created_at: string;
  updated_at: string;
}

export interface PatchedAppRecord {
  package: string;
  version: string;
  arch: string;
  filename: string;
  size_bytes: number;
  formatted_size: string;
  sha256?: string | null;
  download_url: string;
  release_url?: string | null;
  applied_patches: Array<{ name: string; repo: string }>;
  result_json?: string | null;
  patched_at: string;
}

export interface RunHistoryRecord {
  run_id: string;
  status: 'success' | 'failed';
  returncode: number;
  duration_seconds: number;
  duration_formatted: string;
  source: string;
  package?: string | null;
  finished_at: number;
}

export interface SystemSettings {
  architecture?: string;
  striplibs?: boolean;
  low_spec_mode?: boolean;
  schedule_time?: string;
  run_on_startup?: boolean;
  timezone?: string;
  max_logs?: number;
  max_original_packages?: number | null;
  max_patched_packages?: number | null;
  update_check_interval_hours?: number;
  status_poll_interval_seconds?: number;
}

export interface EmailSettings {
  enabled?: boolean;
  smtp_server?: string;
  smtp_port?: number;
  use_tls?: boolean;
  use_ssl?: boolean;
  sender_name?: string;
  sender_email?: string;
  recipients?: string[] | string;
  subject_prefix?: string;
  attach_result_json?: boolean;
  layout_mode?: string;
  compact_threshold?: number;
}

export interface StorageStats {
  apk_count: number;
  total_bytes: number;
  formatted_size: string;
}

export interface StatusResponse {
  is_running: boolean;
  active_locks?: Record<string, any>[];
  active_packages?: string[];
  active_lock: Record<string, any> | null;
  active_run: Record<string, any> | null;
  next_run: {
    schedule_time: string;
    next_run_iso: string;
    seconds_until: number;
    countdown_formatted: string;
    display_time: string;
  };
  last_run: RunHistoryRecord | null;
  storage: StorageStats;
  stats: {
    configured_apps: number;
    connected_repos: number;
  };
  version: {
    version: string;
    branch: string | null;
    run_number: number | null;
    commit: string | null;
  };
}
