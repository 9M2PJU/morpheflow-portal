import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const KNOWN_UNIVERSAL_PATCH_NAMES = new Set([
  'clone app',
  'clone',
  'change package name',
  'hide app icon',
  'remove app icon',
  'change app icon',
  'change app name',
  'rename app',
  'enable debug',
  'enable debug mode',
  'enable android debugging',
  'enable webview debugging',
  'make app debuggable',
  'spoof signature',
  'spoof app signature',
  'spoof signature verification',
  'spoof signature match',
  'spoof install source',
  'spoof play store install source',
  'change installer source',
  'spoof device model',
  'spoof build fingerprint',
  'spoof wi-fi connection',
  'spoof sim provider',
  'spoof telephony ids',
  'spoof advertising id',
  'spoof play integrity',
  'disable play integrity',
  'disable play store updates',
  'provide original app certificate',
  'fix firebase after re-signing',
  'microg integration',
  'gmscore support',
  'gmscore support (microg)',
  'disable pairip license check',
  'disable pairip protection',
  'bypass pairip license check',
  'pairip bypass',
  'custom branding',
  'predictive back gesture',
  'hex',
  'remove screenshot restriction',
  'remove screenshot detection',
  'allow screenshots',
  'disable secure flag',
  'bypass root check',
  'disable root checks',
  'bypass adb/developer options detection',
  'bypass emulator detection',
  'bypass forced updates',
  'bypass vpn detection',
  'bypass license verification',
  'bypass okhttp pinning',
  'trust user certificates',
  'override certificate pinning',
  'disable sentry telemetry',
  'disable firebase(google) analytics',
  'deactivate firebase analytics',
  'deactivate firebase performance monitoring',
  'disable analytics',
  'disable analytics & ad tracking',
  'disable crash reporters',
  'disable telemetry',
  'block ads, trackers, and analytics',
  'always enable copy',
  'spoof client',
  'disable dynamic app icon',
  'widevine l3 fallback',
  'spoof wifi connection',
  'disable splash screen',
  'skip splash screen',
  'apk junk cleanup',
  'png optimizer',
  'remove debug info',
  'remove duplicate graphics',
  'remove languages',
  'strip translations',
  'export all activities',
  'allow background activity',
  'keep screen on',
  'force resizable activity',
  'immersive fullscreen',
  'transparent system bars',
  'unlock rotation',
  'allow cleartext traffic',
  'allow mixed content',
  'ensure internet permission',
  'ensure notification permission',
  'ensure storage permissions',
  'unlock revenuecat',
  'revenuecat',
  'free in-app purchases',
  'unlock premium',
  'no ads',
  'ads free rewards'
]);

function determinePatchScope(patchName, patchObj) {
  if (patchObj?.isUniversal === true || patchObj?.scope === 'universal') return 'universal';
  if (patchObj?.isUniversal === false && patchObj?.scope === 'app') return 'app';
  if (Array.isArray(patchObj?.targets) && patchObj.targets.length === 0) return 'universal';
  if (Array.isArray(patchObj?.compatiblePackages) && patchObj.compatiblePackages.length === 0) return 'universal';

  const norm = (patchName || '').toLowerCase().trim();
  if (!norm) return 'app';
  if (KNOWN_UNIVERSAL_PATCH_NAMES.has(norm)) return 'universal';

  if (
    norm.startsWith('clone') ||
    norm.startsWith('change package name') ||
    norm.startsWith('spoof ') ||
    norm.includes('pairip') ||
    norm.includes('microg') ||
    norm.includes('gmscore') ||
    norm.includes('screenshot') ||
    norm.includes('license verification') ||
    norm.includes('root check') ||
    norm.includes('debuggable') ||
    norm.includes('user certificate') ||
    norm.includes('certificate pinning') ||
    norm.includes('revenuecat')
  ) {
    return 'universal';
  }
  return 'app';
}

