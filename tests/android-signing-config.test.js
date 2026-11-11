import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasExpectedSignerDigest, normalizeSha256Fingerprint } from '../scripts/verify-apk-signature.js';

test('Debug build requires and explicitly uses the dedicated local keystore', async () => {
  const [gradle, ignoreRules, example] = await Promise.all([
    readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8'),
    readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
    readFile(new URL('../android/signing.properties.example', import.meta.url), 'utf8')
  ]);

  assert.match(gradle, /rootProject\.file\('signing\.properties'\)/);
  assert.match(gradle, /API_VAULT_SIGNING_STORE_FILE/);
  assert.match(gradle, /API_VAULT_SIGNING_STORE_PASSWORD/);
  assert.match(gradle, /API_VAULT_SIGNING_KEY_ALIAS/);
  assert.match(gradle, /API_VAULT_SIGNING_KEY_PASSWORD/);
  assert.match(gradle, /Missing android\/signing\.properties/);
  assert.match(gradle, /requiredSigningProperties = \['storeFile', 'storePassword', 'keyAlias', 'keyPassword'\]/);
  assert.match(gradle, /if \(!debugKeystoreFile\.isFile\(\)\)/);
  assert.match(gradle, /debug\s*\{\s*signingConfig signingConfigs\.apiVaultDebug\s*\}/);
  assert.match(gradle, /storeType signingProperties\.getProperty\('storeType', 'JKS'\)/);
  assert.match(ignoreRules, /^android\/signing\.properties$/m);
  assert.match(example, /^storeFile=\$\{user\.home\}\/\.android\/api-vault-debug\.jks$/m);
  assert.match(example, /^keyAlias=api-vault-debug$/m);
  assert.match(example, /^storePassword=$/m);
  assert.match(example, /^keyPassword=$/m);
  assert.doesNotMatch(example, /4B:9C:55:B2:5D:56:B6:BD/);
});

test('Actions restores and verifies the dedicated Debug signature without repository secrets', async () => {
  const [workflow, verifier] = await Promise.all([
    readFile(new URL('../.github/workflows/android.yml', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/verify-apk-signature.js', import.meta.url), 'utf8')
  ]);

  for (const secret of [
    'ANDROID_DEBUG_KEYSTORE_BASE64',
    'ANDROID_DEBUG_KEYSTORE_PASSWORD',
    'ANDROID_DEBUG_KEY_ALIAS',
    'ANDROID_DEBUG_KEY_PASSWORD'
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
  assert.match(workflow, /if \[ -z "\$\{!value\}" \]/);
  assert.match(workflow, /Missing required GitHub Secret: \$\{value\}/);
  assert.match(workflow, /RUNNER_TEMP\/api-vault-signing/);
  assert.match(workflow, /base64 --decode/);
  assert.match(workflow, /API_VAULT_SIGNING_STORE_FILE=/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /node scripts\/verify-apk-signature\.js/);
  assert.match(verifier, /4B:9C:55:B2:5D:56:B6:BD:B0:62:9C:4F:32:79:47:17:63:C4:5A:BA:8B:4A:FB:AD:56:9A:0C:F7:DE:9D:FD:22/);
  assert.doesNotMatch(workflow, /android\/signing\.properties/);
  assert.doesNotMatch(workflow, /echo\s+.*ANDROID_DEBUG_KEYSTORE_BASE64/);
});

test('APK certificate verification accepts normalized matching digest and rejects mismatches', () => {
  const expected = '4B:9C:55:B2:5D:56:B6:BD:B0:62:9C:4F:32:79:47:17:63:C4:5A:BA:8B:4A:FB:AD:56:9A:0C:F7:DE:9D:FD:22';
  const apksignerOutput = 'Signer #1 certificate SHA-256 digest: 4b9c55b25d56b6bdb0629c4f3279471763c45aba8b4afbad569a0cf7de9dfd22';

  assert.equal(normalizeSha256Fingerprint(expected), '4B9C55B25D56B6BDB0629C4F3279471763C45ABA8B4AFBAD569A0CF7DE9DFD22');
  assert.equal(hasExpectedSignerDigest(apksignerOutput, expected), true);
  assert.equal(hasExpectedSignerDigest('Signer #1 certificate SHA-256 digest: 00:00', expected), false);
  assert.equal(hasExpectedSignerDigest('no certificate digest found', expected), false);
});
