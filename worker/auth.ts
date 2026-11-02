/**
 * MorpheFlow Security & Authentication Service
 * Unbreakable single-user authentication for Cloudflare Workers.
 *
 * Features:
 * - Constant-time password verification (prevents timing attacks)
 * - HMAC-SHA256 signed session tokens (tamper-proof)
 * - HttpOnly, Secure, SameSite=Strict cookies
 * - IP-based brute-force rate limiting (5 attempts / 15 minutes)
 * - Bearer / X-Auth-Token header support for API requests
 * - Exemption for public assets (favicons, logos) and webhooks
 */

import { Env } from './types';
import { StorageService } from './storage';

export const PRIMARY_COOKIE_NAME = '__Host-morpheflow_session';
export const FALLBACK_COOKIE_NAME = 'morpheflow_session';
const LEGACY_PRIMARY_COOKIE_NAME = '__Host-automorph_session';
const LEGACY_FALLBACK_COOKIE_NAME = 'automorph_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600; // 30 days
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes

/**
 * Constant-time comparison using SHA-256 pre-hashing to prevent timing attacks.
 * Pre-hashing guarantees both buffers are exactly 32 bytes, eliminating byte-length timing disclosure.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const aHashBuf = await crypto.subtle.digest('SHA-256', enc.encode(a));
  const bHashBuf = await crypto.subtle.digest('SHA-256', enc.encode(b));
  const aHash = new Uint8Array(aHashBuf);
  const bHash = new Uint8Array(bHashBuf);

  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= aHash[i] ^ bHash[i];
  }
  return diff === 0;
}

/**
 * Derives a deterministic HMAC signing key from AUTH_SECRET or AUTH_PASSWORD.
 */
async function getSigningKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest('SHA-256', enc.encode(secret + '_morpheflow_session_v1'));
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Creates an HMAC-SHA256 signed session token.
 */
export async function createSessionToken(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'admin',
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };

  const enc = new TextEncoder();
  const headerAndPayload = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await getSigningKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(headerAndPayload));
  const sigStr = base64UrlEncode(new Uint8Array(sigBuf));

  return `${headerAndPayload}.${sigStr}`;
}

/**
 * Verifies an HMAC-SHA256 signed session token.
 * Checks signature, expiration, and ensures token was issued after any session revocation epoch.
 */
export async function verifySessionToken(
  secret: string,
  token: string,
  minValidTimestamp: number = 0
): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [headerAndPayload, sigStr] = parts;
  const enc = new TextEncoder();

  try {
    const key = await getSigningKey(secret);
    const expectedSigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(headerAndPayload));
    const expectedSigStr = base64UrlEncode(new Uint8Array(expectedSigBuf));

    if (!(await timingSafeEqual(expectedSigStr, sigStr))) {
      return false;
    }

    const payloadBytes = base64UrlDecode(headerAndPayload);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now > payload.exp) {
      return false; // Expired
    }

    // Server-side session revocation check:
    // If a session was issued prior to a logout/revocation event, reject it immediately
    if (payload.iat && payload.iat < minValidTimestamp) {
      return false; // Revoked
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts session cookie value from a Request.
 * Prioritizes RFC 6265bis __Host- prefix, with fallback to legacy/HTTP cookie.
 */
export function getSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';');
  let fallbackVal: string | null = null;

  for (const cookie of cookies) {
    const [rawName, ...rest] = cookie.trim().split('=');
    const name = rawName.trim();
    if (name === PRIMARY_COOKIE_NAME) {
      return rest.join('=');
    }
    if ((name === FALLBACK_COOKIE_NAME || name === LEGACY_PRIMARY_COOKIE_NAME || name === LEGACY_FALLBACK_COOKIE_NAME) && !fallbackVal) {
      fallbackVal = rest.join('=');
    }
  }
  return fallbackVal;
}

/**
 * Generates an array of Set-Cookie header strings for session establishment or clearance.
 * Sets __Host- cookie on HTTPS, and fallback cookie for compatibility.
 */
