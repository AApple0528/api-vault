import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('site URL errors are shown inline and block save without replacing the entered value', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const saveStart = source.indexOf('function saveSite()');
  const saveEnd = source.indexOf('function openGroupModal()', saveStart);
  const saveSite = source.slice(saveStart, saveEnd);

  assert.match(html, /id="form-url-error"[^>]*role="alert"/);
  assert.match(html, /oninput="clearSiteUrlError\(\)"/);
  assert.match(saveSite, /validateManualSiteUrl\(urlInput\.value\)/);
  assert.match(saveSite, /请输入网址/);
  assert.match(saveSite, /网址格式不正确/);
  assert.match(saveSite, /if \(!urlResult\.valid\) return;/);
  assert.ok(saveSite.indexOf('if (!urlResult.valid) return;') < saveSite.indexOf('saveToStorage('));
  assert.match(source, /const safeUrl = normalizeHttpUrl\(site\.url\);/);
  assert.match(source, /if \(!safeUrl\) return false;/);
});

test('site names are kept intact for editing and only truncated by list layout', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /id="form-name" type="text"(?![^>]*maxlength)/);
  assert.match(source, /<span class="truncate min-w-0">\$\{escapeHtml\(site\.name\)\}<\/span>/);
  assert.match(source, /title="\$\{escapeHtml\(site\.name\)\}"/);
  assert.match(source, /const name = document\.getElementById\('form-name'\)\.value\.trim\(\)/);
});
