import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, APP_VERSION_LABEL, ANDROID_VERSION_CODE } from '../src/app-version.js';
import { findReleaseNotes, parseChangelog } from '../src/changelog-parser.js';

test('package metadata is the source for UI, backup and Android version values', async () => {
  const [packageJson, gradle, main, html] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8')
  ]);

  assert.equal(APP_VERSION, packageJson.version);
  assert.equal(packageJson.version, '0.3.6');
  assert.equal(packageJson.androidVersionCode, 4);
  assert.equal(APP_VERSION_LABEL, `v${packageJson.version}`);
  assert.equal(ANDROID_VERSION_CODE, packageJson.androidVersionCode);
  assert.match(gradle, /file\('\.\.\/\.\.\/package\.json'\)/);
  assert.match(gradle, /versionCode appVersionCode/);
  assert.match(gradle, /versionName appVersion/);
  assert.match(main, /JSON\.stringify\(\{ version: APP_VERSION,/);
  assert.match(main, /getLatestReleaseNotes\(APP_VERSION_LABEL\)/);
  assert.match(html, /id="app-version"/);
  assert.match(html, /id="changelog-content"/);
});

test('changelog parser returns the matching release actual notes and version', async () => {
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const releases = parseChangelog(changelog);
  const latest = findReleaseNotes(changelog, APP_VERSION_LABEL);

  assert.equal(releases[0].version, APP_VERSION_LABEL);
  assert.equal(latest.version, APP_VERSION_LABEL);
  assert.ok(latest.changes.length > 0);
  assert.ok(latest.changes.some(change => change.includes('置顶')));
});

test('version validation accepts the matching release tag for the prepared version', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = fileURLToPath(new URL('../scripts/verify-version.js', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: APP_VERSION_LABEL }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /v0\.3\.6.*versionCode 4/);
});

test('release version verification rejects a tag that differs from package.json', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = fileURLToPath(new URL('../scripts/verify-version.js', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.3.5' }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match package version v0\.3\.6/);
});
