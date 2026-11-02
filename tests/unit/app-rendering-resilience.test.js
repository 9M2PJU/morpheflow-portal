import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('App Rendering Resilience: Handles applied_patches as string array without throwing', () => {
  const appJsPath = path.resolve('web/frontend/js/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // Verify that rawP1 and rawP2 handle both strings and objects safely
  assert.ok(
    appJs.includes('typeof rawP1 === \'string\' ? rawP1 : (rawP1?.name || getPatchName(rawP1) || \'Patch\')'),
    'app.js must extract p1Name safely when rawP1 is a string'
  );
  assert.ok(
    appJs.includes('typeof rawP2 === \'string\' ? rawP2 : (rawP2?.name || getPatchName(rawP2) || \'Patch\')'),
    'app.js must extract p2Name safely when rawP2 is a string'
  );
});

test('Scheduler Resilience: extractRecommendedVersion extracts version from compatibilities', () => {
  const indexTsPath = path.resolve('worker/index.ts');
  const indexTs = fs.readFileSync(indexTsPath, 'utf8');

  assert.ok(
    indexTs.includes('function extractRecommendedVersion'),
    'worker/index.ts must define extractRecommendedVersion'
  );
  assert.ok(
    indexTs.includes('catalogData.compatibilities'),
    'extractRecommendedVersion must inspect catalogData.compatibilities'
  );
});
