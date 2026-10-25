/**
 * AutoMorph Cloudflare Worker Main Entrypoint
 * Modeled after NodeWarden (https://github.com/shuaiplus/nodewarden)
 */

import { Env } from './types';
import { handleApiRequest } from './router';
import { StorageService } from './storage';

function isApiOrSpecialPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname === '/report' ||
    pathname === '/build_report.html' ||
    pathname === '/api'
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

    // Handle files route redirection into dashboard #/files
    if (pathname === '/files' || pathname.startsWith('/files/')) {
      const subpath = pathname.replace(/^\/files\/?/, '');
      const redirectUrl = subpath ? `${url.origin}/#/files/${subpath}` : `${url.origin}/#/files`;
      return Response.redirect(redirectUrl, 302);
    }

    // Handle API & reports
    if (isApiOrSpecialPath(pathname)) {
      return handleApiRequest(normalizedRequest, env, ctx);
    }

    // Serve static assets via Cloudflare Workers Static Assets binding
    if (env.ASSETS) {
      try {
        const assetResponse = await env.ASSETS.fetch(normalizedRequest);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }
      } catch (err) {
        console.warn('Asset fetch error, falling back to router:', err);
      }
    }

    // Fallback: If not matched and not API, serve API handler
    return handleApiRequest(normalizedRequest, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[AutoMorph Cron Trigger] Scheduled job fired at ${new Date(event.scheduledTime).toISOString()}`);

    const storage = new StorageService(env.DB);
    await storage.initializeDatabase();

    const runId = `cron-${Date.now()}`;
    const acquired = await storage.acquireLock({
      run_id: runId,
      source: 'scheduler',
      started_at: Date.now() / 1000,
    });

    if (!acquired) {
      console.log('[AutoMorph Cron Trigger] Run skipped: An active execution lock is already held.');
      return;
    }

    await storage.appendRunLogs(runId, [
      `[*] AutoMorph daily scheduled run triggered via Cloudflare Cron Trigger at ${new Date().toISOString()}`,
    ]);

    // Dispatch to GitHub Actions if configured
    if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
      try {
        const ghUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/automorph-cloud-builder.yaml/dispatches`;
        const res = await fetch(ghUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'AutoMorph-CloudflareWorker',
          },
          body: JSON.stringify({
            ref: 'main',
            inputs: {
              target_package: '',
              runner_callback_url: '',
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
    }
  },
};
