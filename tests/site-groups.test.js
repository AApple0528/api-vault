import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCustomGroups, resolveSiteGroup } from '../src/site-groups.js';

test('sign-in status labels are removed from custom groups without discarding other groups', () => {
  assert.deepEqual(normalizeCustomGroups(['主力站', '待签到', '已签到', '备用']), ['主力站', '备用']);
  assert.deepEqual(normalizeCustomGroups(['待签到', '已签到']), ['主力站', '白嫖备用', '公益站']);
  assert.equal(resolveSiteGroup('待签到', ['主力站', '备用']), '主力站');
});

test('old and imported status group assignments fall back to an available custom group', () => {
  const groups = normalizeCustomGroups(['待签到', '自定义分组']);
  assert.deepEqual(groups, ['自定义分组']);
  assert.equal(resolveSiteGroup('已签到', groups), '自定义分组');
});

test('status query cards remain while status names are absent from ordinary group tabs and selectors', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(main, /return \['全部', \.\.\.customGroups\]/);
  assert.match(main, /STATUS_FILTER_NAMES\.includes\(cat\)/);
  assert.match(main, /customGroups\.map\(g => `<option/);
  assert.match(main, /validateGroupName\(input\.value\)/);
  assert.match(main, /validateGroupName\(newName\)/);
  assert.match(html, /setCategory\('待签到'\)/);
  assert.match(html, /setCategory\('已签到'\)/);
});
