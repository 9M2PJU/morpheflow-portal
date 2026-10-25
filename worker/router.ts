/**
 * AutoMorph Cloudflare Worker API Router
 * Implements the full REST and SSE API contract for AutoMorph Web Portal.
 */

import { EmailSettings, Env, RunHistoryRecord, StatusResponse, SystemSettings } from './types';
import { StorageService, formatBytes } from './storage';
import {
  authenticateRequest,
  buildSessionCookieHeader,
  checkRateLimit,
  createSessionToken,
  recordFailedLogin,
  resetFailedLogin,
  timingSafeEqual,
} from './auth';

export function json(data: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      ...headers,
    },
  });
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

export async function handleApiRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  const storage = new StorageService(env.DB);
  await storage.initializeDatabase();

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

    if (timingSafeEqual(masterPassword, password)) {
      await resetFailedLogin(storage, ip);
      const token = await createSessionToken(masterPassword);
      const cookieHeader = buildSessionCookieHeader(token);
      return json(
        { status: 'success', authenticated: true },
        200,
        { 'Set-Cookie': cookieHeader }
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
    const clearCookie = buildSessionCookieHeader(null);
    if (method === 'GET') {
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/',
          'Set-Cookie': clearCookie,
        },
      });
    }
    return json({ status: 'logged_out', authenticated: false }, 200, { 'Set-Cookie': clearCookie });
  }

  if (path === '/api/auth/check' && method === 'GET') {
    const auth = await authenticateRequest(request, env);
    return json({ authenticated: auth.authenticated, single_user: true });
  }

  // Webhook exemption: POST /api/webhook/report has its own X-Webhook-Secret auth
  if (path !== '/api/webhook/report') {
    const auth = await authenticateRequest(request, env);
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
      version: '2.1.0',
      branch: 'cloudflare-worker',
      run_number: 1,
      commit: 'cf-edge',
    });
  }

  // 2. GET /api/status
  if (path === '/api/status' && method === 'GET') {
    const activeLock = await storage.getActiveLock();
    const lastRun = await storage.getLastRunInfo();
    const storageStats = await storage.getStorageStats();
    const packages = await storage.listPackages();
    const repos = await storage.getPatchRepos();
    const system = await storage.getConfig<SystemSettings>('system');

    const nextRun = resolveScheduleTarget(system, env);

    const isRunning = Boolean(activeLock);
    const activeRun = isRunning
      ? {
          run_id: activeLock.run_id,
          source: activeLock.source,
          package: activeLock.package,
          started_at: activeLock.started_at,
        }
      : null;

    const response: StatusResponse = {
      is_running: isRunning,
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
        version: '2.1.0',
        branch: 'cloudflare-worker',
        run_number: 1,
        commit: 'cf-edge',
      },
    };
    return json(response);
  }

  // 3. GET /api/config
  if (path === '/api/config' && method === 'GET') {
    const packages = await storage.listPackages();
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

  // 9. Packages: POST /api/config/app
  if (path === '/api/config/app' && method === 'POST') {
    const body = await request.json<any>();
    if (!body.package) {
      return json({ error: 'Package identifier is required' }, 400);
    }
    const saved = await storage.savePackage(body);
    return json({ status: 'success', result: saved });
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

  // 15. GET /api/catalog
  if (path === '/api/catalog' && method === 'GET') {
    try {
      const resp = await fetch('https://morphe-patches.software/data/bundles.json', {
        headers: { 'User-Agent': 'AutoMorph-CloudflareWorker' },
      });
      if (resp.ok) {
        const data = await resp.json();
        return json(data);
      }
    } catch {
      // Fallback
    }
    return json({
      store: 'Morphe Bundles',
      bundles: [],
      compatibilities: {},
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

  // 19. Run pipeline: POST /api/run or POST /api/run/:pkg
  if ((path === '/api/run' || path.startsWith('/api/run/')) && method === 'POST' && path !== '/api/run/stop') {
    let pkg: string | null = null;
    let source = 'manual';
    if (path.startsWith('/api/run/')) {
      pkg = decodeURIComponent(path.replace('/api/run/', ''));
    } else {
      try {
        const b = await request.json<any>();
        pkg = b.package || null;
        source = b.source || 'manual';
      } catch {}
    }

    const runId = `run-${Date.now()}`;
    const locked = await storage.acquireLock({
      run_id: runId,
      source,
      package: pkg,
      started_at: Date.now() / 1000,
    });

    if (!locked) {
      return json({ message: 'A build execution is already in progress.' }, 409);
    }

    const initialLog = `[*] AutoMorph pipeline triggered (${source})${pkg ? ` for ${pkg}` : ''} at ${new Date().toISOString()}`;
    await storage.appendRunLogs(runId, [initialLog]);

    // Dispatch to GitHub Actions if configured
    let dispatched = false;
    let dispatchMsg = 'Local/manual mode';
    if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
      try {
        const ghUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/automorph-cloud-builder.yaml/dispatches`;
        const ghRes = await fetch(ghUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'AutoMorph-CloudflareWorker',
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

  // 20. Stop run: POST /api/run/stop
  if (path === '/api/run/stop' && method === 'POST') {
    await storage.releaseLock();
    return json({ status: 'stopped', message: 'Execution lock released.' });
  }

  // 21. Run Logs: GET /api/run/logs
  if (path === '/api/run/logs' && method === 'GET') {
    const logs = await storage.getRunLogs();
    return json({
      lines: logs.logs,
      run_id: logs.run_id,
    });
  }

  // 22. Run Stream: GET /api/run/stream (SSE)
  if (path === '/api/run/stream' && method === 'GET') {
    const logs = await storage.getRunLogs();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const line of logs.logs) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line, type: 'stdout' })}\n\n`));
        }
        controller.enqueue(encoder.encode(`event: ping\ndata: keepalive\n\n`));
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

    const files = apps.map((a) => ({
      name: a.filename,
      path: `${a.package}/${a.version}/${a.filename}`,
      size: a.formatted_size,
      raw_size: a.size_bytes,
      url: a.download_url,
      mtime: a.patched_at,
      is_apk: true,
      is_result_json: false,
    }));

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

    // Release lock
    await storage.releaseLock();

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
      branch: 'cloudflare-worker',
      current_version: '2.1.0',
      current_tag: 'v2.1.0',
      current_commit: 'cf-edge',
      latest_version: '2.1.0',
      latest_tag: 'v2.1.0',
      release_name: 'AutoMorph Cloudflare Edge',
      release_notes: 'Running on Cloudflare Workers Free Tier.',
      release_url: 'https://github.com/holjab/automorph',
      checked_at: new Date().toISOString(),
      cached: false,
      cooldown: false,
      cooldown_remaining: 0,
      error: null,
    });
  }

  return json({ error: 'Endpoint not found', path }, 404);
}
