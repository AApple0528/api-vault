import test from 'node:test';
import assert from 'node:assert/strict';
import { getGroupNameWidth, normalizeHttpUrl, validateGroupName, validateManualSiteUrl } from '../src/site-validation.js';

test('manual URL validation rejects empty, malformed and unsupported protocols', () => {
  assert.deepEqual(validateManualSiteUrl('   '), { valid: false, reason: 'required', url: null });
  for (const value of ['https://', 'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/a', 'ht!tp://example.com']) {
    assert.equal(validateManualSiteUrl(value).valid, false, value);
  }
});

test('manual URL validation adds HTTPS only when no protocol is supplied and keeps explicit HTTP URLs', () => {
  assert.deepEqual(validateManualSiteUrl('example.com'), { valid: true, reason: null, url: 'https://example.com' });
  assert.deepEqual(validateManualSiteUrl('https://example.com'), { valid: true, reason: null, url: 'https://example.com' });
  assert.deepEqual(validateManualSiteUrl('http://example.com'), { valid: true, reason: null, url: 'http://example.com' });
  assert.equal(normalizeHttpUrl('https://example.com:8080/path?a=1'), 'https://example.com:8080/path?a=1');
  assert.equal(normalizeHttpUrl('example.com:8080/path'), 'https://example.com:8080/path');
});

test('group names use display width with grapheme-aware emoji counting', () => {
  assert.equal(getGroupNameWidth('中'.repeat(8)), 16);
  assert.equal(validateGroupName('中'.repeat(8)).valid, true);
  assert.equal(validateGroupName('中'.repeat(9)).valid, false);
  assert.equal(validateGroupName('a'.repeat(16)).valid, true);
  assert.equal(validateGroupName('a'.repeat(17)).valid, false);
  assert.equal(validateGroupName('👨‍👩‍👧‍👦'.repeat(8)).valid, true);
  assert.equal(validateGroupName('👨‍👩‍👧‍👦'.repeat(9)).valid, false);
  assert.equal(validateGroupName('🇨🇳'.repeat(8)).valid, true);
  assert.equal(validateGroupName('🇨🇳'.repeat(9)).valid, false);
  assert.equal(validateGroupName('  abc  ').name, 'abc');
});
