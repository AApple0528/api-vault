import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialDisclosureState } from '../src/credential-disclosure.js';
import { createUniqueSiteId, ensureUniqueSiteIds, migrateStoredSiteIds } from '../src/site-ids.js';

test('new site ids remain unique when the clock candidate already exists', () => {
  const sites = [{ id: 1000 }, { id: 1001 }, { id: 1002 }];
  assert.equal(createUniqueSiteId(sites, 1000), 1003);
});

test('duplicate import ids are repaired without dropping or mixing site data', () => {
  const imported = [
    { id: 7, name: 'First', notes: [{ label: 'Key', value: 'one', masked: true }] },
    { id: '7', name: 'Second', notes: [{ label: 'Account', value: 'two', masked: false }] },
    { name: 'Missing', notes: [{ label: 'Email', value: 'three', masked: false }] }
  ];

  const result = ensureUniqueSiteIds(imported, 7);

  assert.equal(result.repairedCount, 2);
  assert.deepEqual(result.sites.map(site => site.id), [7, 8, 9]);
  assert.deepEqual(result.sites.map(site => site.name), ['First', 'Second', 'Missing']);
  assert.deepEqual(result.sites.map(site => site.notes[0].value), ['one', 'two', 'three']);
  assert.equal(new Set(result.sites.map(site => site.id)).size, result.sites.length);
});

test('repaired import ids keep disclosure state independent', () => {
  const { sites } = ensureUniqueSiteIds([
    { id: 5, name: 'A' },
    { id: 5, name: 'B' }
  ], 5);
  const disclosure = createCredentialDisclosureState();

  disclosure.toggle(sites[0].id);

  assert.equal(disclosure.isExpanded(sites[0].id), true);
  assert.equal(disclosure.isExpanded(sites[1].id), false);
});

test('startup id migration preserves every raw storage record before view filtering', () => {
  const storedSites = [
    { id: 4, name: 'Visible', url: 'https://example.test' },
    { id: 4, name: 'Duplicate', url: 'https://duplicate.test' },
    { id: null, name: 'Invalid URL retained in storage', url: 'not-a-url' },
    null
  ];
  const values = new Map([['sites', JSON.stringify(storedSites)]]);
  const storage = { setItem: (key, value) => values.set(key, value) };

  const result = migrateStoredSiteIds(storage, 'sites', storedSites, 4);
  const persisted = JSON.parse(values.get('sites'));

  assert.equal(result.repairedCount, 2);
  assert.equal(persisted.length, storedSites.length);
  assert.equal(persisted[2].url, 'not-a-url');
  assert.equal(persisted[3], null);
  assert.equal(new Set(persisted.filter(Boolean).map(site => site.id)).size, 3);
});

test('failed startup migration write throws and leaves the previous stored value intact', () => {
  const storedSites = [{ id: 2 }, { id: 2 }];
  const original = JSON.stringify(storedSites);
  let storedValue = original;
  const storage = {
    getItem() { return storedValue; },
    setItem() { throw new Error('quota exceeded'); }
  };

  assert.throws(() => migrateStoredSiteIds(storage, 'sites', storedSites, 2), /quota exceeded/);
  assert.equal(storage.getItem('sites'), original);
  assert.equal(JSON.stringify(storedSites), original);
});
