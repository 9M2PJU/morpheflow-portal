import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function cleanAnsi(text) {
  let cleanText = typeof text === 'string' ? text : String(text || '');
  return cleanText
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
    .replace(/\^\[\[[0-9;]*m/g, '');
}

function buildProvisionOptions(pkg, patches, defaultRepo) {
  const options = {};
  for (const p of patches) {
    const pName = typeof p === 'string' ? p.trim() : (p.name || '').trim();
    if (!pName) continue;
    const pRepo = (typeof p === 'object' && (p.repo || p.repo_url)) ? String(p.repo || p.repo_url).trim() : defaultRepo;
    const cleanRepo = pRepo.replace(/https?:\/\/github\.com\//, '').replace(/\/+$/, '');
    const parts = cleanRepo.split('/');
    const owner = parts[0] || 'default';

    if (!options[owner]) {
      options[owner] = {
        meta: { package: pkg, repo: pRepo },
        patches: {},
      };
    }
    options[owner].patches[pName] = { enabled: true };
  }
  return options;
}

describe('Pipeline Logs & Provisioning Unit Tests', () => {
  it('cleanAnsi successfully strips color codes and escape sequences', () => {
    const rawAnsi = '\x1b[36;1mmkdir -p apps/original\x1b[0m';
    assert.equal(cleanAnsi(rawAnsi), 'mkdir -p apps/original');

    const githubBashAnsi = '^[[36;1mpython scripts/main.py^[[0m';
    assert.equal(cleanAnsi(githubBashAnsi), 'python scripts/main.py');

    const plainLog = '[✓] Download complete for MorpheApp';
    assert.equal(cleanAnsi(plainLog), '[✓] Download complete for MorpheApp');
  });

  it('buildProvisionOptions correctly maps selected patches into Morphe options format with enabled: true', () => {
    const pkg = 'com.google.android.inputmethod.latin';
    const patches = [
      { name: 'Enable Monet theme', repo: 'https://github.com/Akshayykadam/PixelBoard' },
      { name: 'Remove search bar icon', repo: 'https://github.com/Akshayykadam/PixelBoard' },
    ];
    const opts = buildProvisionOptions(pkg, patches, 'https://github.com/Akshayykadam/PixelBoard');

    assert.ok(opts['Akshayykadam']);
    assert.equal(opts['Akshayykadam'].meta.package, pkg);
    assert.equal(opts['Akshayykadam'].patches['Enable Monet theme'].enabled, true);
    assert.equal(opts['Akshayykadam'].patches['Remove search bar icon'].enabled, true);
  });
});
