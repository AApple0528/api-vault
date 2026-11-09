import test from 'node:test';
import assert from 'node:assert/strict';
import { getJsonImportFailureDialog, persistJsonArraysWithRollback, prepareAndPersistJsonImport } from '../src/site-import.js';

function normalizeTestSite(site, groups) {
  if (!site || typeof site !== 'object' || !String(site.url || '').startsWith('https://')) return null;
  return {
    ...site,
    group: groups.includes(site.group) ? site.group : groups[0],
    tags: [...(site.tags || [])],
    notes: (site.notes || []).map(note => ({ ...note }))
  };
}

function createStorage(initialEntries, failKey = null) {
  const values = new Map(initialEntries.map(([key, value]) => [key, JSON.stringify(value)]));
  let failed = false;
  return {
    values,
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem(key, value) {
      if (key === failKey && !failed) {
        failed = true;
        throw new Error('storage write failed');
      }
      values.set(key, value);
    }
  };
}

function captureError(action) {
  let captured;
  try {
    action();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured, 'expected action to throw');
  return captured;
}

test('validation failure leaves current sites, groups and storage unchanged', () => {
  const currentSites = [{ id: 1, name: 'Current' }];
  const currentGroups = ['Current group'];
  let persistCalls = 0;

  const validationError = captureError(() => prepareAndPersistJsonImport({
    groups: ['Imported group'],
    sites: [{ id: 2, name: 'Invalid', url: 'invalid' }]
  }, {
    currentGroups,
    normalizeSite: normalizeTestSite,
    persist() { persistCalls++; }
  }), /无效站点/);

  assert.deepEqual(currentSites, [{ id: 1, name: 'Current' }]);
  assert.deepEqual(currentGroups, ['Current group']);
  assert.equal(persistCalls, 0);
  assert.equal(getJsonImportFailureDialog(validationError).title, 'JSON 校验失败');
});

test('storage failure rolls back written keys and does not return imported state', () => {
  const oldSites = [{ id: 1, name: 'Current' }];
  const oldGroups = ['Current group'];
  const storage = createStorage([['sites', oldSites], ['groups', oldGroups]], 'groups');

  const storageError = captureError(
    () => prepareAndPersistJsonImport({
      groups: ['Imported group'],
      sites: [{ id: 2, name: 'Imported', url: 'https://example.test' }]
    }, {
      currentGroups: oldGroups,
      normalizeSite: normalizeTestSite,
      persist({ sites, groups }) {
        persistJsonArraysWithRollback(storage, [['sites', sites], ['groups', groups]]);
      }
    })
  );
  assert.equal(storageError.code, 'IMPORT_STORAGE_FAILED');
  assert.equal(storageError.cause?.code, 'STORAGE_WRITE_FAILED');
  assert.equal(storageError.cause?.cause?.message, 'storage write failed');

  assert.deepEqual(JSON.parse(storage.values.get('sites')), oldSites);
  assert.deepEqual(JSON.parse(storage.values.get('groups')), oldGroups);
  assert.deepEqual(oldGroups, ['Current group']);
  const dialog = getJsonImportFailureDialog(storageError);
  assert.equal(dialog.title, 'JSON 恢复失败');
  assert.match(dialog.message, /原有存储数据保持不变/);
  assert.doesNotMatch(dialog.message, /可能不一致/);
});

test('successful import repairs duplicate ids and preserves associated fields', () => {
  const storage = createStorage([
    ['sites', [{ id: 3, name: 'Old hidden record', url: 'invalid-url' }]],
    ['groups', ['Old']]
  ]);
  const imported = prepareAndPersistJsonImport({
    groups: ['Imported'],
    sites: [
      { id: 9, name: 'One', url: 'https://one.test', group: 'Imported', tags: ['A'], notes: [{ label: 'First', value: 'one', masked: true }], desc: 'D1' },
      { id: 9, name: 'Two', url: 'https://two.test', group: 'Imported', tags: ['B'], notes: [{ label: 'Second', value: 'two', masked: false }], desc: 'D2' }
    ]
  }, {
    currentGroups: ['Old'],
    normalizeSite: normalizeTestSite,
    seed: 9,
    persist({ sites, groups }) {
      persistJsonArraysWithRollback(storage, [['sites', sites], ['groups', groups]]);
    }
  });

  assert.deepEqual(imported.sites.map(site => site.id), [9, 10]);
  assert.deepEqual(imported.sites.map(site => site.group), ['Imported', 'Imported']);
  assert.deepEqual(imported.sites.map(site => site.tags), [['A'], ['B']]);
  assert.deepEqual(imported.sites.map(site => site.notes[0]), [
    { label: 'First', value: 'one', masked: true },
    { label: 'Second', value: 'two', masked: false }
  ]);
  assert.deepEqual(imported.sites.map(site => site.desc), ['D1', 'D2']);
  assert.deepEqual(JSON.parse(storage.values.get('sites')), imported.sites);
  assert.deepEqual(JSON.parse(storage.values.get('groups')), ['Imported']);
});

test('import removes legacy status pseudo-groups while retaining sites and their sign-in state', () => {
  let persisted;
  const result = prepareAndPersistJsonImport({
    groups: ['待签到', '个人分组'],
    sites: [{ id: 1, name: 'Legacy', url: 'https://example.test', group: '待签到', needCheckIn: true, checkedInToday: true }]
  }, {
    currentGroups: ['主力站'],
    normalizeSite: normalizeTestSite,
    persist: state => { persisted = state; }
  });

  assert.deepEqual(result.groups, ['个人分组']);
  assert.equal(result.sites[0].group, '个人分组');
  assert.equal(result.sites[0].needCheckIn, true);
  assert.equal(result.sites[0].checkedInToday, true);
  assert.deepEqual(persisted, result);
});

test('failed write and failed rollback report inconsistent storage without updating memory', () => {
  const oldSites = [{ id: 1, name: 'Current' }];
  const oldGroups = ['Current group'];
  const currentState = { sites: oldSites, groups: oldGroups };
  const values = new Map([
    ['sites', JSON.stringify(oldSites)],
    ['groups', JSON.stringify(oldGroups)]
  ]);
  let siteWrites = 0;
  const storage = {
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem(key, value) {
      if (key === 'groups') throw new Error('group write failed');
      if (key === 'sites') {
        siteWrites++;
        if (siteWrites === 2) throw new Error('site rollback failed');
      }
      values.set(key, value);
    }
  };

  let importError;
  try {
    const importedState = prepareAndPersistJsonImport({
      groups: ['Imported group'],
      sites: [{ id: 2, name: 'Imported', url: 'https://example.test' }]
    }, {
      currentGroups: currentState.groups,
      normalizeSite: normalizeTestSite,
      persist({ sites, groups }) {
        persistJsonArraysWithRollback(storage, [['sites', sites], ['groups', groups]]);
      }
    });
    currentState.sites = importedState.sites;
    currentState.groups = importedState.groups;
  } catch (error) {
    importError = error;
  }

  assert.equal(importError.code, 'IMPORT_STORAGE_INCONSISTENT');
  assert.equal(importError.cause.code, 'STORAGE_ROLLBACK_FAILED');
  assert.equal(importError.cause.cause.message, 'group write failed');
  assert.equal(importError.rollbackErrors[0].error.message, 'site rollback failed');
  assert.deepEqual(currentState, { sites: oldSites, groups: oldGroups });

  const dialog = getJsonImportFailureDialog(importError);
  assert.match(dialog.message, /存储状态可能不一致/);
  assert.doesNotMatch(dialog.message, /原有.*未被替换/);
});
