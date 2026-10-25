#!/usr/bin/env node
/**
 * AutoMorph Cloudflare KV Provisioner (modeled after NodeWarden)
 * Makes `deploy:kv` idempotent across repeated builds on Cloudflare Workers.
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = path.resolve(__dirname, '..', 'wrangler.kv.toml');
const BINDING = 'STATE_KV';

const wrangler = (args) =>
  execSync(`npx wrangler ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function bindingBlockHasId(toml) {
  const blocks = toml.match(/\[\[kv_namespaces\]\][^[]*/g) || [];
  const block = blocks.find((entry) => new RegExp(`binding\\s*=\\s*"${BINDING}"`).test(entry));
  return block ? /^\s*id\s*=/m.test(block) : false;
}

function expectedTitle(toml) {
  const name = (toml.match(/^\s*name\s*=\s*"([^"]+)"/m) || [])[1] || 'automorph';
  return `${name}-${BINDING.toLowerCase().replace(/_/g, '-')}`;
}

function resolveId(title) {
  const list = JSON.parse(wrangler('kv namespace list'));
  const hit =
    list.find((namespace) => namespace.title === title) ||
    list.find((namespace) => typeof namespace.title === 'string' && namespace.title.endsWith('state-kv'));
  if (hit) {
    console.log(`[ensure-kv] Reusing existing namespace "${hit.title}" (${hit.id})`);
    return hit.id;
  }

  const out = wrangler(`kv namespace create "${title}"`);
  const id = (out.match(/id\s*=\s*"([0-9a-fA-F]{32})"/) || [])[1];
  if (!id) throw new Error(`[ensure-kv] Could not parse new namespace id from:\n${out}`);
  console.log(`[ensure-kv] Created namespace "${title}" (${id})`);
  return id;
}

function main() {
  if (!fs.existsSync(CONFIG)) {
    console.log(`[ensure-kv] ${CONFIG} does not exist, skipping`);
    return;
  }
  let toml = fs.readFileSync(CONFIG, 'utf8');
  if (bindingBlockHasId(toml)) {
    console.log(`[ensure-kv] ${BINDING} already pinned in wrangler.kv.toml; nothing to do`);
    return;
  }

  try {
    const id = resolveId(expectedTitle(toml));
    toml = toml.replace(
      new RegExp(`(\\[\\[kv_namespaces\\]\\]\\s*\\n\\s*binding\\s*=\\s*"${BINDING}")`),
      `$1\nid = "${id}"`
    );
    fs.writeFileSync(CONFIG, toml);
    console.log('[ensure-kv] Pinned namespace ID into wrangler.kv.toml for this build');
  } catch (err) {
    console.warn(`[ensure-kv] Warning: Could not auto-pin KV namespace: ${err.message}`);
  }
}

main();
