import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('Deep Links: Formulas generate correct Play Store and APKMirror URLs', () => {
  const appJsPath = path.resolve('web/frontend/js/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  assert.ok(
    appJs.includes('https://play.google.com/store/apps/details?id='),
    'app.js must construct Play Store deep links'
  );
  assert.ok(
    appJs.includes('https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s='),
    'app.js must construct APKMirror search deep links'
  );

  const htmlPath = path.resolve('web/frontend/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(
    html.includes('id="prompt-apk-apkmirror-link"'),
    'Base APK upload modal must have direct APKMirror search button'
  );
});
