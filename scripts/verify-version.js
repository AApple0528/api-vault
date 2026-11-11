import { readFileSync } from 'node:fs';

const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const version = String(packageInfo.version || '');
const versionCode = Number(packageInfo.androidVersionCode);

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Invalid package version: ${version}`);
}
if (!Number.isSafeInteger(versionCode) || versionCode < 1) {
  throw new Error(`Invalid androidVersionCode: ${packageInfo.androidVersionCode}`);
}
const changelogHasVersion = changelog.split(/\r?\n/).some(line => {
  const heading = line.match(/^##\s+(v\d+\.\d+\.\d+)(?:\s+-.*)?$/);
  return heading?.[1] === `v${version}`;
});
if (!changelogHasVersion) {
  throw new Error(`CHANGELOG.md must contain a heading for v${version}`);
}
if (!gradle.includes("file('../../package.json')") || !gradle.includes('versionCode appVersionCode') || !gradle.includes('versionName appVersion')) {
  throw new Error('Android Gradle must read version and versionCode from the root package.json');
}

const refType = process.env.GITHUB_REF_TYPE;
const refName = process.env.GITHUB_REF_NAME;
const ref = process.env.GITHUB_REF;
const isTagBuild = refType === 'tag' || (typeof ref === 'string' && ref.startsWith('refs/tags/'));
const tag = refName || (isTagBuild ? ref.slice('refs/tags/'.length) : '');
if (isTagBuild && tag !== `v${version}`) {
  throw new Error(`Git tag ${tag} does not match package version v${version}`);
}

console.log(`Version check passed: v${version} (Android versionCode ${versionCode})${isTagBuild ? `, tag ${tag}` : ''}`);