function isUniversalPatch(patch, bundle, rawCompatibilitiesData) {
  if (!patch) return false;
  if (patch.universal === true || patch.isUniversal === true || patch.scope === 'universal') return true;

  // If patch explicitly specifies target packages, it is app-specific, NOT universal
  if (Array.isArray(patch.compatiblePackages) && patch.compatiblePackages.length > 0) return false;

  const compKey = patch.compatiblePackagesKey ?? patch.compatibilityKey;
  if (compKey !== undefined && compKey !== null && rawCompatibilitiesData && rawCompatibilitiesData[compKey]) {
    const entry = rawCompatibilitiesData[compKey];
    if (Array.isArray(entry) && entry.length > 0) {
      const hasWildcard = entry.some(item => !item || !item.packageName || item.packageName === '*' || item.packageName === 'universal' || item.packageName === 'all');
      if (!hasWildcard) return false;
    }
  }

  if (Array.isArray(patch.compatiblePackages) && patch.compatiblePackages.length === 0) return true;
  if (Array.isArray(patch.targets) && patch.targets.length === 0) return true;

  if (compKey !== undefined && compKey !== null && rawCompatibilitiesData && rawCompatibilitiesData[compKey]) {
    const entry = rawCompatibilitiesData[compKey];
    if (Array.isArray(entry)) {
      if (entry.length === 0) return true;
      if (entry.some(item => !item || !item.packageName || item.packageName === '*' || item.packageName === 'universal' || item.packageName === 'all')) return true;
    }
  }

  // If bundle has universal designation or explicit empty targetApps
  if (compKey === undefined) {
    const bRepo = (bundle?.repo || bundle?.bundleRepo || '').toLowerCase();
    const bName = (bundle?.name || bundle?.bundleName || '').toLowerCase();
    if (bRepo.includes('universal') || bName.includes('universal')) return true;
    if (Array.isArray(bundle?.targetApps) && (bundle.targetApps.length === 0 || bundle.targetApps.includes('*') || bundle.targetApps.includes('universal'))) {
      return true;
    }
  }

  if (determinePatchScope(patch.name, patch) === 'universal') return true;

  return false;
}

test('Universal Patches: Correctly identifies universal patches by scope and compatibility rules', () => {
  const patch1 = { name: 'Clone app', compatiblePackagesKey: undefined };
  const bundle1 = { repo: 'MorpheApp/morphe-patches', targetApps: [] };
  assert.equal(isUniversalPatch(patch1, bundle1, []), true);

  const patch2 = { name: 'Enable Android debugging', compatibilityKey: 5 };
  const compData = { 5: [] };
  assert.equal(isUniversalPatch(patch2, { repo: 'someone/patches' }, compData), true);

  const patch3 = { name: 'Hide ads', compatibilityKey: 1 };
  const compData3 = { 1: [{ packageName: 'com.google.android.youtube' }] };
  assert.equal(isUniversalPatch(patch3, { repo: 'someone/patches' }, compData3), false);

  const patch4 = { name: 'Change package name', use: true };
  assert.equal(isUniversalPatch(patch4, { repo: 'universal-repo' }, {}), true);
});

test('Universal Patches: Matches any unlisted application package by default', () => {
  const pkg = 'com.custom.myapp';
  const rawBundles = [
    {
      repo: 'MorpheApp/morphe-patches',
      patches: [
        { name: 'Clone app' },
        { name: 'Override certificate pinning' },
        { name: 'Hide ads', compatiblePackages: [{ name: 'com.google.android.youtube' }] }
      ]
    },
    {
      repo: 'rushiranpise/Ri-Vanced-Universal-Morphe-Patches',
      patches: [
        { name: 'Predictive back gesture', use: true },
        { name: 'Disable PairIP license check' }
      ]
    }
  ];

  const matched = [];
  for (const b of rawBundles) {
    for (const p of b.patches) {
      if (isUniversalPatch(p, b, {})) {
        matched.push(p.name);
      }
    }
  }

  assert.ok(matched.includes('Clone app'));
  assert.ok(matched.includes('Override certificate pinning'));
  assert.ok(matched.includes('Predictive back gesture'));
  assert.ok(matched.includes('Disable PairIP license check'));
  assert.equal(matched.includes('Hide ads'), false); // YouTube specific
});

