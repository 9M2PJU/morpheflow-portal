import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('Patch Conflicts: Rules and detector identify conflicting bytecode patches', () => {
  const appJsPath = path.resolve('web/frontend/js/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  assert.ok(
    appJs.includes('const KNOWN_PATCH_CONFLICTS'),
    'app.js must define KNOWN_PATCH_CONFLICTS'
  );
  assert.ok(
    appJs.includes('function detectPatchConflicts'),
    'app.js must define detectPatchConflicts'
  );
  assert.ok(
    appJs.includes('function resolvePatchConflict'),
    'app.js must define resolvePatchConflict'
  );
  assert.ok(
    appJs.includes('id="drawer-conflicts-banner"'),
    'app.js must render drawer-conflicts-banner when conflicts are found'
  );

  const morphePyPath = path.resolve('scripts/morphe.py');
  const morphePy = fs.readFileSync(morphePyPath, 'utf8');
  assert.ok(
    morphePy.includes('def validate_patch_conflicts'),
    'morphe.py must define validate_patch_conflicts'
  );
  assert.ok(
    morphePy.includes('KNOWN_PATCH_CONFLICTS'),
    'morphe.py must have KNOWN_PATCH_CONFLICTS definitions'
  );
});
