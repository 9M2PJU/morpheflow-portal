#!/usr/bin/env node
/**
 * AutoMorph 1-Click Cloudflare Workers Deployment Automation
 *
 * Automates the entire deployment pipeline:
 * 1. Checks Wrangler CLI authentication.
 * 2. Automatically finds or creates the Cloudflare D1 database (`automorph-db`).
 * 3. Auto-pins the real database UUID into `wrangler.toml` and `wrangler.kv.toml`.
 * 4. Automatically creates and pins Cloudflare KV namespace if in KV mode (`--kv`).
 * 5. Applies D1 database schema migrations automatically with zero prompts.
 * 6. Automatically synchronizes secrets (GITHUB_TOKEN, GITHUB_REPO, WEBHOOK_SECRET).
 * 7. Deploys the Worker and outputs your live URL!
 */

const { execSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const WRANGLER_TOML = path.join(ROOT_DIR, 'wrangler.toml');
const WRANGLER_KV_TOML = path.join(ROOT_DIR, 'wrangler.kv.toml');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const DB_NAME = 'automorph-db';

const isKvMode = process.argv.includes('--kv');
const targetConfig = isKvMode ? 'wrangler.kv.toml' : 'wrangler.toml';

function log(emoji, msg) {
  console.log(`\x1b[36m${emoji}\x1b[0m \x1b[1m${msg}\x1b[0m`);
}

function success(msg) {
  console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
}

function warn(msg) {
  console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
}

function run(cmd, options = {}) {
  return execSync(cmd, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: options.stdio || ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}

function parseDotEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      env[key] = val;
    }
  }
  return env;
}

function checkAuth() {
  log('🔑', 'Checking Cloudflare authentication...');
  try {
    const whoami = run('npx wrangler whoami');
    if (whoami.includes('You are logged in') || whoami.includes('Account Name') || whoami.includes('Account ID')) {
      success('Authenticated with Cloudflare.');
      return;
    }
  } catch (err) {
    // Check if token in environment
    if (process.env.CLOUDFLARE_API_TOKEN) {
      success('Using CLOUDFLARE_API_TOKEN from environment.');
      return;
    }
  }

  warn('Wrangler is not logged in. Launching Cloudflare browser login...');
  spawnSync('npx', ['wrangler', 'login'], { cwd: ROOT_DIR, stdio: 'inherit' });
}

function getOrPinDatabaseId() {
  log('🗄️', `Ensuring D1 Database "${DB_NAME}"...`);

  // 1. Check if already pinned with a real UUID (36 chars)
  const currentToml = fs.readFileSync(WRANGLER_TOML, 'utf8');
  const match = currentToml.match(/database_id\s*=\s*"([0-9a-fA-F-]{36})"/);
  if (match) {
    const dbId = match[1];
    success(`D1 Database ID already pinned: ${dbId}`);
    return dbId;
  }

  // 2. Query existing D1 databases on account
  let targetId = null;
  try {
    const listRaw = run('npx wrangler d1 list --json');
    const dbs = JSON.parse(listRaw);
    const existing = dbs.find((d) => d.name === DB_NAME);
    if (existing && existing.uuid) {
      targetId = existing.uuid;
      success(`Found existing D1 database "${DB_NAME}" (${targetId})`);
    }
  } catch (err) {
    warn(`Could not query existing D1 databases: ${err.message}`);
  }

  // 3. Create if not found
  if (!targetId) {
    log('➕', `Creating new D1 database "${DB_NAME}"...`);
    try {
      const createOut = run(`npx wrangler d1 create ${DB_NAME}`);
      const idMatch = createOut.match(/database_id\s*=\s*"([0-9a-fA-F-]{36})"/);
      if (idMatch) {
        targetId = idMatch[1];
        success(`Successfully created D1 database "${DB_NAME}" (${targetId})`);
      } else {
        // Fallback: re-query list
        const listRaw = run('npx wrangler d1 list --json');
        const dbs = JSON.parse(listRaw);
        const newlyCreated = dbs.find((d) => d.name === DB_NAME);
        if (newlyCreated && newlyCreated.uuid) {
          targetId = newlyCreated.uuid;
        }
      }
    } catch (err) {
      warn(`Notice during database creation: ${err.message}`);
    }
  }

  // 4. Pin ID into toml files
  if (targetId) {
    for (const tomlFile of [WRANGLER_TOML, WRANGLER_KV_TOML]) {
      if (fs.existsSync(tomlFile)) {
        let content = fs.readFileSync(tomlFile, 'utf8');
        content = content.replace(
          /database_id\s*=\s*"[^"]*"/,
          `database_id = "${targetId}"`
        );
        fs.writeFileSync(tomlFile, content);
      }
    }
    success(`Pinned database_id = "${targetId}" in wrangler configurations.`);
  } else {
    warn('Could not auto-resolve database ID. Worker will use schema auto-init on first request.');
  }

  return targetId;
}

