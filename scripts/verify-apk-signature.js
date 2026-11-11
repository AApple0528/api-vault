import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function normalizeSha256Fingerprint(value) {
  return String(value).replace(/[^a-f\d]/gi, '').toUpperCase();
}

export function hasExpectedSignerDigest(apksignerOutput, expectedFingerprint) {
  const match = String(apksignerOutput).match(/certificate SHA-256 digest:\s*([a-f\d:]+)/i);
  return Boolean(match) && normalizeSha256Fingerprint(match[1]) === normalizeSha256Fingerprint(expectedFingerprint);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [apkPath, apksignerPath] = process.argv.slice(2);
  const expectedFingerprint = '4B:9C:55:B2:5D:56:B6:BD:B0:62:9C:4F:32:79:47:17:63:C4:5A:BA:8B:4A:FB:AD:56:9A:0C:F7:DE:9D:FD:22';
  if (!apkPath || !apksignerPath) {
    console.error('Usage: node scripts/verify-apk-signature.js <apk-path> <apksigner-path>');
    process.exitCode = 2;
  } else {
    try {
      const output = execFileSync(apksignerPath, ['verify', '--print-certs', apkPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (!hasExpectedSignerDigest(output, expectedFingerprint)) throw new Error('Certificate fingerprint mismatch');
      console.log('Debug APK signature fingerprint matches the dedicated certificate.');
    } catch {
      console.error('Debug APK signature verification failed.');
      process.exitCode = 1;
    }
  }
}
