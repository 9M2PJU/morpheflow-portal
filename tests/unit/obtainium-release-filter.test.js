import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

function toCaseInsensitiveRegexPattern(str) {
  if (!str) return '';
  return str.split('').map(c => {
    if (/[a-zA-Z]/.test(c)) {
      return `[${c.toLowerCase()}${c.toUpperCase()}]`;
    }
    return c.replace(/([.*+?^${}()|[\]\/\\])/g, '\\$1');
  }).join('');
}

test('Obtainium Filter Algorithm: Formula matches package name or app name case-insensitively', () => {
  const testCases = [
    {
      pkg: 'com.sbs.train',
      appName: 'MacroFactor Workouts',
      realTitle: 'MacroFactor Workouts (com.sbs.train) v1.4.2',
      legacyTitle: 'com.sbs.train (com.sbs.train) v1.4.2',
      otherTitle: 'Chess.com (com.chess) v4.10.0',
      realApk: 'com.sbs.train_1.4.2_v1.2.4_patched.apk',
      otherApk: 'com.sbs.diet_5.8.10_v1.2.4_patched.apk'
    },
    {
      pkg: 'com.google.android.inputmethod.latin',
      appName: 'Gboard',
      realTitle: 'Gboard (com.google.android.inputmethod.latin) v18.5.4.993608717-release-arm64-v8a',
      legacyTitle: 'com.google.android.inputmethod.latin v18.5.4.993608717-release-arm64-v8a',
      otherTitle: 'Tantan (com.tantantribe.tribe) v7.3.6',
      realApk: 'com.google.android.inputmethod.latin_18.5.4.993608717-release-arm64-v8a_v1.3.3_patched.apk',
      otherApk: 'com.google.android.youtube_21.30.216_v2.0.0_patched.apk'
    },
    {
      pkg: 'com.tantantribe.tribe',
      appName: 'Tantan',
      realTitle: 'Tantan (com.tantantribe.tribe) v7.3.6',
      legacyTitle: 'com.tantantribe.tribe (com.tantantribe.tribe) v7.3.6',
      otherTitle: 'Reddit (com.reddit.frontpage) v2026.44.0',
      realApk: 'com.tantantribe.tribe_7.3.6_v1.22.0_patched.apk',
      otherApk: 'com.mixplorer_6.71.15_v1.43.7.1_patched.apk'
    }
  ];

  for (const tc of testCases) {
    const ciPkg = toCaseInsensitiveRegexPattern(tc.pkg);
    const ciName = toCaseInsensitiveRegexPattern(tc.appName);
    const titleRegex = new RegExp(`(${ciPkg}|${ciName})`);
    const apkRegex = new RegExp(`^${ciPkg}_`);
    const versionRegex = /v?([0-9][0-9a-zA-Z._-]+)$/;

    // 1. Must match current friendly release title
    assert.ok(titleRegex.test(tc.realTitle), `Expected "${titleRegex}" to match "${tc.realTitle}"`);

    // 2. Must match legacy package-only release title
    assert.ok(titleRegex.test(tc.legacyTitle), `Expected "${titleRegex}" to match "${tc.legacyTitle}"`);

    // 3. Must REJECT other apps release titles
    assert.strictEqual(titleRegex.test(tc.otherTitle), false, `Expected "${titleRegex}" to reject "${tc.otherTitle}"`);

    // 4. Must match this app's APK filename
    assert.ok(apkRegex.test(tc.realApk), `Expected "${apkRegex}" to match "${tc.realApk}"`);

    // 5. Must REJECT other apps APK filenames
    assert.strictEqual(apkRegex.test(tc.otherApk), false, `Expected "${apkRegex}" to reject "${tc.otherApk}"`);

    // 6. Version extraction regex must extract clean version string
    const match = tc.realTitle.match(versionRegex);
    assert.ok(match && match[1], `Expected version extraction on "${tc.realTitle}"`);
    assert.ok(!match[1].startsWith('v'), `Version "${match[1]}" should not include leading 'v'`);
  }
});

test('Obtainium Filter: Frontend app.js, Worker router.ts, and Python helper use identical formula', () => {
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'web', 'frontend', 'js', 'app.js'), 'utf8');
  const routerTs = fs.readFileSync(path.join(ROOT_DIR, 'worker', 'router.ts'), 'utf8');
  const helperPy = fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'obtainium_link.py'), 'utf8');

  // Verify app.js has updated formula
  assert.match(appJs, /filterReleaseTitlesByRegEx:\s*`\(\$\{ciPkg\}\|\$\{ciName\}\)`/);
  assert.match(appJs, /apkFilterRegEx:\s*`\^\$\{ciPkg\}_`/);
  assert.match(appJs, /releaseTitleAsVersion:\s*true/);
  assert.match(appJs, /versionExtractionRegEx:\s*'v\?\(\[0-9\]\[0-9a-zA-Z\._-\]\+\)\$'/);
  assert.match(appJs, /matchGroupToUse:\s*'1'/);

  // Verify router.ts has updated formula
  assert.match(routerTs, /filterReleaseTitlesByRegEx:\s*`\(\$\{ciPkg\}\|\$\{ciName\}\)`/);
  assert.match(routerTs, /apkFilterRegEx:\s*`\^\$\{ciPkg\}_`/);

  // Verify helperPy uses the same settings
  assert.match(helperPy, /"filterReleaseTitlesByRegEx":\s*f"\(\{ci_pkg\}\|\{ci_name\}\)"/);
  assert.match(helperPy, /"apkFilterRegEx":\s*f"\^\{ci_pkg\}_"/);
});
