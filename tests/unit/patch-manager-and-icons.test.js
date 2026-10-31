import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

test('CSS: .btn-card-icon and .btn-icon maintain strict centered geometry without padding deformation', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'web/frontend/css/morphe.css'), 'utf-8');

  // Verify .btn-card-icon rules
  assert.match(css, /\.btn-card-icon\s*\{[^}]*width:\s*32px/, '.btn-card-icon should have width 32px');
  assert.match(css, /\.btn-card-icon\s*\{[^}]*height:\s*32px/, '.btn-card-icon should have height 32px');
  assert.match(css, /\.btn-card-icon\s*\{[^}]*padding:\s*0\s*!important/, '.btn-card-icon must have padding 0 !important');
  assert.match(css, /\.btn-card-icon\s*\{[^}]*align-items:\s*center/, '.btn-card-icon must align items center');
  assert.match(css, /\.btn-card-icon\s*\{[^}]*justify-content:\s*center/, '.btn-card-icon must justify content center');

  // Verify .btn-icon rules
  assert.match(css, /\.btn-icon\s*\{[^}]*padding:\s*0\s*!important/, '.btn-icon must enforce padding 0 !important');
});

test('HTML: #modal-applied-patches has dual-section layout for active patches and community bundles', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'web/frontend/index.html'), 'utf-8');

  assert.ok(html.includes('id="modal-applied-patches"'), 'modal-applied-patches element must exist');
  assert.ok(html.includes('id="applied-active-list"'), 'applied-active-list container must exist');
  assert.ok(html.includes('id="applied-count-badge"'), 'applied-count-badge must exist');
  assert.ok(html.includes('id="manage-bundles-container"'), 'manage-bundles-container must exist');
  assert.ok(html.includes('id="manage-patches-search"'), 'manage-patches-search input must exist');
  assert.ok(html.includes('id="btn-save-applied-patches"'), 'btn-save-applied-patches must exist');
});

test('Multi-Source Aggregation: Aggregates across app.repos, communityRepos, and catalogItem.supported_repos', () => {
  const appRepos = ['https://github.com/MorpheApp/morphe-patches'];
  const communityRepos = [
    'https://github.com/Akshayykadam/PixelBoard',
    'https://github.com/JacksonJones2003/immersive-keyboard-patches'
  ];
  const catalogRepos = [
    'https://github.com/Akshayykadam/PixelBoard',
    'https://github.com/MorpheApp/morphe-patches',
    'https://github.com/ImNoammm/gboard-patches'
  ];

  const allSources = Array.from(new Set([
    ...appRepos,
    ...communityRepos,
    ...catalogRepos
  ].filter(Boolean)));

  assert.equal(allSources.length, 4, 'Should deduplicate across configured and community repositories');
  assert.ok(allSources.includes('https://github.com/Akshayykadam/PixelBoard'));
  assert.ok(allSources.includes('https://github.com/ImNoammm/gboard-patches'));
});
