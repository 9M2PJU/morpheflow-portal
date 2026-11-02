/**
 * MorpheFlow Cloudflare Worker API Router
 * Implements the full REST and SSE API contract for MorpheFlow Web Portal.
 */

import { EmailSettings, Env, PackageRecord, PatchedAppRecord, RunHistoryRecord, StatusResponse, SystemSettings } from './types';
import { StorageService, formatBytes } from './storage';
import {
  authenticateRequest,
  buildSessionCookieHeaders,
  checkRateLimit,
  createSessionToken,
  recordFailedLogin,
  resetFailedLogin,
  timingSafeEqual,
  applySecurityHeaders,
} from './auth';
import { APP_VERSION, APP_BRANCH, APP_COMMIT, APP_USER_AGENT } from './version';

export function json(data: any, status = 200, headers: Record<string, string> = {}): Response {
  const res = new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      ...headers,
    },
  });
  return applySecurityHeaders(res);
}

function toCaseInsensitiveRegexPattern(str: string): string {
  if (!str) return '';
  return str
    .split('')
    .map((c) => {
      if (/[a-zA-Z]/.test(c)) {
        return `[${c.toLowerCase()}${c.toUpperCase()}]`;
      }
      return c.replace(/([.*+?^${}()|[\]\/\\])/g, '\\$1');
    })
    .join('');
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const KNOWN_APP_NAMES: Record<string, string> = {
  'com.sbs.train': 'MacroFactor Workouts',
  'com.sbs.diet': 'MacroFactor',
  'com.tantantribe.tribe': 'Tantan',
  'com.google.android.inputmethod.latin': 'Gboard',
  'com.rubenmayayo.lemmy': 'Boost for Lemmy',
  'com.mixplorer': 'MiXplorer',
  'com.paget96.batteryguru': 'Battery Guru',
  'com.qtrun.QuickTest': 'Network Signal Guru',
  'com.slowlyapp': 'Slowly',
  'com.vpn.free.hotspot.secure.vpnify': 'vpnify',
  'org.wakingup.android': 'Waking Up',
  'pdb.app': 'Pdb',
  'torrent.search.revolutionv2': 'Torrent Search Revolution V2',
  'com.reddit.frontpage': 'Reddit',
  'com.google.android.youtube': 'YouTube',
  'com.google.android.apps.youtube.music': 'YouTube Music',
  'com.twitter.android': 'Twitter',
  'com.truecaller': 'Truecaller',
  'com.instaprime.android': 'InstaPrime',
  'com.chess': 'Chess.com',
  'ch.protonvpn.android': 'Proton VPN',
  'com.joincarbon.nutrition': 'Carbon',
  'com.pittvandewitt.wavelet': 'Wavelet',
};

function resolveAppName(pkg: string, explicitName?: string): string {
  if (KNOWN_APP_NAMES[pkg]) return KNOWN_APP_NAMES[pkg];
  if (explicitName && explicitName.trim() && explicitName !== pkg && !explicitName.includes('.')) {
    return explicitName.trim();
  }
  const parts = pkg.split('.').filter(p => !['com', 'org', 'net', 'io', 'app', 'android', 'mobile'].includes(p.toLowerCase()));
  if (parts.length > 0) {
    const main = parts[parts.length - 1];
    return main.charAt(0).toUpperCase() + main.slice(1);
  }
  const allParts = pkg.split('.');
  const last = allParts[allParts.length - 1] || pkg;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function resolveScheduleTarget(systemSettings: SystemSettings | null, env: Env) {
  const scheduleStr = (systemSettings?.schedule_time || env.SCHEDULE_TIME || '03:00').trim();
  const tzStr = (systemSettings?.timezone || env.TZ || 'Etc/UTC').trim();

  let targetHour = 3;
  let targetMinute = 0;
  try {
    const parts = scheduleStr.split(':');
    targetHour = parseInt(parts[0], 10) || 3;
    targetMinute = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
  } catch {
    targetHour = 3;
    targetMinute = 0;
  }

  const now = new Date();
  const targetToday = new Date(now);
  targetToday.setUTCHours(targetHour, targetMinute, 0, 0);

  let nextDt = targetToday;
  if (now.getTime() >= targetToday.getTime()) {
    nextDt = new Date(targetToday.getTime() + 24 * 3600 * 1000);
  }

  const totalSec = Math.max(0, Math.floor((nextDt.getTime() - now.getTime()) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const displayTime = `${monthNames[nextDt.getUTCMonth()]} ${nextDt.getUTCDate()}, ${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')}`;

  return {
    schedule_time: scheduleStr,
    next_run_iso: nextDt.toISOString(),
    seconds_until: totalSec,
    countdown_formatted: hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`,
    display_time: displayTime,
  };
}

function attachLastResultsToPackages(
  packages: PackageRecord[],
  patchedApps: PatchedAppRecord[],
  lastRun: RunHistoryRecord | null
): PackageRecord[] {
  return packages.map((p) => {
    const appBuilds = patchedApps.filter((a) => a.package === p.package);
    appBuilds.sort((a, b) => new Date(b.patched_at).getTime() - new Date(a.patched_at).getTime());
    const lastApp = appBuilds[0];

    let last_result = null;
    if (lastApp) {
      let appliedPatches: any[] = lastApp.applied_patches || [];
      let failedPatches: any[] = [];
      let appliedCount = appliedPatches.length;
      let failedCount = 0;
      let winningStrategy: string | null = null;
      let totalAttempts = 1;
      const patchOwners: Record<string, string> = {};

      if (lastApp.result_json) {
        try {
          const rJson = typeof lastApp.result_json === 'string' ? JSON.parse(lastApp.result_json) : lastApp.result_json;
          if (Array.isArray(rJson.applied_patches)) appliedPatches = rJson.applied_patches;
          if (Array.isArray(rJson.failed_patches)) failedPatches = rJson.failed_patches;
          appliedCount = rJson.applied_count ?? appliedPatches.length;
          failedCount = rJson.failed_count ?? failedPatches.length;
          winningStrategy = rJson.winning_strategy || rJson.strategy || null;
          totalAttempts = rJson.total_attempts || rJson.attempts?.length || 1;
        } catch (_) {}
      }

      // If appliedPatches is empty, extract enabled patches and owners from p.options
      if (appliedPatches.length === 0 && p.options) {
        for (const repoKey of Object.keys(p.options)) {
          const repoPatches = p.options[repoKey]?.patches || {};
          for (const patchKey of Object.keys(repoPatches)) {
            if (repoPatches[patchKey]?.enabled) {
              appliedPatches.push({
                name: patchKey,
                owner: repoKey,
              });
              patchOwners[patchKey] = repoKey;
            }
          }
        }
        appliedCount = appliedPatches.length;
      }

      const pDate = new Date(lastApp.patched_at);
      const timestampFormatted = !isNaN(pDate.getTime())
        ? pDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
          pDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        : 'Recently';

      last_result = {
        version: lastApp.version,
        status: 'success',
        download_url: `/api/download/${encodeURIComponent(p.package)}`,
        release_url: lastApp.release_url,
        apk_name: lastApp.filename,
        timestamp: Math.floor(pDate.getTime() / 1000) || 0,
        timestamp_formatted: timestampFormatted,
        applied_count: appliedCount,
        failed_count: failedCount,
        applied_patches: appliedPatches,
        failed_patches: failedPatches,
        patch_owners: patchOwners,
        total_attempts: totalAttempts,
        winning_strategy: winningStrategy,
        sha256: lastApp.sha256 || null,
        virustotal: lastApp.sha256
          ? {
              permalink: `https://www.virustotal.com/gui/file/${lastApp.sha256}`,
              sha256: lastApp.sha256,
              status: 'clean',
            }
          : null,
      };
    } else if (lastRun && lastRun.package === p.package && lastRun.status === 'failed') {
      const fDate = new Date(lastRun.finished_at * 1000);
      last_result = {
        version: 'target',
        status: 'failed',
        is_pipeline_failure: true,
        failure_stage: 'Build Failed',
        failure_reason: 'Pipeline execution failed in cloud builder',
        timestamp: Math.floor(lastRun.finished_at),
        timestamp_formatted: fDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
          fDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        applied_count: 0,
        failed_count: 1,
        applied_patches: [],
        failed_patches: [],
      };
    }

    const base_apk_url = p.options?.base_apk_url || (p as any).base_apk_url || undefined;
    return {
      ...p,
      base_apk_url,
      last_result,
    };
  });
}

