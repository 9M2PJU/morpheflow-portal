/**
 * MorpheFlow Cloudflare Worker Main Entrypoint
 * Modeled after NodeWarden (https://github.com/shuaiplus/nodewarden)
 * Single-User Airtight Authentication Enabled.
 */

import { Env } from './types';
import { handleApiRequest } from './router';
import { StorageService } from './storage';
import { authenticateRequest, renderLoginScreen, applySecurityHeaders } from './auth';
import { APP_USER_AGENT } from './version';

const PUBLIC_STATIC_PATHS = new Set([
  '/favicon.svg',
  '/favicon.png',
  '/favicon.ico',
  '/logo.png',
  '/trim-logo.png',
  '/apk-icon.png',
  '/css/morphe.css',
]);

function isPublicStaticPath(pathname: string): boolean {
  return PUBLIC_STATIC_PATHS.has(pathname);
}

function isApiOrSpecialPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname === '/report' ||
    pathname === '/build_report.html' ||
    pathname === '/api' ||
    pathname.startsWith('/obtainium')
  );
}

function normalizeRequestUrl(request: Request): Request {
  const url = new URL(request.url);
  const normalizedPathname = url.pathname.length <= 1 ? url.pathname : url.pathname.replace(/\/+$/, '');
  if (normalizedPathname === url.pathname) return request;

  url.pathname = normalizedPathname;
  return new Request(url.toString(), request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const normalizedRequest = normalizeRequestUrl(request);
    const url = new URL(normalizedRequest.url);
    const pathname = url.pathname;

    const storage = new StorageService(env.DB);

    // 1. Allow public branding assets (logos, favicons) without authentication
    if (isPublicStaticPath(pathname) && env.ASSETS) {
      try {
        const publicAsset = await env.ASSETS.fetch(normalizedRequest);
        if (publicAsset.status !== 404) return applySecurityHeaders(publicAsset);
      } catch {}
    }

    // 2. Delegate all API requests and webhook callbacks to the router
    // (router strictly enforces authentication on all non-public endpoints)
    if (isApiOrSpecialPath(pathname)) {
      return handleApiRequest(normalizedRequest, env, ctx);
    }

    // 3. Authenticate user for Web Dashboard / Static Asset access
    const auth = await authenticateRequest(normalizedRequest, env, storage);
    if (!auth.authenticated) {
      const errorMsg = url.searchParams.get('error') || '';
      return renderLoginScreen(errorMsg);
    }

    // 4. Handle files route redirection into authenticated dashboard view
    if (pathname === '/files' || pathname.startsWith('/files/')) {
      const subpath = pathname.replace(/^\/files\/?/, '');
      const redirectUrl = subpath ? `${url.origin}/#/files/${subpath}` : `${url.origin}/#/files`;
      return Response.redirect(redirectUrl, 302);
    }

    // 5. Serve authenticated static dashboard assets via Cloudflare Workers Static Assets
    if (env.ASSETS) {
      try {
        const assetResponse = await env.ASSETS.fetch(normalizedRequest);
        if (assetResponse.status !== 404) {
          return applySecurityHeaders(assetResponse);
        }
      } catch (err) {
        console.warn('Asset fetch error, falling back to router:', err);
      }
    }

    // Fallback: If not matched, delegate to API handler
    return handleApiRequest(normalizedRequest, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[MorpheFlow Cron Trigger] Scheduled job fired at ${new Date(event.scheduledTime).toISOString()}`);

    const storage = new StorageService(env.DB);
    await storage.initializeDatabase();

    // 1. Hourly Community Store Ecosystem Sync
    let latestCatalogData: any = null;
    try {
      const resp = await fetch('https://morphe-patches.software/data/bundles.json', {
        headers: {
          'User-Agent': APP_USER_AGENT,
          'Accept': 'application/json',
        },
      });
      if (resp.ok) {
        const data = await resp.json<any>();
        latestCatalogData = data;
        const totalApps = Object.keys(data.store || {}).length;
        const totalBundles = Array.isArray(data.bundles) ? data.bundles.length : 0;
        await storage.setConfig('catalog_sync_state', {
          last_synced_at: Date.now(),
          total_apps: totalApps,
          total_bundles: totalBundles,
          interval: 'hourly',
          auto_sync: true,
        });
        console.log(`[MorpheFlow Cron] Hourly Community sync completed: ${totalApps} apps, ${totalBundles} bundles.`);
      }
    } catch (syncErr: any) {
      console.warn(`[MorpheFlow Cron] Community sync error: ${syncErr?.message}`);
    }

    // 2. Scheduled Build Dispatch (Hourly check for scheduled time OR unbuilt waiting apps OR available updates)
    const systemSettings = await storage.getConfig<any>('system');
    const scheduleStr = (systemSettings?.schedule_time || env.SCHEDULE_TIME || '03:00').trim();
    let targetHour = 3;
    try {
      const parts = scheduleStr.split(':');
      targetHour = parseInt(parts[0], 10);
      if (isNaN(targetHour)) targetHour = 3;
    } catch {
      targetHour = 3;
    }

    const now = new Date(event.scheduledTime || Date.now());
    const isScheduledHour = now.getUTCHours() === targetHour || event.cron === '0 3 * * *';

    // Check for any unbuilt waiting applications from packages table
    const packages = await storage.listPackages();
    const configuredPkgs: string[] = packages
      .filter((p) => p.enabled !== false)
      .map((p) => p.package || p.package_name)
      .filter((pkg): pkg is string => typeof pkg === 'string' && pkg.length > 0);
    const patchedApps = await storage.listPatchedApps();
    const patchedPkgMap = new Map(patchedApps.map((a: any) => [a.package, a.version]));
    const waitingPkgs = configuredPkgs.filter((pkgId: string) => !patchedPkgMap.has(pkgId));
    const hasWaitingApps = waitingPkgs.length > 0;

    // Check for configured apps with upstream target version updates available
    const updatingPkgs: string[] = [];
    if (latestCatalogData && latestCatalogData.store) {
      for (const pkgId of configuredPkgs) {
        const curVer = patchedPkgMap.get(pkgId);
        const storeItem = latestCatalogData.store[pkgId];
        const recVer = storeItem?.recommended_version || storeItem?.target_version;
        if (curVer && recVer) {
          const cleanCur = String(curVer).replace(/^v/, '');
          const cleanRec = String(recVer).replace(/^v/, '');
          if (cleanCur !== cleanRec) {
            updatingPkgs.push(pkgId);
          }
        }
      }
    }
    const hasUpdates = updatingPkgs.length > 0;

    const shouldRunBuild = isScheduledHour || hasWaitingApps || hasUpdates;

    if (shouldRunBuild) {
      const runId = `cron-${Date.now()}`;
      const neededPkgs = Array.from(new Set([...waitingPkgs, ...updatingPkgs]));
      const targetPackage = isScheduledHour ? '' : neededPkgs.join(',');
      const acquired = await storage.acquireLock({
        run_id: runId,
        source: 'scheduler',
        package: targetPackage || null,
        started_at: Date.now() / 1000,
      });

      if (!acquired) {
        console.log('[MorpheFlow Cron Trigger] Run skipped: An active execution lock is already held.');
        return;
      }

      let triggerReason = `daily scheduled target time (${scheduleStr} UTC)`;
      if (hasWaitingApps && hasUpdates) {
        triggerReason = `unbuilt apps (${waitingPkgs.join(', ')}) & pending updates (${updatingPkgs.join(', ')})`;
      } else if (hasWaitingApps) {
        triggerReason = `unbuilt waiting apps (${waitingPkgs.join(', ')})`;
      } else if (hasUpdates) {
        triggerReason = `upstream app updates available (${updatingPkgs.join(', ')})`;
      }

      await storage.appendRunLogs(runId, [
        `[*] MorpheFlow automated build triggered via Cloudflare Cron Trigger for ${triggerReason} at ${new Date().toISOString()}`,
      ]);

      // Dispatch to GitHub Actions if configured
      if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
        try {
          const ghUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/morpheflow-cloud-builder.yaml/dispatches`;
          const workerUrl = env.CLOUDFLARE_WORKER_URL || 'https://morpheflow.w161112218.workers.dev';
          const res = await fetch(ghUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.GITHUB_TOKEN}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'MorpheFlow-CloudflareWorker',
            },
            body: JSON.stringify({
              ref: 'main',
              inputs: {
                target_package: targetPackage,
                runner_callback_url: workerUrl,
              },
            }),
          });

          if (res.ok || res.status === 204) {
            await storage.appendRunLogs(runId, ['[✓] Dispatched build runner to GitHub Actions.']);
          } else {
            await storage.appendRunLogs(runId, [`[!] GitHub Actions dispatch failed with code ${res.status}`]);
          }
        } catch (err: any) {
          await storage.appendRunLogs(runId, [`[✗] Error dispatching scheduled run: ${err.message}`]);
        }
      } else {
        await storage.appendRunLogs(runId, ['[!] GitHub Actions secrets not fully configured in Worker environment.']);
      }
    }
  },
};