export function buildSessionCookieHeaders(token: string | null, isSecure: boolean = true): string[] {
  if (!token) {
    return [
      `${PRIMARY_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      `${FALLBACK_COOKIE_NAME}=; Path=/; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Strict; Max-Age=0`,
    ];
  }

  const list: string[] = [];
  if (isSecure) {
    list.push(`${PRIMARY_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  }
  list.push(`${FALLBACK_COOKIE_NAME}=${token}; Path=/; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  return list;
}

/**
 * Single-header convenience wrapper for backward compatibility.
 */
export function buildSessionCookieHeader(token: string | null, isSecure: boolean = true): string {
  const headers = buildSessionCookieHeaders(token, isSecure);
  return headers[0];
}

/**
 * Rate limiting for login attempts to prevent brute-force attacks.
 */
export async function checkRateLimit(
  storage: StorageService,
  ip: string
): Promise<{ allowed: boolean; remainingAttempts: number; retryAfterSeconds: number }> {
  const now = Math.floor(Date.now() / 1000);
  const key = `ratelimit_login_${ip.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const record = (await storage.getConfig<any>(key)) || { attempts: 0, lastAttempt: 0, lockedUntil: 0 };

  if (record.lockedUntil && record.lockedUntil > now) {
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: record.lockedUntil - now,
    };
  }

  // Reset counter if last attempt was more than lockout duration ago
  if (now - record.lastAttempt > LOCKOUT_DURATION_SECONDS) {
    record.attempts = 0;
  }

  return {
    allowed: true,
    remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - record.attempts),
    retryAfterSeconds: 0,
  };
}

export async function recordFailedLogin(storage: StorageService, ip: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const key = `ratelimit_login_${ip.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const record = (await storage.getConfig<any>(key)) || { attempts: 0, lastAttempt: 0, lockedUntil: 0 };

  record.attempts = (record.attempts || 0) + 1;
  record.lastAttempt = now;

  if (record.attempts >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_SECONDS;
  }

  await storage.setConfig(key, record);
}

export async function resetFailedLogin(storage: StorageService, ip: string): Promise<void> {
  const key = `ratelimit_login_${ip.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  await storage.setConfig(key, { attempts: 0, lastAttempt: 0, lockedUntil: 0 });
}

/**
 * Core authentication check for any incoming Request.
 * Verifies Bearer tokens, X-Auth-Token, or tamper-proof HMAC session cookies against revocation epoch.
 */
export async function authenticateRequest(
  request: Request,
  env: Env,
  storage?: StorageService
): Promise<{ authenticated: boolean; method: 'cookie' | 'bearer' | 'none' }> {
  const masterPassword = (env.AUTH_PASSWORD || '').trim();

  // If no password is set, deny access
  if (!masterPassword) {
    return { authenticated: false, method: 'none' };
  }

  // 1. Check Bearer / X-Auth-Token header (for API clients, curl, tools)
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (await timingSafeEqual(masterPassword, token)) {
      return { authenticated: true, method: 'bearer' };
    }
  }

  const customToken = request.headers.get('X-Auth-Token') || '';
  if (customToken && (await timingSafeEqual(masterPassword, customToken.trim()))) {
    return { authenticated: true, method: 'bearer' };
  }

  // 2. Check Session Cookie
  const cookieToken = getSessionCookie(request);
  if (cookieToken) {
    let minValidTimestamp = 0;
    if (storage) {
      minValidTimestamp = await storage.getSessionRevocationTimestamp();
    }
    const valid = await verifySessionToken(masterPassword, cookieToken, minValidTimestamp);
    if (valid) {
      return { authenticated: true, method: 'cookie' };
    }
  }

  return { authenticated: false, method: 'none' };
}

/**
 * Attaches industry-standard defensive security headers to any outgoing Response.
 */
export function applySecurityHeaders(res: Response): Response {
  const newHeaders = new Headers(res.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  newHeaders.set(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' https: data:; connect-src 'self' https:; frame-ancestors 'none';"
  );
  newHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  newHeaders.set('Pragma', 'no-cache');
  newHeaders.set('Expires', '0');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}

/**
 * Renders the standalone Morphe Cyber Obsidian Login Gateway HTML.
 */
export function renderLoginScreen(error: string = '', lockedSeconds: number = 0): Response {
  const errorHtml = error
    ? `<div class="error-banner">
         <span class="error-icon">⚠️</span>
         <span>${error}</span>
       </div>`
    : '';

  const lockoutMsg = lockedSeconds > 0
    ? `<div class="lockout-timer">Too many failed attempts. Try again in <span id="sec">${lockedSeconds}</span>s</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MorpheFlow — Gateway Lock</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="alternate icon" type="image/png" href="/favicon.png">
  <link rel="apple-touch-icon" href="/apk-icon.png">
  <style>
    :root {
      --bg-base: #06080b;
      --bg-surface: #0e1218;
      --bg-input: #141922;
      --border-subtle: #1e2633;
      --border-focus: #00d2ff;
      --primary: #00d2ff;
      --primary-hover: #38bdf8;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --danger: #ef4444;
      --radius: 12px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 20%, #111827 0%, var(--bg-base) 80%);
      color: var(--text-main);
      font-family: var(--font);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 50px rgba(0, 210, 255, 0.05);
      width: 100%;
      max-width: 400px;
      padding: 36px 32px;
      text-align: center;
    }
    @media (max-width: 480px) {
      body { padding: 12px; }
      .card { padding: 28px 20px; }
      .logo { width: 72px; height: 72px; }
      h1 { font-size: 1.25rem; }
    }
    .logo {
      width: 90px;
      height: 90px;
      margin: 0 auto 16px;
      display: block;
      filter: drop-shadow(0 0 16px rgba(0, 210, 255, 0.3));
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-bottom: 24px;
    }
    .badge-lock {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 210, 255, 0.1);
      color: var(--primary);
      border: 1px solid rgba(0, 210, 255, 0.25);
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 20px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .input-wrap {
      position: relative;
      margin-bottom: 18px;
    }
    input[type="password"], input[type="text"] {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 13px 44px 13px 14px;
      color: var(--text-main);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(0, 210, 255, 0.15);
    }
    .toggle-pwd {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 1.1rem;
      padding: 4px;
    }
    .toggle-pwd:hover { color: var(--text-main); }
    .btn-submit {
      width: 100%;
      background: linear-gradient(135deg, #00d2ff 0%, #0284c7 100%);
      color: #041019;
      font-weight: 700;
      font-size: 0.95rem;
      padding: 13px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: transform 0.1s ease, filter 0.15s ease;
    }
    .btn-submit:hover:not(:disabled) {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    .btn-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error-banner {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #fca5a5;
      font-size: 0.85rem;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      gap: 8px;
      text-align: left;
    }
    .lockout-timer {
      color: #fbbf24;
      font-size: 0.85rem;
      margin-bottom: 16px;
    }
    .footer-note {
      color: var(--text-muted);
      font-size: 0.75rem;
      margin-top: 24px;
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="card">
    <img src="/trim-logo.png" alt="MorpheFlow Logo" class="logo" onerror="this.src='/logo.png'">
    <div class="badge-lock">🔒 Protected Access</div>
    <h1>MorpheFlow Gateway</h1>
    <p class="subtitle">Single-user console • Enter master password to unlock</p>

    ${errorHtml}
    ${lockoutMsg}

    <form id="loginForm" method="POST" action="/api/auth/login">
      <div class="input-wrap">
        <input type="password" id="pwdInput" name="password" placeholder="Enter master password..." required autofocus ${lockedSeconds > 0 ? 'disabled' : ''}>
        <button type="button" class="toggle-pwd" id="toggleBtn" aria-label="Toggle password visibility">👁️</button>
      </div>
      <button type="submit" class="btn-submit" id="submitBtn" ${lockedSeconds > 0 ? 'disabled' : ''}>Unlock MorpheFlow</button>
    </form>

    <div class="footer-note">MorpheFlow Edge System • Cloudflare Workers isolate</div>
  </div>

  <script>
    const toggleBtn = document.getElementById('toggleBtn');
    const pwdInput = document.getElementById('pwdInput');
    const form = document.getElementById('loginForm');
    const submitBtn = document.getElementById('submitBtn');

    toggleBtn.addEventListener('click', () => {
      pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying...';

      const password = pwdInput.value;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });

        if (res.ok) {
          window.location.href = '/';
        } else {
          const data = await res.json().catch(() => ({}));
          const errMsg = data.error || 'Invalid password';
          window.location.search = '?error=' + encodeURIComponent(errMsg);
        }
      } catch (err) {
        alert('Network connection error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Unlock MorpheFlow';
      }
    });

    // Countdown if locked out
    let locked = ${lockedSeconds};
    if (locked > 0) {
      const secEl = document.getElementById('sec');
      const timer = setInterval(() => {
        locked--;
        if (secEl) secEl.textContent = locked;
        if (locked <= 0) {
          clearInterval(timer);
          window.location.href = window.location.pathname;
        }
      }, 1000);
    }
  </script>
</body>
</html>`;

  return applySecurityHeaders(
    new Response(html, {
      status: lockedSeconds > 0 ? 429 : 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  );
}