function ensureKv() {
  if (!isKvMode) return;
  log('📦', 'Ensuring Cloudflare KV namespace for zero-card storage...');
  try {
    require('./ensure-kv.cjs');
    success('KV Namespace verified and pinned.');
  } catch (err) {
    warn(`Notice during KV check: ${err.message}`);
  }
}

function applyMigrations(dbId) {
  log('⚡', 'Applying D1 database migrations...');
  try {
    const child = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', DB_NAME, '--remote'], {
      cwd: ROOT_DIR,
      input: 'y\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (child.status === 0) {
      success('D1 migrations applied.');
    } else {
      // Migrations may already be applied or tables exist; Worker schema auto-init handles fallback
      warn(`Migrations notice: ${child.stderr || child.stdout || 'Already up to date.'}`);
    }
  } catch (err) {
    warn(`Skipping manual migrations step (${err.message}). Worker will auto-initialize schema.`);
  }
}

function syncSecrets() {
  log('🔒', 'Configuring Worker secrets...');
  const env = parseDotEnv();

  // 1. Webhook Secret (auto-generate if missing)
  let webhookSecret = env.WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    webhookSecret = crypto.randomBytes(16).toString('hex');
    log('✨', `Generated secure random WEBHOOK_SECRET: ${webhookSecret}`);
    try {
      if (fs.existsSync(ENV_FILE)) {
        fs.appendFileSync(ENV_FILE, `\nWEBHOOK_SECRET=${webhookSecret}\n`);
      }
    } catch {}
  }

  const setSecret = (name, val) => {
    try {
      const args = isKvMode ? ['wrangler', 'secret', 'put', name, '-c', 'wrangler.kv.toml'] : ['wrangler', 'secret', 'put', name];
      const res = spawnSync('npx', args, {
        cwd: ROOT_DIR,
        input: `${val}\n`,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (res.status === 0) {
        success(`Set secret: ${name}`);
      }
    } catch (err) {
      warn(`Could not set secret ${name}: ${err.message}`);
    }
  };

  if (webhookSecret) setSecret('WEBHOOK_SECRET', webhookSecret);

  // 2. GitHub Token and Repo (if provided)
  const ghToken = env.GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  const ghRepo = env.GITHUB_REPOSITORY || env.GITHUB_REPO || process.env.GITHUB_REPOSITORY || process.env.GITHUB_REPO;

  if (ghToken) setSecret('GITHUB_TOKEN', ghToken);
  if (ghRepo) setSecret('GITHUB_REPO', ghRepo);

  return { webhookSecret, ghRepo, ghToken };
}

function deployWorker() {
  log('🚀', `Deploying AutoMorph to Cloudflare Workers using ${targetConfig}...`);

  const args = ['wrangler', 'deploy'];
  if (isKvMode) {
    args.push('-c', 'wrangler.kv.toml');
  }

  const res = spawnSync('npx', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (res.status !== 0) {
    throw new Error(`wrangler deploy failed with exit code ${res.status}`);
  }

  success('AutoMorph deployment completed!');
}

function printSummary(secrets) {
  console.log('\n' + '='.repeat(64));
  console.log('  🎉  AutoMorph Cloudflare Workers Deployment Successful!  🎉');
  console.log('='.repeat(64));
  console.log('\n📌 Configuration Summary:');
  console.log(`   • Mode:        ${isKvMode ? 'Zero-Card KV Mode (wrangler.kv.toml)' : 'Standard D1 Mode (wrangler.toml)'}`);
  console.log(`   • Database:    Cloudflare D1 (${DB_NAME})`);
  console.log(`   • Static UI:   Workers Static Assets (web/frontend)`);
  console.log(`   • Schedule:    Daily Cron Trigger (0 3 * * *)`);

  console.log('\n🔐 Next Step: GitHub Actions Secrets (for Free Cloud Builds)');
  console.log('   In your GitHub repository (Settings > Secrets and variables > Actions):');
  console.log(`   • CLOUDFLARE_WORKER_URL = https://automorph.<your-subdomain>.workers.dev`);
  if (secrets.webhookSecret) {
    console.log(`   • WEBHOOK_SECRET        = ${secrets.webhookSecret}`);
  }
  console.log('\n📖 Full documentation: docs/cloudflare-workers-setup.md\n');
}

function main() {
  console.log('\n🤖 AutoMorph Automated Cloudflare Deployer\n');
  try {
    checkAuth();
    const dbId = getOrPinDatabaseId();
    ensureKv();
    applyMigrations(dbId);
    const secrets = syncSecrets();
    deployWorker();
    printSummary(secrets);
  } catch (err) {
    console.error('\n\x1b[31m✖ Deployment failed:\x1b[0m', err.message);
    process.exit(1);
  }
}

main();