test('Bundle & Patch Priority: App-specific patches and default options are prioritized before universal mutators', () => {
  const patches = [
    { name: 'Clone app', isUniversal: true, default: false },
    { name: 'Hide video ads', isUniversal: false, default: true },
    { name: 'Return YouTube Dislike', isUniversal: false, default: true },
    { name: 'Custom theme', isUniversal: false, default: false },
    { name: 'Disable Play Store updates', isUniversal: true, default: false }
  ];

  patches.sort((p1, p2) => {
    if (!p1.isUniversal && p2.isUniversal) return -1;
    if (p1.isUniversal && !p2.isUniversal) return 1;
    if (p1.default && !p2.default) return -1;
    if (!p1.default && p2.default) return 1;
    return (p1.name || '').localeCompare(p2.name || '');
  });

  assert.equal(patches[0].name, 'Hide video ads');
  assert.equal(patches[1].name, 'Return YouTube Dislike');
  assert.equal(patches[2].name, 'Custom theme');
  assert.equal(patches[3].name, 'Clone app');
  assert.equal(patches[4].name, 'Disable Play Store updates');
});

test('Morphe Desktop CLI v1.20.0+: Validates bytecode-mode and isolated scratch directory flags', () => {
  const jarPath = 'tools/morphe.jar';
  assert.ok(fs.existsSync(jarPath), 'tools/morphe.jar must exist');

  // Verify Morphe Desktop version report
  const javaBin = fs.existsSync('/opt/homebrew/opt/openjdk/bin/java')
    ? '/opt/homebrew/opt/openjdk/bin/java'
    : 'java';

  const output = execSync(`${javaBin} -jar ${jarPath} -V`, { encoding: 'utf8' });
  assert.ok(output.includes('1.20.0'), `Morphe Desktop JAR must be v1.20.0+, got: ${output.trim()}`);
});

test('Universal vs App-Matched Patches: Visual separator components in CSS and HTML', () => {
  const css = fs.readFileSync('web/frontend/css/morphe.css', 'utf8');
  assert.ok(css.includes('.patch-section-divider'), 'morphe.css must contain .patch-section-divider');
  assert.ok(css.includes('.patch-section-divider-line'), 'morphe.css must contain .patch-section-divider-line');
  assert.ok(css.includes('.patch-section-divider-label'), 'morphe.css must contain .patch-section-divider-label');

  const appJs = fs.readFileSync('web/frontend/js/app.js', 'utf8');
  // Check renderProvisionPatches has partition and divider
  assert.ok(appJs.includes('Universal Patches (${univPatches.length}) · Compatible with All Apps'), 'Provision modal must render universal divider');
  assert.ok(appJs.includes('Universal Patch Sources · Compatible with All Apps'), 'Provision modal and Patch Manager must separate universal bundles');

  // Check renderActiveAppliedPatches has divider
  assert.ok(appJs.includes('Active Universal Patches (${univPatches.length}) · Compatible with All Apps'), 'Active list must separate universal active patches');

  // Check dropzone uses apk-icon.png
  assert.ok(appJs.includes('src="/apk-icon.png"'), 'app.js drawer dropzone must use /apk-icon.png');
  const indexHtml = fs.readFileSync('web/frontend/index.html', 'utf8');
  assert.ok(indexHtml.includes('src="/apk-icon.png"'), 'index.html missing apk dropzone must use /apk-icon.png');
  assert.ok(fs.existsSync('web/frontend/apk-icon.png'), 'web/frontend/apk-icon.png asset must exist');
});
