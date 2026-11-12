import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePinnedState, sortSitesPinnedFirst } from '../src/site-pinning.js';
import { prepareAndPersistJsonImport } from '../src/site-import.js';
import { serializeSitesWithCheckInDate } from '../src/check-in-state.js';
import { readFileSync } from 'node:fs';
import { siteMatchesFilters } from '../src/site-filters.js';

test('pinned sites move before ordinary sites while preserving each group order', () => {
  const sites = [
    { id: 1, name: 'first', pinned: false },
    { id: 2, name: 'pinned-a', pinned: true },
    { id: 3, name: 'ordinary-b', pinned: false },
    { id: 4, name: 'pinned-b', pinned: true }
  ];
  const originalOrder = [...sites];
  const sorted = sortSitesPinnedFirst(sites);

  assert.deepEqual(sorted.map(site => site.id), [2, 4, 1, 3]);
  assert.deepEqual(sites, originalOrder);
  assert.deepEqual(sites.map(site => site.id), [1, 2, 3, 4]);
  assert.deepEqual(sorted.slice(0, 2), [sites[1], sites[3]], 'pinned sites keep their original relative order');
  assert.deepEqual(sorted.slice(2), [sites[0], sites[2]], 'ordinary sites keep their original relative order');

  const unpinned = sites.map(site => ({ ...site, pinned: false }));
  assert.deepEqual(sortSitesPinnedFirst(unpinned).map(site => site.id), [1, 2, 3, 4]);
});

test('only literal true is normalized as pinned', () => {
  assert.equal(normalizePinnedState({ pinned: true }), true);
  assert.equal(normalizePinnedState({ pinned: false }), false);
  assert.equal(normalizePinnedState({ pinned: null }), false);
  assert.equal(normalizePinnedState({ pinned: 'false' }), false);
  assert.equal(normalizePinnedState({ pinned: 1 }), false);
  assert.equal(normalizePinnedState(null), false);
});

test('empty site arrays sort to empty without mutation', () => {
  const sites = [];
  const sorted = sortSitesPinnedFirst(sites);
  assert.deepEqual(sorted, []);
  assert.notEqual(sorted, sites);
  assert.deepEqual(sites, []);
});

test('pinned ordering remains effective after search and group filtering', () => {
  const sites = [
    { id: 1, name: 'Alpha', group: 'A', tags: [], needCheckIn: true, checkedInToday: false, pinned: false },
    { id: 2, name: 'Alpine', group: 'A', tags: [], needCheckIn: true, checkedInToday: false, pinned: true },
    { id: 3, name: 'Alpha backup', group: 'B', tags: [], needCheckIn: true, checkedInToday: false, pinned: true }
  ];
  const filtered = sites.filter(site => siteMatchesFilters(site, { group: 'A', query: 'al' }));
  assert.deepEqual(sortSitesPinnedFirst(filtered).map(site => site.id), [2, 1]);
  const pending = sites.filter(site => siteMatchesFilters(site, { status: '待签到', query: 'alpha' }));
  assert.deepEqual(sortSitesPinnedFirst(pending).map(site => site.id), [3, 1]);
});

test('missing pinned field is treated as false and JSON round-trip preserves state', () => {
  assert.equal(normalizePinnedState({ name: 'legacy' }), false);
  const sites = [{ id: 1, name: 'legacy', pinned: false }, { id: 2, name: 'saved', pinned: true }];
  const exported = serializeSitesWithCheckInDate(sites);
  assert.deepEqual(exported.map(site => site.pinned), [false, true]);
  const localStorageValue = JSON.stringify(exported);
  assert.deepEqual(JSON.parse(localStorageValue).map(site => site.pinned), [false, true]);

  let persisted;
  const imported = prepareAndPersistJsonImport({
    sites: [{ id: 1, name: 'legacy', url: 'https://legacy.test' }, { id: 2, name: 'saved', url: 'https://saved.test', pinned: true }]
  }, {
    currentGroups: ['默认'],
    normalizeSite: site => ({ ...site, pinned: normalizePinnedState(site) }),
    persist: state => { persisted = state; }
  });
  assert.deepEqual(imported.sites.map(site => site.pinned), [false, true]);
  assert.deepEqual(persisted.sites.map(site => site.pinned), [false, true]);
});

test('site list exposes a per-site pin toggle and applies it after filters', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /sortSitesPinnedFirst\(sites\.filter\(site => siteMatchesFilters/);
  assert.match(source, /function toggleSitePinned\(siteId\)/);
  assert.match(source, /toggleSiteCredentials, toggleSitePinned, updateFormNote/);
  assert.match(source, /pinned: false/);
});