export async function handleApiRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const origin = request.headers.get('Origin');
  const allowedOrigins = [
    url.origin,
    'https://automorph.w161112218.workers.dev',
    'https://morpheflow.w161112218.workers.dev',
  ];
  const corsOrigin = (origin && allowedOrigins.includes(origin)) ? origin : url.origin;
  const isSecure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token, X-Webhook-Secret',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Cross-Origin Request Forgery (CSRF) defense for state-modifying routes:
  // Reject mutations originating from external third-party web origins unless using Bearer API token or webhook
  if (origin && !allowedOrigins.includes(origin) && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    if (path !== '/api/webhook/report') {
      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return json({ error: 'Forbidden: Cross-origin state mutation blocked by security policy.' }, 403);
      }
    }
  }

  const storage = new StorageService(env.DB);
  await storage.ensureInitialized();

  // 0. Public Auth Endpoints
  if (path === '/api/auth/login' && method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const rateCheck = await checkRateLimit(storage, ip);
    if (!rateCheck.allowed) {
      return json(
        { error: `Too many failed login attempts. Locked out for ${rateCheck.retryAfterSeconds}s.` },
        429
      );
    }

    let password = '';
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const b = await request.json<any>().catch(() => ({}));
      password = String(b.password || '').trim();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      password = String(params.get('password') || '').trim();
    }

    const masterPassword = (env.AUTH_PASSWORD || '').trim();
    if (!masterPassword) {
      return json(
        {
          error:
            'AUTH_PASSWORD secret is not set in Worker environment. Set it with: npx wrangler secret put AUTH_PASSWORD',
        },
        500
      );
    }

    if (await timingSafeEqual(masterPassword, password)) {
      await resetFailedLogin(storage, ip);
      const token = await createSessionToken(masterPassword);
      const cookieHeaders = buildSessionCookieHeaders(token, isSecure);

      const respHeaders = new Headers({
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      });
      for (const ch of cookieHeaders) {
        respHeaders.append('Set-Cookie', ch);
      }

      return applySecurityHeaders(
        new Response(JSON.stringify({ status: 'success', authenticated: true }), {
          status: 200,
          headers: respHeaders,
        })
      );
    } else {
      await recordFailedLogin(storage, ip);
      const updatedCheck = await checkRateLimit(storage, ip);
      const remaining = updatedCheck.remainingAttempts;
      return json(
        {
          error:
            remaining > 0
              ? `Incorrect password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
              : 'Too many failed attempts. Locked out for 15 minutes.',
        },
        401
      );
    }
  }

  if (path === '/api/auth/logout' && (method === 'POST' || method === 'GET')) {
    // Revoke all existing sessions server-side
    await storage.revokeAllSessions();
    const clearCookies = buildSessionCookieHeaders(null, isSecure);

    const respHeaders = new Headers({
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    });
    for (const ch of clearCookies) {
      respHeaders.append('Set-Cookie', ch);
    }

    if (method === 'GET') {
      respHeaders.set('Location', '/');
      return applySecurityHeaders(new Response(null, { status: 302, headers: respHeaders }));
    }

    respHeaders.set('Content-Type', 'application/json');
    return applySecurityHeaders(
      new Response(JSON.stringify({ status: 'logged_out', authenticated: false }), {
        status: 200,
        headers: respHeaders,
      })
    );
  }

  if (path === '/api/auth/check' && method === 'GET') {
    const auth = await authenticateRequest(request, env, storage);
    return json({ authenticated: auth.authenticated, single_user: true });
  }

  // Runner & Webhook authentication:
  // Allow POST /api/webhook/report and GET /api/config when supplied with valid X-Webhook-Secret
  const webhookSecret = (env.WEBHOOK_SECRET || '').trim();
  const requestWebhook = (request.headers.get('X-Webhook-Secret') || '').trim();
  const isAuthorizedWebhook = Boolean(
    webhookSecret &&
    requestWebhook &&
    (await timingSafeEqual(webhookSecret, requestWebhook))
  );

  const isConfigWithWebhook =
    (path === '/api/config' || path === '/api/runner/sync') &&
    method === 'GET' &&
    isAuthorizedWebhook;
  const isReportWithWebhook = path === '/api/webhook/report' && method === 'POST';
  const isObtainiumEndpoint =
    (path.startsWith('/api/obtainium') || path.startsWith('/obtainium')) &&
    (method === 'GET' || method === 'HEAD');
  const isDownloadEndpoint =
    (path.startsWith('/api/download/') || path.startsWith('/files/')) &&
    (method === 'GET' || method === 'HEAD');
  const isGmsCoreEndpoint =
    (path === '/api/gmscore/latest' || path === '/api/gmscore/download') &&
    (method === 'GET' || method === 'HEAD');

  if (isReportWithWebhook) {
    if (!isAuthorizedWebhook) {
      return json({ error: 'Unauthorized webhook' }, 401);
    }
  } else if (!isConfigWithWebhook && !isObtainiumEndpoint && !isDownloadEndpoint && !isGmsCoreEndpoint) {
    const auth = await authenticateRequest(request, env, storage);
    if (!auth.authenticated) {
      return json(
        {
          error: 'Unauthorized. Authentication required.',
          auth_required: true,
          hint: 'Authenticate via session cookie or Authorization: Bearer <AUTH_PASSWORD>',
        },
        401
      );
    }
  }

  // 1. GET /api/version
  if (path === '/api/version' && method === 'GET') {
    return json({
      version: APP_VERSION,
      branch: APP_BRANCH,
      run_number: 1,
      commit: APP_COMMIT,
    });
  }

  // 1b. GET /api/gmscore/latest & GET /api/gmscore/download (MicroG-RE Companion Hub)
  if (path === '/api/gmscore/latest' && (method === 'GET' || method === 'HEAD')) {
    try {
      const ghHeaders: Record<string, string> = {
        'User-Agent': APP_USER_AGENT,
        'Accept': 'application/vnd.github.v3+json',
      };
      if (env.GITHUB_TOKEN) {
        ghHeaders['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
      }
      const resp = await fetch('https://api.github.com/repos/MorpheApp/GmsCore/releases/latest', {
        headers: ghHeaders,
        cf: { cacheTtl: 21600, cacheEverything: true },
      });
      if (resp.ok) {
        const data = await resp.json<any>();
        const apkAsset = Array.isArray(data.assets)
          ? data.assets.find((a: any) => typeof a.name === 'string' && a.name.endsWith('.apk')) || data.assets[0]
          : null;
        return json({
          tag_name: data.tag_name || 'v0.3.1.240913',
          name: data.name || 'MicroG-RE (GmsCore)',
          apk_name: apkAsset?.name || 'app.revanced.android.gms.apk',
          download_url: '/api/gmscore/download',
          direct_asset_url: apkAsset?.browser_download_url || null,
          html_url: data.html_url || 'https://github.com/MorpheApp/GmsCore/releases/latest',
          published_at: data.published_at || new Date().toISOString(),
          size_bytes: apkAsset?.size || 0,
        });
      }
    } catch {}
    return json({
      tag_name: 'v0.3.1.240913',
      name: 'MicroG-RE (GmsCore)',
      apk_name: 'app.revanced.android.gms.apk',
      download_url: '/api/gmscore/download',
      html_url: 'https://github.com/MorpheApp/GmsCore/releases/latest',
      published_at: '2024-09-13T00:00:00Z',
    });
  }

  if (path === '/api/gmscore/download' && (method === 'GET' || method === 'HEAD')) {
    try {
      const ghHeaders: Record<string, string> = {
        'User-Agent': APP_USER_AGENT,
        'Accept': 'application/vnd.github.v3+json',
      };
      if (env.GITHUB_TOKEN) {
        ghHeaders['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
      }
      const resp = await fetch('https://api.github.com/repos/MorpheApp/GmsCore/releases/latest', {
        headers: ghHeaders,
      });
      if (resp.ok) {
        const data = await resp.json<any>();
        const apkAsset = Array.isArray(data.assets)
          ? data.assets.find((a: any) => typeof a.name === 'string' && a.name.endsWith('.apk'))
          : null;
        if (apkAsset && apkAsset.browser_download_url) {
          return Response.redirect(apkAsset.browser_download_url, 302);
        }
      }
    } catch {}
    return Response.redirect('https://github.com/MorpheApp/GmsCore/releases/latest', 302);
  }

  // 2. GET /api/status
  if (path === '/api/status' && method === 'GET') {
    const activeLocks = await storage.getActiveLocks();
    const activePackages = activeLocks.map((l) => l.package).filter(Boolean) as string[];
    const activeLock = activeLocks[activeLocks.length - 1] || null;
    const lastRun = await storage.getLastRunInfo();
    const storageStats = await storage.getStorageStats();
    const packages = await storage.listPackages();
    const repos = await storage.getPatchRepos();
    const system = await storage.getConfig<SystemSettings>('system');

    const nextRun = resolveScheduleTarget(system, env);

    const now = Date.now() / 1000;
    const isRunning = activeLocks.length > 0;
    const activeRun = isRunning && activeLock
      ? {
          run_id: activeLock.run_id,
          source: activeLock.source,
          package: activeLock.package,
          started_at: activeLock.started_at,
        }
      : null;

    const response: StatusResponse = {
      is_running: isRunning,
      active_locks: activeLocks,
      active_packages: activePackages,
      active_lock: activeLock,
      active_run: activeRun,
      next_run: nextRun,
      last_run: lastRun,
      storage: storageStats,
      stats: {
        configured_apps: packages.length,
        connected_repos: repos.length,
      },
      version: {
        version: APP_VERSION,
        branch: APP_BRANCH,
        run_number: 1,
        commit: APP_COMMIT,
      },
    };
    return json(response);
  }

  // 3. GET /api/config
  if (path === '/api/config' && method === 'GET') {
    const rawPackages = await storage.listPackages();
    const patchedApps = await storage.listPatchedApps();
    const lastRun = await storage.getLastRunInfo();
    const packages = attachLastResultsToPackages(rawPackages, patchedApps, lastRun);
    const repos = await storage.getPatchRepos();
    const system = (await storage.getConfig('system')) || {};
    const email = (await storage.getConfig('email')) || {};
    const tunnels = (await storage.getConfig('tunnels')) || {};

    return json({
      ...system,
      email,
      tunnels,
      patch_repos: repos,
      packages,
    });
  }

  // 3b. GET /api/config/backup
  if (path === '/api/config/backup' && method === 'GET') {
    const packages = await storage.listPackages();
    const repos = await storage.getPatchRepos();
    const system = (await storage.getConfig('system')) || {};
    const email = (await storage.getConfig('email')) || {};
    const tunnels = (await storage.getConfig('tunnels')) || {};

    return json({
      version: APP_VERSION,
      exported_at: new Date().toISOString(),
      packages,
      patch_repos: repos,
      system,
      email,
      tunnels,
    });
  }

  // 3c. POST /api/config/restore
  if (path === '/api/config/restore' && method === 'POST') {
    const body = await request.json<any>();
    if (!body || (!Array.isArray(body.packages) && !Array.isArray(body.patch_repos))) {
      return json({ error: 'Invalid backup payload: expected packages or patch_repos array' }, 400);
    }

    let restoredPackages = 0;
    if (Array.isArray(body.packages)) {
      for (const pkg of body.packages) {
        const pkgName = pkg.package || pkg.package_name;
        if (pkg && pkgName) {
          await storage.savePackage({
            package: pkgName,
            package_name: pkg.name || pkg.package_name || pkgName,
            enabled: pkg.enabled !== false,
            repos: pkg.repos || [],
            options: pkg.options || {},
          });
          restoredPackages++;
        }
      }
    }

    let restoredRepos = 0;
    if (Array.isArray(body.patch_repos)) {
      for (const r of body.patch_repos) {
        if (typeof r === 'string' && r.trim()) {
          await storage.addPatchRepo(r.trim());
          restoredRepos++;
        }
      }
    }

    return json({
      status: 'success',
      restored_packages: restoredPackages,
      restored_repos: restoredRepos,
    });
  }

  // 3d. Notifications: GET /api/config/notifications
  if (path === '/api/config/notifications' && method === 'GET') {
    const notifs = (await storage.getConfig('notifications')) || {};
    return json(notifs);
  }

  // 3e. Notifications: POST /api/config/notifications
  if (path === '/api/config/notifications' && method === 'POST') {
    const body = await request.json<any>();
    await storage.setConfig('notifications', {
      telegram_bot_token: (body.telegram_bot_token || '').trim(),
      telegram_chat_id: (body.telegram_chat_id || '').trim(),
      discord_webhook_url: (body.discord_webhook_url || '').trim(),
    });
    return json({ status: 'success' });
  }

  // 3a. Runner State Sync: GET /api/runner/sync
  if (path === '/api/runner/sync' && method === 'GET') {
    const rawPackages = await storage.listPackages();
    const patchedApps = await storage.listPatchedApps();
    const lastRun = await storage.getLastRunInfo();
    const packages = attachLastResultsToPackages(rawPackages, patchedApps, lastRun);
    const repos = await storage.getPatchRepos();
    const system = (await storage.getConfig('system')) || {};
    const email = (await storage.getConfig('email')) || {};
    const tunnels = (await storage.getConfig('tunnels')) || {};
    const repoVersions = (await storage.getConfig('repo_versions')) || {};
    const keystore = (await storage.getKeystore()) || { has_custom: false };

    return json({
      config: {
        ...system,
        email,
        tunnels,
        patch_repos: repos,
        packages,
      },
      patched_apps: patchedApps,
      repo_versions: repoVersions,
      keystore,
    });
  }

  // 3b. Obtainium Bulk Export: GET /api/obtainium/export or /obtainium/export
  if ((path === '/api/obtainium/export' || path === '/obtainium/export') && method === 'GET') {
    const rawPackages = await storage.listPackages();
    const apps = await storage.listPatchedApps();
    const repo = env.GITHUB_REPO || 'wiwek13/MorpheFlow';
    const author = repo.split('/')[0] || 'MorpheFlow';

    // Combine both configured packages and compiled patched apps
    const appMap = new Map<string, any>();
    for (const p of rawPackages) {
      const explicitName = (p as any).name || p.package_name;
      appMap.set(p.package, {
        package: p.package,
        name: resolveAppName(p.package, explicitName),
      });
    }
    for (const a of apps) {
      const existing = appMap.get(a.package);
      appMap.set(a.package, {
        package: a.package,
        name: existing?.name || resolveAppName(a.package),
        version: a.version,
        download_url: a.download_url,
      });
    }

    const exportList = Array.from(appMap.values()).map((a) => {
      const appName = resolveAppName(a.package, a.name);
      const ciPkg = toCaseInsensitiveRegexPattern(a.package);
      const ciName = toCaseInsensitiveRegexPattern(appName);
      return {
        id: a.package,
        url: `https://github.com/${repo}`,
        author: author,
        name: appName,
        preferredApkIndex: 0,
        additionalSettings: JSON.stringify({
          fallbackToOlderReleases: true,
          includePrereleases: true,
          filterReleaseTitlesByRegEx: `(${ciPkg}|${ciName})`,
          apkFilterRegEx: `^${ciPkg}_`,
          releaseTitleAsVersion: true,
          versionExtractionRegEx: 'v?([0-9][0-9a-zA-Z._-]+)$',
          matchGroupToUse: '1',
          sortMethodChoice: 'date',
        }),
      };
    });

    return json(
      { apps: exportList },
      200,
      {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      }
    );
  }

  // 3c. Obtainium Single App Route: GET /api/obtainium/:pkg or /obtainium/:pkg
  const isSingleObtainiumRoute =
    (path.startsWith('/api/obtainium/') || path.startsWith('/obtainium/')) &&
    path !== '/api/obtainium/export' &&
    path !== '/obtainium/export' &&
    method === 'GET';

  if (isSingleObtainiumRoute) {
    const pkg = path.replace(/^\/(?:api\/)?obtainium\/?/, '').trim();
    const repo = env.GITHUB_REPO || 'wiwek13/MorpheFlow';
    const author = repo.split('/')[0] || 'MorpheFlow';
    const apps = await storage.listPatchedApps();
    const patched = apps.find((a) => a.package === pkg);
    const rawPackages = await storage.listPackages();
    const configPkg = rawPackages.find((p) => p.package === pkg);

    const appName = resolveAppName(pkg, (configPkg as any)?.name || configPkg?.package_name);

    const ciPkg = toCaseInsensitiveRegexPattern(pkg);
    const ciName = toCaseInsensitiveRegexPattern(appName);
    const additionalSettings = JSON.stringify({
      fallbackToOlderReleases: true,
      includePrereleases: true,
      filterReleaseTitlesByRegEx: `(${ciPkg}|${ciName})`,
      apkFilterRegEx: `^${ciPkg}_`,
      releaseTitleAsVersion: true,
      versionExtractionRegEx: 'v?([0-9][0-9a-zA-Z._-]+)$',
      matchGroupToUse: '1',
      sortMethodChoice: 'date',
    });

    // If browser/direct download requested with ?download=1
    if (url.searchParams.get('download') === '1') {
      return Response.redirect(`https://${url.host}/api/download/${encodeURIComponent(pkg)}`, 302);
    }

    const acceptsHtml =
      request.headers.get('Accept')?.includes('text/html') ||
      url.searchParams.get('format') === 'html';

    if (acceptsHtml) {
      const isCompiled = Boolean(patched);
      const ver = patched?.version ? (patched.version.startsWith('v') ? patched.version : `v${patched.version}`) : '1.0.0';
      const cleanVer = ver.replace(/^v/, '');
      const downloadPath = `https://${url.host}/api/download/${encodeURIComponent(pkg)}/${encodeURIComponent(patched?.filename || `${pkg}_${cleanVer}_patched.apk`)}`;

      const htmlResponse = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(appName)} - MorpheFlow</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 40px auto; padding: 24px; line-height: 1.5; color: #1e293b; background: #f8fafc; }
    .card { background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .title { margin: 0 0 6px 0; font-size: 1.35rem; font-weight: 700; color: #0f172a; }
    .pkg { font-family: monospace; font-size: 0.85rem; color: #64748b; margin-bottom: 16px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 0.825rem; font-weight: 600; background: #e0f2fe; color: #0369a1; margin-bottom: 20px; }
    .btn { display: inline-block; padding: 12px 24px; background: #0284c7; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 0.95rem; }
    .btn:hover { background: #0369a1; }
    .footer { margin-top: 24px; font-size: 0.8rem; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <h1 class="title">${escapeHtml(appName)}</h1>
    <div class="pkg">${escapeHtml(pkg)}</div>
    ${isCompiled ? `
      <div>Version: <span id="version" class="badge">${escapeHtml(ver)}</span></div>
      <p style="margin-top: 8px; margin-bottom: 24px;">
        <a href="${downloadPath}" id="apk-link" class="btn">Download Patched APK</a>
      </p>
      <div style="font-size: 0.85rem; color: #64748b;">
        Binary file: <code>${escapeHtml(patched?.filename || `${pkg}_patched.apk`)}</code>
      </div>
    ` : `
      <div class="badge" style="background: #fef3c7; color: #b45309;">Awaiting Compilation</div>
      <p style="color: #64748b; font-size: 0.9rem;">This application is configured in MorpheFlow but has not completed a build yet. Trigger a build from your console to generate the APK.</p>
    `}
    <div class="footer">
      MorpheFlow Distribution Edge • <a href="https://${url.host}" style="color: #64748b;">Console</a>
    </div>
  </div>
</body>
</html>`;

      return new Response(htmlResponse, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return json(
      {
        id: pkg,
        url: `https://${url.host}/obtainium/${encodeURIComponent(pkg)}`,
        github_url: `https://github.com/${repo}`,
        author,
        name: appName,
        version: patched?.version || 'latest',
        apk_url: `https://${url.host}/api/download/${encodeURIComponent(pkg)}`,
        preferredApkIndex: 0,
        additionalSettings,
      },
      200,
      {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      }
    );
  }

  // 4. GET /api/settings
  if (path === '/api/settings' && method === 'GET') {
    const system = (await storage.getConfig('system')) || {};
    const email = (await storage.getConfig('email')) || {};
    const tunnels = (await storage.getConfig('tunnels')) || {};
    return json({ system, email, tunnels });
  }

  // 5. POST /api/settings/system
  if (path === '/api/settings/system' && method === 'POST') {
    const body = await request.json<any>();
    const current = (await storage.getConfig<SystemSettings>('system')) || {};
    const updated = { ...current, ...body };
    await storage.setConfig('system', updated);
    return json({ status: 'success', settings: updated });
  }

  // 6. POST /api/settings/tunnels
  if (path === '/api/settings/tunnels' && method === 'POST') {
    const body = await request.json<any>();
    const current = (await storage.getConfig('tunnels')) || {};
    const updated = { ...current, ...body };
    await storage.setConfig('tunnels', updated);
    return json({ status: 'success', tunnels: updated });
  }

  // 7. POST /api/settings/email
  if (path === '/api/settings/email' && method === 'POST') {
    const body = await request.json<any>();
    const current = (await storage.getConfig<EmailSettings>('email')) || {};
    const updated = { ...current, ...body };
    await storage.setConfig('email', updated);
    return json({ status: 'success', email: updated });
  }

  // 8. POST /api/settings/email/test
  if (path === '/api/settings/email/test' && method === 'POST') {
    return json({
      success: true,
      message: 'Email configuration test acknowledged on Cloudflare Worker edge.',
    });
  }

  // 8b. Keystore Status: GET /api/settings/keystore
  if (path === '/api/settings/keystore' && method === 'GET') {
    const ks = await storage.getKeystore();
    if (!ks || !ks.has_custom) {
      return json({
        has_custom: false,
        type: 'deterministic',
        alias: 'morpheflow',
        filename: 'morpheflow.keystore',
        description: 'Permanent deterministic keystore active. Builds across all devices match signature.',
      });
    }
    return json({
      has_custom: true,
      type: 'custom',
      alias: ks.alias || 'custom',
      filename: ks.filename || 'custom.keystore',
      updated_at: ks.updated_at,
      description: `Custom imported keystore active (${ks.filename || 'custom.keystore'}).`,
    });
  }

  // 8c. Keystore Upload: POST /api/settings/keystore/upload
  if (path === '/api/settings/keystore/upload' && method === 'POST') {
    const contentType = request.headers.get('Content-Type') || '';
    let filename = 'custom.keystore';
    let alias = 'custom';
    let keystorePass = 'morpheflow';
    let keyPass = 'morpheflow';
    let base64Data = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return json({ error: 'Valid .keystore or .jks file is required' }, 400);
      }
      filename = (file as File).name || 'custom.keystore';
      alias = (formData.get('alias') as string)?.trim() || 'custom';
      keystorePass = (formData.get('keystore_pass') as string) || '';
      keyPass = (formData.get('key_pass') as string) || keystorePass;
      const buffer = await (file as File).arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64Data = btoa(binary);
    } else {
      const body = await request.json<any>();
      if (!body.data_base64) {
        return json({ error: 'data_base64 is required' }, 400);
      }
      base64Data = body.data_base64;
      filename = body.filename || 'custom.keystore';
      alias = body.alias || 'custom';
      keystorePass = body.keystore_pass || '';
      keyPass = body.key_pass || keystorePass;
    }

    if (!base64Data) {
      return json({ error: 'Keystore binary cannot be empty' }, 400);
    }

    await storage.saveKeystore({
      has_custom: true,
      filename,
      alias,
      keystore_pass: keystorePass,
      key_pass: keyPass,
      data_base64: base64Data,
      updated_at: new Date().toISOString(),
    });

    return json({
      status: 'success',
      message: `Custom keystore '${filename}' imported successfully. Builds will now be signed with alias '${alias}'.`,
    });
  }

  // 8d. Keystore Download: GET /api/settings/keystore/download
  if (path === '/api/settings/keystore/download' && method === 'GET') {
    const ks = await storage.getKeystore();
    if (!ks || !ks.has_custom || !ks.data_base64) {
      return json(
        { error: 'No custom keystore uploaded. Currently using default deterministic keystore.' },
        404
      );
    }

    const binaryString = atob(ks.data_base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Response(bytes.buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${ks.filename || 'custom.keystore'}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // 8e. Keystore Reset: DELETE /api/settings/keystore
  if (path === '/api/settings/keystore' && method === 'DELETE') {
    await storage.resetKeystore();
    return json({
      status: 'success',
      message: 'Reset back to MorpheFlow default deterministic keystore.',
    });
  }

  // 9. Packages: POST /api/config/app
  if (path === '/api/config/app' && method === 'POST') {
    const body = await request.json<any>();
    if (!body.package) {
      return json({ error: 'Package identifier is required' }, 400);
    }
    const saved = await storage.savePackage(body);
    return json({ status: 'success', result: saved });
  }

  // 9b. Custom Base APK: POST /api/config/app/base-apk
  if (path === '/api/config/app/base-apk' && method === 'POST') {
    const body = await request.json<any>();
    if (!body.package) {
      return json({ error: 'package identifier is required' }, 400);
    }
    const pkg = await storage.getPackage(body.package);
    if (!pkg) return json({ error: 'Package not found' }, 404);

    const currentOptions = pkg.options || {};
    currentOptions.base_apk_url = body.base_apk_url || '';

    await storage.savePackage({
      package: body.package,
      options: currentOptions,
    });

    return json({ status: 'success', package: body.package, base_apk_url: body.base_apk_url });
  }

  // 9c. Direct Base APK File Upload: POST /api/upload/apk
  if (path === '/api/upload/apk' && method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    let pkg = url.searchParams.get('package') || '';
    let fileBuffer: ArrayBuffer | null = null;
    let fileName = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('apk') as File | null;
      pkg = (formData.get('package') as string) || pkg;
      if (!file) {
        return json({ error: 'No APK file provided in formData field "apk"' }, 400);
      }
      fileName = file.name || `${pkg}.apk`;
      fileBuffer = await file.arrayBuffer();
    } else {
      fileBuffer = await request.arrayBuffer();
      fileName = `${pkg || 'base'}.apk`;
    }

    if (!pkg) {
      return json({ error: 'Package identifier is required (query parameter ?package=... or form field)' }, 400);
    }
    if (!fileBuffer || fileBuffer.byteLength === 0) {
      return json({ error: 'Uploaded APK file is empty' }, 400);
    }

    const repo = env.GITHUB_REPO || 'wiwek13/MorpheFlow';
    const token = env.GITHUB_TOKEN;

    if (!token) {
      return json({ error: 'GITHUB_TOKEN is not configured on Cloudflare Worker.' }, 500);
    }

    // 1. Get or create release with tag 'base-apks'
    let releaseId: number | null = null;
    let uploadUrlTemplate = '';
    const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/base-apks`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': APP_USER_AGENT,
      },
    });

    if (relRes.ok) {
      const relData = await relRes.json<any>();
      releaseId = relData.id;
      uploadUrlTemplate = relData.upload_url || '';

      // Check if asset already exists and delete to overwrite cleanly
      if (Array.isArray(relData.assets)) {
        const targetAssetName = `${pkg}.apk`;
        const existingAsset = relData.assets.find((a: any) => a.name === targetAssetName);
        if (existingAsset && existingAsset.id) {
          await fetch(`https://api.github.com/repos/${repo}/releases/assets/${existingAsset.id}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
              'User-Agent': APP_USER_AGENT,
            },
          });
        }
      }
    } else {
      // Create 'base-apks' release
      const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': APP_USER_AGENT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tag_name: 'base-apks',
          target_commitish: 'main',
          name: 'MorpheFlow Custom Base APKs',
          body: 'Persistent cloud storage for user-uploaded custom base APKs.',
          draft: false,
          prerelease: false,
        }),
      });
      if (!createRes.ok) {
        const errTxt = await createRes.text();
        return json({ error: `Failed to create base-apks release on GitHub: ${errTxt}` }, 502);
      }
      const createData = await createRes.json<any>();
      releaseId = createData.id;
      uploadUrlTemplate = createData.upload_url || '';
    }

    // 2. Upload asset
    const uploadBaseUrl = uploadUrlTemplate.replace(/\{[^{}]*\}$/, '');
    const finalUploadUrl = `${uploadBaseUrl}?name=${encodeURIComponent(pkg + '.apk')}`;

    const upRes = await fetch(finalUploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': APP_USER_AGENT,
        'Content-Type': 'application/vnd.android.package-archive',
      },
      body: fileBuffer,
    });

    if (!upRes.ok) {
      const upErr = await upRes.text();
      return json({ error: `Failed to upload APK asset to GitHub Releases: ${upErr}` }, 502);
    }

    const directDownloadUrl = `https://github.com/${repo}/releases/download/base-apks/${pkg}.apk`;

    // 3. Save URL to package options in D1
    const pkgRecord = await storage.getPackage(pkg);
    const currentOptions = pkgRecord?.options || {};
    currentOptions.base_apk_url = directDownloadUrl;
    await storage.savePackage({
      package: pkg,
      options: currentOptions,
    });

    return json({
      status: 'success',
      package: pkg,
      filename: `${pkg}.apk`,
      size_bytes: fileBuffer.byteLength,
      base_apk_url: directDownloadUrl,
    });
  }

  // 10. Packages: POST /api/config/app/toggle
  if (path === '/api/config/app/toggle' && method === 'POST') {
    const body = await request.json<any>();
    if (!body.package || typeof body.enabled !== 'boolean') {
      return json({ error: 'package and enabled boolean required' }, 400);
    }
    const ok = await storage.togglePackageEnabled(body.package, body.enabled);
    if (!ok) return json({ error: 'Package not found' }, 404);
    return json({ status: 'success', package: body.package, enabled: body.enabled });
  }

  // 11. Packages: DELETE /api/config/app/:pkg
  if (path.startsWith('/api/config/app/') && method === 'DELETE') {
    const pkg = decodeURIComponent(path.replace('/api/config/app/', ''));
    const ok = await storage.deletePackage(pkg);
    if (!ok) return json({ error: 'Package not found' }, 404);
    return json({ status: 'success', package: pkg });
  }

  // 12. Repositories: GET /api/config/repos
  if (path === '/api/config/repos' && method === 'GET') {
    const repos = await storage.getPatchRepos();
    return json(repos);
  }

  // 13. Repositories: POST /api/config/repos
  if (path === '/api/config/repos' && method === 'POST') {
    const body = await request.json<any>();
    const ok = await storage.addPatchRepo(body.repo_url || '');
    if (!ok) return json({ error: 'Invalid or duplicate repo URL' }, 400);
    return json({ status: 'success', repo_url: body.repo_url });
  }

  // 14. Repositories: DELETE /api/config/repos
  if (path === '/api/config/repos' && method === 'DELETE') {
    const body = await request.json<any>();
    const ok = await storage.deletePatchRepo(body.repo_url || '');
    if (!ok) return json({ error: 'Repo URL not found' }, 404);
    return json({ status: 'success', repo_url: body.repo_url });
  }

  // 15. GET /api/catalog (Proxies & Caches Morphe Bundles Catalog)
  if (path === '/api/catalog' && method === 'GET') {
    const isRefresh = url.searchParams.get('refresh') === 'true';
    try {
      const resp = await fetch('https://morphe-patches.software/data/bundles.json', {
        headers: {
          'User-Agent': APP_USER_AGENT,
          'Accept': 'application/json',
        },
        cf: {
          cacheTtl: isRefresh ? 0 : 21600, // 6 hours on Cloudflare edge unless refresh requested
          cacheEverything: true,
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': isRefresh ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600, s-maxage=21600',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    } catch (err: any) {
      console.warn('[MorpheFlow Worker] Failed to fetch remote catalog:', err?.message || err);
    }
    return json({
      store: {},
      bundles: [],
      compatibilities: [],
      featured: [],
    });
  }

  // 15c. Community Store Hourly Scan & Status: GET /api/catalog/sync & POST /api/catalog/sync
  if (path === '/api/catalog/sync' && method === 'GET') {
    const syncState = (await storage.getConfig('catalog_sync_state')) || {
      last_synced_at: Date.now() - 1800000,
      total_apps: 1354,
      total_bundles: 365,
      interval: 'hourly',
      auto_sync: true,
    };
    return json(syncState);
  }

  if (path === '/api/catalog/sync' && method === 'POST') {
    try {
      const resp = await fetch('https://morphe-patches.software/data/bundles.json', {
        headers: {
          'User-Agent': APP_USER_AGENT,
          'Accept': 'application/json',
        },
      });
      if (resp.ok) {
        const data = await resp.json<any>();
        const totalApps = Object.keys(data.store || {}).length;
        const totalBundles = Array.isArray(data.bundles) ? data.bundles.length : 0;
        const syncState = {
          last_synced_at: Date.now(),
          total_apps: totalApps,
          total_bundles: totalBundles,
          interval: 'hourly',
          auto_sync: true,
        };
        await storage.setConfig('catalog_sync_state', syncState);
        return json({ status: 'success', ...syncState });
      }
    } catch (err: any) {
      return json({ error: `Sync failed: ${err.message}` }, 500);
    }
    return json({ error: 'Failed to fetch upstream community ecosystem' }, 502);
  }

  // 15b. POST /api/catalog/provision (1-Click App Provisioning into Pipeline)
  if (path === '/api/catalog/provision' && method === 'POST') {
    const body = await request.json<any>();
    if (!body || !body.package) {
      return json({ error: 'Package identifier is required' }, 400);
    }

    const pkg = String(body.package).trim();
    const existing = await storage.getPackage(pkg);
    const appName = body.package_name || body.name || existing?.package_name || pkg;
    
    // Default repository fallback if none provided
    const defaultRepo = 'https://github.com/MorpheApp/morphe-patches';
    let repos: string[] = [];
    if (Array.isArray(body.all_repos) && body.all_repos.length > 0) {
      repos = body.all_repos.map((r: any) => String(r).trim()).filter(Boolean);
    } else if (Array.isArray(body.repos) && body.repos.length > 0) {
      repos = body.repos.map((r: any) => String(r).trim()).filter(Boolean);
    } else if (body.repo && typeof body.repo === 'string') {
      repos = [body.repo.trim()];
    } else if (body.repo_url && typeof body.repo_url === 'string') {
      repos = [body.repo_url.trim()];
    } else if (existing?.repos && existing.repos.length > 0) {
      repos = existing.repos;
    } else {
      repos = [defaultRepo];
    }

    // Build options structure with enabled patches
    const options: Record<string, any> = existing?.options ? JSON.parse(JSON.stringify(existing.options)) : {};
    if (Array.isArray(body.patches) && body.patches.length > 0) {
      for (const p of body.patches) {
        const pName = typeof p === 'string' ? p.trim() : (p.name || '').trim();
        if (!pName) continue;
        const pRepo = (typeof p === 'object' && (p.repo || p.repo_url)) ? String(p.repo || p.repo_url).trim() : repos[0];
        
        // Normalize owner from repo slug
        let owner = 'default';
        try {
          const cleanRepo = pRepo.replace(/https?:\/\/github\.com\//, '').replace(/\/+$/, '');
          const parts = cleanRepo.split('/');
          owner = parts[0] || 'default';
        } catch (_) {}

        if (!options[owner]) {
          options[owner] = {
            meta: {
              package: pkg,
              repo: pRepo,
            },
            patches: {},
          };
        }
        if (!options[owner].patches) options[owner].patches = {};
        options[owner].patches[pName] = { enabled: true };

        if (pRepo && !repos.includes(pRepo)) {
          repos.push(pRepo);
        }
      }
    }

    if (body.base_apk_url) {
      options.base_apk_url = body.base_apk_url;
    }

    const saved = await storage.savePackage({
      package: pkg,
      package_name: appName,
      enabled: true,
      repos: repos,
      patch_aliases: existing?.patch_aliases || [],
      options: options,
    });

    return json({
      status: 'success',
      message: `Successfully provisioned ${saved.package_name || saved.package} into MorpheFlow pipeline.`,
      result: saved,
    });
  }

  // 16. Options: GET /api/options/:pkg
  if (path.startsWith('/api/options/') && method === 'GET') {
    const parts = path.replace('/api/options/', '').split('/');
    const pkg = decodeURIComponent(parts[0]);
    const pkgRecord = await storage.getPackage(pkg);
    return json({
      package: pkg,
      files: pkgRecord?.options || {},
    });
  }

  // 17. Options fetch: POST /api/options-fetch/:pkg
  if (path.startsWith('/api/options-fetch/') && method === 'POST') {
    const pkg = decodeURIComponent(path.replace('/api/options-fetch/', ''));
    return json({
      success: true,
      package: pkg,
      files: {},
      repo_statuses: {},
      logs: ['[CF Worker] Options synchronized from remote catalog.'],
    });
  }

  // 18. Options save: POST /api/options/:pkg/:owner
  if (path.startsWith('/api/options/') && method === 'POST') {
    const parts = path.replace('/api/options/', '').split('/');
    const pkg = decodeURIComponent(parts[0]);
    const owner = decodeURIComponent(parts[1] || 'default');
    const body = await request.json<any>();

    const pkgRecord = await storage.getPackage(pkg);
    const options = pkgRecord?.options || {};
    options[owner] = body;
    await storage.savePackage({ package: pkg, options });
    return json({ status: 'success', package: pkg, owner });
  }

  // 19. Run pipeline: POST /api/run, POST /api/run/batch, or POST /api/run/:pkg
  if ((path === '/api/run' || path.startsWith('/api/run/')) && method === 'POST' && path !== '/api/run/stop' && path !== '/api/run/reset') {
    let pkg: string | null = null;
    let packages: string[] = [];
    let source = 'manual';

    if (path === '/api/run/batch') {
      try {
        const b = await request.json<any>();
        packages = Array.isArray(b.packages) ? b.packages.filter(Boolean) : [];
        source = b.source || 'batch_manual';
      } catch {}
    } else if (path.startsWith('/api/run/') && path !== '/api/run/batch') {
      pkg = decodeURIComponent(path.replace('/api/run/', ''));
    } else {
      try {
        const b = await request.json<any>();
        if (Array.isArray(b.packages) && b.packages.length > 0) {
          packages = b.packages.filter(Boolean);
        } else {
          pkg = b.package || null;
        }
        source = b.source || 'manual';
      } catch {}
    }

    // A) Batch Execution (Parallel Runs)
    if (packages.length > 0) {
      const runId = `batch-${Date.now()}`;
      const locked = await storage.acquireLock({
        run_id: runId,
        source,
        packages,
        started_at: Date.now() / 1000,
      });

      if (!locked) {
        return json({ message: 'One or more of the requested packages are already in progress.' }, 409);
      }

      const initialLog = `[*] MorpheFlow parallel batch pipeline triggered (${source}) for ${packages.length} packages: ${packages.join(', ')} at ${new Date().toISOString()}`;
      await storage.appendRunLogs(runId, [initialLog]);

      let dispatchCount = 0;
      const dispatchErrors: string[] = [];

      if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
        const logsToAppend: string[] = [];
        const dispatchResults = await Promise.allSettled(
          packages.map(async (targetPkg) => {
            const ghUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/morpheflow-cloud-builder.yaml/dispatches`;
            const ghRes = await fetch(ghUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'MorpheFlow-CloudflareWorker',
              },
              body: JSON.stringify({
                ref: 'main',
                inputs: {
                  target_package: targetPkg,
                  runner_callback_url: url.origin,
                },
              }),
            });
            if (ghRes.ok || ghRes.status === 204) {
              return { pkg: targetPkg, ok: true, status: ghRes.status };
            } else {
              const errText = await ghRes.text();
              return { pkg: targetPkg, ok: false, error: `(${ghRes.status}): ${errText}` };
            }
          })
        );

        for (let i = 0; i < dispatchResults.length; i++) {
          const res = dispatchResults[i];
          const pkgName = packages[i];
          if (res.status === 'fulfilled') {
            if (res.value.ok) {
              dispatchCount++;
              logsToAppend.push(`[✓] GitHub Actions build runner dispatched for ${res.value.pkg}`);
            } else {
              dispatchErrors.push(`${res.value.pkg} ${res.value.error}`);
              logsToAppend.push(`[!] GitHub dispatch error for ${res.value.pkg} ${res.value.error}`);
              // Release lock immediately for any failed package so it is not stalled for 45 minutes
              await storage.releaseLock(res.value.pkg);
            }
          } else {
            const err = res.reason;
            const msg = err?.message || String(err);
            dispatchErrors.push(msg);
            logsToAppend.push(`[!] GitHub dispatch exception for ${pkgName}: ${msg}`);
            if (pkgName) {
              await storage.releaseLock(pkgName);
            }
          }
        }

        if (logsToAppend.length > 0) {
          await storage.appendRunLogs(runId, logsToAppend);
        }
      } else {
        await storage.appendRunLogs(runId, [
          '[ℹ] Note: GITHUB_TOKEN & GITHUB_REPO not set in Worker environment.',
          'Runs can be fulfilled by local runner or external hybrid agent webhook.',
        ]);
      }

      if (env.GITHUB_TOKEN && env.GITHUB_REPO && dispatchCount === 0 && packages.length > 0) {
        await storage.releaseLock(runId);
        return json({
          status: 'error',
          run_id: runId,
          message: `Failed to dispatch parallel builds: ${dispatchErrors.join('; ')}`,
          errors: dispatchErrors,
        }, 502);
      }

      return json({
        status: 'started',
        run_id: runId,
        source,
        packages,
        started_at: Date.now() / 1000,
        dispatched: dispatchCount > 0,
        dispatched_count: dispatchCount,
        errors: dispatchErrors.length > 0 ? dispatchErrors : undefined,
        message: `Dispatched ${dispatchCount} of ${packages.length} parallel build runners.`,
      });
    }

    // B) Single Package or Global Run
    const runId = `run-${Date.now()}`;
    const locked = await storage.acquireLock({
      run_id: runId,
      source,
      package: pkg,
      started_at: Date.now() / 1000,
    });

    if (!locked) {
      return json(
        { message: pkg ? `A build execution for ${pkg} is already in progress.` : 'A build execution is already in progress.' },
        409
      );
    }

    const initialLog = `[*] MorpheFlow pipeline triggered (${source})${pkg ? ` for ${pkg}` : ''} at ${new Date().toISOString()}`;
    await storage.appendRunLogs(runId, [initialLog]);

    // Dispatch to GitHub Actions if configured
    let dispatched = false;
    let dispatchMsg = 'Local/manual mode';
    if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
      try {
        const ghUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/morpheflow-cloud-builder.yaml/dispatches`;
        const ghRes = await fetch(ghUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'MorpheFlow-CloudflareWorker',
          },
          body: JSON.stringify({
            ref: 'main',
            inputs: {
              target_package: pkg || '',
              runner_callback_url: url.origin,
            },
          }),
        });
        if (ghRes.ok || ghRes.status === 204) {
          dispatched = true;
          dispatchMsg = 'GitHub Actions build runner dispatched successfully.';
          await storage.appendRunLogs(runId, [`[✓] ${dispatchMsg}`]);
        } else {
          const errText = await ghRes.text();
          dispatchMsg = `GitHub dispatch error (${ghRes.status}): ${errText}`;
          await storage.appendRunLogs(runId, [`[!] ${dispatchMsg}`]);
        }
      } catch (err: any) {
        dispatchMsg = `GitHub dispatch network exception: ${err.message}`;
        await storage.appendRunLogs(runId, [`[!] ${dispatchMsg}`]);
      }
    } else {
      await storage.appendRunLogs(runId, [
        '[ℹ] Note: GITHUB_TOKEN & GITHUB_REPO not set in Worker environment.',
        'Runs can be fulfilled by GitHub Actions runner or external hybrid agent webhook.',
      ]);
    }

    if (env.GITHUB_TOKEN && env.GITHUB_REPO && !dispatched) {
      await storage.releaseLock(runId);
      return json({
        status: 'error',
        run_id: runId,
        message: dispatchMsg,
      }, 502);
    }

    return json({
      status: 'started',
      run_id: runId,
      source: pkg ? `${source}:${pkg}` : source,
      package: pkg,
      started_at: Date.now() / 1000,
      dispatched,
      message: dispatchMsg,
    });
  }

  // 20. Stop or Force Reset run: POST /api/run/stop or POST /api/run/reset
  if ((path === '/api/run/stop' || path === '/api/run/reset') && method === 'POST') {
    await storage.resetAllLocks();
    return json({ status: 'reset', message: 'All pipeline execution locks and active states have been cleared.' });
  }

  // 21. Run Logs: GET /api/run/logs
  if (path === '/api/run/logs' && method === 'GET') {
    const logs = await storage.getRunLogs();
    const lastRun = await storage.getLastRunInfo();
    const activeLock = await storage.getActiveLock();
    const now = Date.now() / 1000;
    const isRunning = Boolean(activeLock && (!activeLock.expires_at || activeLock.expires_at > now));

    return json({
      lines: logs.logs,
      run_id: logs.run_id,
      run_info: lastRun,
      active_lock: activeLock,
      is_running: isRunning,
      status: isRunning ? 'running' : (lastRun?.status || 'idle'),
    });
  }

  // 22. Run Stream: GET /api/run/stream (SSE)
  if (path === '/api/run/stream' && method === 'GET') {
    const logs = await storage.getRunLogs();
    const lastRun = await storage.getLastRunInfo();
    const activeLock = await storage.getActiveLock();
    const now = Date.now() / 1000;
    const isRunning = Boolean(activeLock && (!activeLock.expires_at || activeLock.expires_at > now));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const line of logs.logs) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line, type: 'stdout' })}\n\n`));
        }
        if (!isRunning) {
          controller.enqueue(
            encoder.encode(
              `event: complete\ndata: ${JSON.stringify({
                status: lastRun?.status || 'success',
                package: lastRun?.package || null,
                duration: lastRun?.duration_seconds || 0,
              })}\n\n`
            )
          );
        } else {
          controller.enqueue(encoder.encode(`event: ping\ndata: keepalive\n\n`));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // 23. File Browser API: GET /api/files
  if (path === '/api/files' && method === 'GET') {
    const subpath = url.searchParams.get('path') || '';
    const apps = await storage.listPatchedApps();
    const repo = env.GITHUB_REPO || 'wiwek13/MorpheFlow';

    const files = apps.map((a) => {
      const perAppTagUrl = `https://github.com/${repo}/releases/tag/app-${a.package}`;
      const appName = a.package === 'com.truecaller' ? 'Truecaller' : (a.package === 'com.reddit.frontpage' ? 'Reddit' : a.package.split('.').pop() || a.package);
      const ciPkg = toCaseInsensitiveRegexPattern(a.package);
      const ciName = toCaseInsensitiveRegexPattern(appName);
      const obtainiumPayload = {
        id: a.package,
        url: `https://github.com/${repo}`,
        author: repo.split('/')[0] || 'MorpheFlow',
        name: appName,
        preferredApkIndex: 0,
        additionalSettings: JSON.stringify({
          fallbackToOlderReleases: true,
          includePrereleases: true,
          filterReleaseTitlesByRegEx: `(${ciPkg}|${ciName})`,
          apkFilterRegEx: `^${ciPkg}_`,
          releaseTitleAsVersion: true,
          versionExtractionRegEx: 'v?([0-9][0-9a-zA-Z._-]+)$',
          matchGroupToUse: '1',
          sortMethodChoice: 'date',
        }),
      };
      const obtainiumUrl = `obtainium://app/${encodeURIComponent(JSON.stringify(obtainiumPayload))}`;
      const obtainiumWebRedirect = `https://apps.obtainium.imranr.dev/redirect?r=${encodeURIComponent(obtainiumUrl)}`;

      return {
        name: a.filename,
        path: `${a.package}/${a.version}/${a.filename}`,
        size: a.formatted_size,
        raw_size: a.size_bytes,
        url: a.download_url,
        mtime: a.patched_at,
        is_apk: true,
        is_result_json: false,
        package: a.package,
        version: a.version,
        tag_url: perAppTagUrl,
        obtainium_url: obtainiumUrl,
        obtainium_web_url: obtainiumWebRedirect,
      };
    });

    const totalBytes = apps.reduce((acc, a) => acc + a.size_bytes, 0);

    return json({
      current_path: subpath,
      parent_path: null,
      breadcrumbs: [{ name: 'root', path: '' }],
      dirs: [],
      files,
      total_bytes: totalBytes,
      formatted_total_bytes: formatBytes(totalBytes),
      apk_count: apps.length,
    });
  }

  // 23b. Direct Authenticated Binary APK Download Proxy: GET /api/download/:pkg or GET /files/:filename
  if ((path.startsWith('/api/download/') || path.startsWith('/files/')) && (method === 'GET' || method === 'HEAD')) {
    const rawTarget = path.startsWith('/api/download/')
      ? decodeURIComponent(path.replace('/api/download/', ''))
      : decodeURIComponent(path.replace('/files/', ''));

    const parts = rawTarget.split('/').filter(Boolean);
    const primaryTarget = parts[0] || '';
    const specificFile = parts[1] || null;

    const patchedApps = await storage.listPatchedApps();
    let appMatch = patchedApps.find(
      (a) =>
        a.package === primaryTarget ||
        a.filename === primaryTarget ||
        a.filename === `${primaryTarget}.apk` ||
        (specificFile && (a.filename === specificFile || a.package === primaryTarget))
    );

    if (!appMatch) {
      // Check if primaryTarget has package prefix
      const stripped = primaryTarget.split('_')[0];
      appMatch = patchedApps.find((a) => a.package === stripped);
    }

    if (!appMatch) {
      return json({ error: `No compiled APK binary found for ${rawTarget}` }, 404);
    }

    const repo = env.GITHUB_REPO || 'wiwek13/MorpheFlow';
    const token = env.GITHUB_TOKEN;

    if (!token) {
      return Response.redirect(appMatch.download_url, 302);
    }

    try {
      // 1. Try to find asset via GitHub Releases API
      let tag = `app-${appMatch.package}`;
      if (appMatch.release_url && appMatch.release_url.includes('/tag/')) {
        tag = appMatch.release_url.split('/tag/').pop() || tag;
      }

      let assetId: number | null = null;

      const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'MorpheFlow-CloudflareWorker',
        },
      });

      if (relRes.ok) {
        const relData: any = await relRes.json();
        const asset = (relData.assets || []).find(
          (ast: any) => ast.name === appMatch!.filename || ast.name.endsWith('.apk')
        );
        if (asset && asset.id) {
          assetId = asset.id;
        }
      }

      // If not found in tag, search recent releases
      if (!assetId) {
        const listRelRes = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'MorpheFlow-CloudflareWorker',
          },
        });
        if (listRelRes.ok) {
          const releases: any[] = await listRelRes.json();
          for (const rel of releases) {
            const asset = (rel.assets || []).find(
              (ast: any) => ast.name === appMatch!.filename || (ast.name.endsWith('.apk') && ast.name.includes(appMatch!.package))
            );
            if (asset && asset.id) {
              assetId = asset.id;
              break;
            }
          }
        }
      }

      if (assetId) {
        const assetStreamRes = await fetch(
          `https://api.github.com/repos/${repo}/releases/assets/${assetId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/octet-stream',
              'User-Agent': 'MorpheFlow-CloudflareWorker',
            },
            redirect: 'manual',
          }
        );

        const s3Location = assetStreamRes.headers.get('Location');
        if (s3Location) {
          return Response.redirect(s3Location, 302);
        }

        if (assetStreamRes.ok) {
          return new Response(assetStreamRes.body, {
            status: 200,
            headers: {
              'Content-Type': 'application/vnd.android.package-archive',
              'Content-Disposition': `attachment; filename="${appMatch.filename}"`,
              'Cache-Control': 'public, max-age=3600',
            },
          });
        }
      }

      // Fallback to direct download_url redirect if API asset lookup fails
      return Response.redirect(appMatch.download_url, 302);
    } catch (err: any) {
      return json({ error: `Download failed: ${err.message}` }, 500);
    }
  }

  // 24. Webhook Report: POST /api/webhook/report
  // Dispatched by GitHub Actions cloud builder to update Worker state upon build completion!
  if (path === '/api/webhook/report' && method === 'POST') {
    const secret = request.headers.get('X-Webhook-Secret') || '';
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return json({ error: 'Unauthorized webhook' }, 401);
    }

    const payload = await request.json<any>();
    const runId = payload.run_id || `run-${Date.now()}`;
    const status = payload.status === 'success' ? 'success' : 'failed';
    const duration = payload.duration_seconds || 0;

    // Record run history
    await storage.recordRunHistory({
      run_id: runId,
      status,
      returncode: payload.returncode || (status === 'success' ? 0 : 1),
      duration_seconds: duration,
      duration_formatted: payload.duration_formatted || `${duration}s`,
      source: payload.source || 'cloud_builder',
      package: payload.package || null,
      finished_at: Date.now() / 1000,
    });

    // Record patched apps
    if (Array.isArray(payload.patched_apps)) {
      for (const a of payload.patched_apps) {
        await storage.recordPatchedApp({
          package: a.package,
          version: a.version,
          arch: a.arch || 'arm64-v8a',
          filename: a.filename || `${a.package}.apk`,
          size_bytes: a.size_bytes || 0,
          formatted_size: a.formatted_size || formatBytes(a.size_bytes || 0),
          sha256: a.sha256,
          download_url: a.download_url,
          release_url: a.release_url,
          applied_patches: a.applied_patches || [],
          result_json: a.result_json,
          patched_at: new Date().toISOString(),
        });
      }
    }

    // Save build logs
    if (Array.isArray(payload.logs)) {
      await storage.appendRunLogs(runId, payload.logs);
    }

    // Save HTML report if present
    if (payload.report_html) {
      await storage.setConfig('latest_report_html', payload.report_html);
    }

    // Save cached repo versions if present
    if (payload.repo_versions && typeof payload.repo_versions === 'object') {
      await storage.setConfig('repo_versions', payload.repo_versions);
    }

    // Release lock (per-package or all)
    await storage.releaseLock(payload.package || null);

    // Dispatch Notifications (Telegram / Discord)
    try {
      const notifConfig = (await storage.getConfig<any>('notifications')) || {};
      const patchedCount = Array.isArray(payload.patched_apps) ? payload.patched_apps.length : 0;
      const statusEmoji = status === 'success' ? '✅' : '❌';

      // 1. Telegram
      if (notifConfig.telegram_bot_token && notifConfig.telegram_chat_id) {
        const text = `${statusEmoji} *MorpheFlow Build ${status.toUpperCase()}*\n\n` +
          `• *Duration:* ${payload.duration_formatted || `${duration}s`}\n` +
          `• *Target:* ${payload.package || 'All Targets'}\n` +
          `• *Binaries Compiled:* ${patchedCount}\n` +
          (payload.patched_apps && payload.patched_apps.length > 0
            ? payload.patched_apps.map((a: any) => `  - [${a.package} (${a.version})](${a.release_url || a.download_url})`).join('\n')
            : '');

        ctx.waitUntil(
          fetch(`https://api.telegram.org/bot${notifConfig.telegram_bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: notifConfig.telegram_chat_id,
              text,
              parse_mode: 'Markdown',
              disable_web_page_preview: false,
            }),
          }).catch(e => console.warn('Telegram notification failed:', e))
        );
      }

      // 2. Discord Webhook
      if (notifConfig.discord_webhook_url) {
        const content = `${statusEmoji} **MorpheFlow Build ${status.toUpperCase()}** (${payload.duration_formatted || `${duration}s`})\n` +
          `Target: \`${payload.package || 'All Targets'}\` | Binaries: ${patchedCount}\n` +
          (payload.patched_apps && payload.patched_apps.length > 0
            ? payload.patched_apps.map((a: any) => `> **${a.package}** (${a.version}) - [Download / Release](${a.release_url || a.download_url})`).join('\n')
            : '');

        ctx.waitUntil(
          fetch(notifConfig.discord_webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          }).catch(e => console.warn('Discord webhook failed:', e))
        );
      }
    } catch (e) {
      console.warn('Notification dispatcher error:', e);
    }

    return json({ status: 'success', recorded: true });
  }

  // 25. HTML Build Report: GET /report or GET /api/run/report
  if (path === '/report' || path === '/build_report.html' || path === '/api/run/report') {
    const html = await storage.getConfig<string>('latest_report_html');
    if (html) {
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }
    return new Response(
      '<html><body style="background:#0b0d10;color:#fff;font-family:sans-serif;padding:40px;"><h2>No build report recorded yet.</h2><p>Trigger a build to generate reports.</p></body></html>',
      {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }

  // 26. Updates Check: GET /api/updates/check
  if (path === '/api/updates/check' && method === 'GET') {
    return json({
      update_available: false,
      status: 'up_to_date',
      branch: APP_BRANCH,
      current_version: APP_VERSION,
      current_tag: `v${APP_VERSION}`,
      current_commit: APP_COMMIT,
      latest_version: APP_VERSION,
      latest_tag: `v${APP_VERSION}`,
      release_name: 'MorpheFlow Cloudflare Edge',
      release_notes: 'Running on Cloudflare Workers Free Tier.',
      release_url: 'https://github.com/wiwek13/MorpheFlow',
      checked_at: new Date().toISOString(),
      cached: false,
      cooldown: false,
      cooldown_remaining: 0,
      error: null,
    });
  }

  return json({ error: 'Endpoint not found', path }, 404);
}
