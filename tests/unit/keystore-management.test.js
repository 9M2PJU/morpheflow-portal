import test from 'node:test';
import assert from 'node:assert/strict';

function sanitizeKeystoreMetadata(ks) {
  if (!ks || !ks.has_custom) {
    return {
      has_custom: false,
      type: 'deterministic',
      alias: 'morpheflow',
      filename: 'morpheflow.keystore',
      description: 'Permanent deterministic keystore active. Builds across all devices match signature.',
    };
  }
  return {
    has_custom: true,
    type: 'custom',
    alias: ks.alias || 'custom',
    filename: ks.filename || 'custom.keystore',
    updated_at: ks.updated_at,
    description: `Custom imported keystore active (${ks.filename || 'custom.keystore'}).`,
  };
}

function validateKeystoreUpload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be an object' };
  }
  if (!payload.data_base64 || typeof payload.data_base64 !== 'string') {
    return { valid: false, error: 'data_base64 is required' };
  }
  const alias = (payload.alias || '').trim() || 'custom';
  const filename = payload.filename || 'custom.keystore';
  return {
    valid: true,
    alias,
    filename,
    keystore_pass: payload.keystore_pass || '',
    key_pass: payload.key_pass || payload.keystore_pass || '',
  };
}

test('Keystore Metadata: Sanitizes default deterministic keystore without leaking credentials', () => {
  const meta = sanitizeKeystoreMetadata(null);
  assert.equal(meta.has_custom, false);
  assert.equal(meta.type, 'deterministic');
  assert.equal(meta.alias, 'morpheflow');
  assert.equal(meta.filename, 'morpheflow.keystore');
  assert.equal('keystore_pass' in meta, false);
  assert.equal('data_base64' in meta, false);
});

test('Keystore Metadata: Sanitizes custom imported keystore with user alias and filename', () => {
  const ks = {
    has_custom: true,
    alias: 'my-revanced-key',
    filename: 'revanced.keystore',
    keystore_pass: 'supersecret',
    key_pass: 'supersecret',
    data_base64: 'QUJDREVGR0g=',
    updated_at: '2026-11-02T12:00:00.000Z',
  };
  const meta = sanitizeKeystoreMetadata(ks);
  assert.equal(meta.has_custom, true);
  assert.equal(meta.type, 'custom');
  assert.equal(meta.alias, 'my-revanced-key');
  assert.equal(meta.filename, 'revanced.keystore');
  assert.equal(meta.updated_at, '2026-11-02T12:00:00.000Z');
  assert.equal('keystore_pass' in meta, false);
  assert.equal('data_base64' in meta, false);
});

test('Keystore Validation: Accepts valid base64 payload and defaults alias to custom', () => {
  const res = validateKeystoreUpload({
    data_base64: 'UEtHREFUQVRFU1Q=',
    filename: 'mykey.jks',
  });
  assert.equal(res.valid, true);
  assert.equal(res.alias, 'custom');
  assert.equal(res.filename, 'mykey.jks');
});

test('Keystore Validation: Rejects empty or missing binary payload', () => {
  assert.equal(validateKeystoreUpload(null).valid, false);
  assert.equal(validateKeystoreUpload({ alias: 'foo' }).valid, false);
  assert.equal(validateKeystoreUpload({ data_base64: '' }).valid, false);
});
