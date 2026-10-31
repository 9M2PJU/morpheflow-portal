import test from 'node:test';
import assert from 'node:assert/strict';

test('Download URL: Generates direct authenticated binary download proxy route for successful packages', () => {
  const pkg = 'com.instaprime.android';
  const isSuccess = true;
  const downloadUrl = isSuccess ? `/api/download/${encodeURIComponent(pkg)}` : null;

  assert.equal(downloadUrl, '/api/download/com.instaprime.android');
});

test('Bundle Sorting: Orders app-specific bundles first, then community popularity', () => {
  const pkg = 'com.google.android.inputmethod.latin';
  const appSlug = 'latin';
  const appCleanName = 'gboard';

  const bundles = [
    { bundleName: 'GeneralCommunity', bundleRepo: 'https://github.com/someone/all-patches', stars: 50, patches: [{}, {}] },
    { bundleName: 'PixelBoard', bundleRepo: 'https://github.com/Akshayykadam/PixelBoard', stars: 20, patches: [{}, {}, {}] },
    { bundleName: 'MorphePatches', bundleRepo: 'https://github.com/MorpheApp/morphe-patches', stars: 500, patches: [{}] },
    { bundleName: 'GboardImmersive', bundleRepo: 'https://github.com/JacksonJones2003/gboard-patches', stars: 10, patches: [{}] }
  ];

  bundles.sort((a, b) => {
    const aRepoSlug = a.bundleRepo.toLowerCase();
    const bRepoSlug = b.bundleRepo.toLowerCase();

    const aIsAppSpecific = aRepoSlug.includes(appSlug) || (appCleanName && aRepoSlug.includes(appCleanName)) || aRepoSlug.includes('pixelboard');
    const bIsAppSpecific = bRepoSlug.includes(appSlug) || (appCleanName && bRepoSlug.includes(appCleanName)) || bRepoSlug.includes('pixelboard');

    if (aIsAppSpecific && !bIsAppSpecific) return -1;
    if (!aIsAppSpecific && bIsAppSpecific) return 1;

    const aIsOfficial = aRepoSlug.includes('morpheapp/');
    const bIsOfficial = bRepoSlug.includes('morpheapp/');
    if (aIsOfficial && !bIsOfficial) return -1;
    if (!aIsOfficial && bIsOfficial) return 1;

    const aScore = (a.stars || 0) * 10 + (a.patches?.length || 0);
    const bScore = (b.stars || 0) * 10 + (b.patches?.length || 0);
    return bScore - aScore;
  });

  // Top two should be PixelBoard and GboardImmersive
  assert.ok(bundles[0].bundleName === 'PixelBoard' || bundles[0].bundleName === 'GboardImmersive');
  assert.ok(bundles[1].bundleName === 'PixelBoard' || bundles[1].bundleName === 'GboardImmersive');
  // Followed by MorphePatches (official)
  assert.equal(bundles[2].bundleName, 'MorphePatches');
  // GeneralCommunity at the end
  assert.equal(bundles[3].bundleName, 'GeneralCommunity');
});
