import test from 'node:test';
import assert from 'node:assert/strict';
import { persistJsonArraysWithRollback } from '../src/site-import.js';
import { clearAllSitesSafely, createUniqueSiteIdForState, mergeSitesForPersistence, partitionSitesForDisplay, persistBeforeCommit } from '../src/site-storage.js';

function normalizeTestSite(site) {
  if (!site || typeof site !== 'object' || !String(site.url || '').startsWith('https://')) return null;
  return {
    ...site,
    notes: (site.notes || []).map(note => ({ ...note }))
  };
}

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  };
}

test('ordinary check-in, edit and mask saves preserve filtered legacy records', () => {
  const invalidLegacySite = { id: 99, name: 'Hidden legacy record', url: 'invalid-url', legacy: true };
  const storedSites = [
    {
      id: 1,
      name: 'Visible',
      url: 'https://example.test',
      checkedInToday: false,
      notes: [{ label: 'Key', value: 'value', masked: true }]
    },
    invalidLegacySite
  ];
  const state = partitionSitesForDisplay(storedSites, normalizeTestSite);
  const storage = createStorage();

  const save = () => {
    persistJsonArraysWithRollback(storage, [
      ['sites', mergeSitesForPersistence(state.sites, state.preservedSites)]
    ]);
    return JSON.parse(storage.getItem('sites'));
  };

  state.sites[0].checkedInToday = true;
  let persisted = save();
  assert.deepEqual(persisted[1], invalidLegacySite);

  state.sites[0] = { ...state.sites[0], name: 'Edited' };
  persisted = save();
  assert.deepEqual(persisted[1], invalidLegacySite);

  state.sites[0].notes[0].masked = false;
  persisted = save();
  assert.deepEqual(persisted[1], invalidLegacySite);
  assert.equal(persisted[0].checkedInToday, true);
  assert.equal(persisted[0].name, 'Edited');
  assert.equal(persisted[0].notes[0].masked, false);
});

test('new site ids avoid ids held by filtered legacy records', () => {
  const sites = [{ id: 10 }];
  const preservedSites = [{ id: 11, url: 'invalid-url' }];

  assert.equal(createUniqueSiteIdForState(sites, preservedSites, 10), 12);
});

test('normal add, edit and delete affect visible sites without dropping preserved records', () => {
  const invalidLegacySite = { id: 99, name: 'Hidden legacy record', url: 'invalid-url' };
  const state = partitionSitesForDisplay([
    { id: 1, name: 'Visible', url: 'https://example.test', notes: [] },
    invalidLegacySite
  ], normalizeTestSite);

  state.sites.push({ id: 2, name: 'Added', url: 'https://added.test', notes: [] });
  state.sites[1] = { ...state.sites[1], name: 'Added and edited' };
  state.sites = state.sites.filter(site => site.id !== 1);

  assert.deepEqual(mergeSitesForPersistence(state.sites, state.preservedSites), [
    { id: 2, name: 'Added and edited', url: 'https://added.test', notes: [] },
    invalidLegacySite
  ]);
});

function createClearState() {
  return {
    sites: [{ id: 1, name: 'Visible' }],
    preservedSites: [{ id: 2, name: 'Hidden legacy record', url: 'invalid-url' }],
    disclosureCleared: false,
    renderCalls: 0,
    notifications: []
  };
}

function commitClearState(state) {
  state.sites = [];
  state.preservedSites = [];
  state.disclosureCleared = true;
  state.renderCalls++;
}

function createClearFailureStorage(oldSites, oldGroups, rollbackFails = false) {
  const values = new Map([
    ['sites', JSON.stringify(oldSites)],
    ['groups', JSON.stringify(oldGroups)]
  ]);
  let siteWrites = 0;
  return {
    values,
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem(key, value) {
      if (key === 'groups') throw new Error('group write failed');
      if (key === 'sites') {
        siteWrites++;
        if (rollbackFails && siteWrites === 2) throw new Error('site rollback failed');
      }
      values.set(key, value);
    }
  };
}

test('clear commits memory and success notice only after storage succeeds', () => {
  const state = createClearState();
  const groups = ['Current group'];
  const storage = createStorage();
  storage.setItem('sites', JSON.stringify([...state.sites, ...state.preservedSites]));
  storage.setItem('groups', JSON.stringify(groups));

  const result = clearAllSitesSafely({
    persist: () => persistJsonArraysWithRollback(storage, [['sites', []], ['groups', groups]]),
    commit: () => commitClearState(state),
    notify: message => state.notifications.push(message)
  });

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(storage.getItem('sites')), []);
  assert.deepEqual(JSON.parse(storage.getItem('groups')), groups);
  assert.deepEqual(state.sites, []);
  assert.deepEqual(state.preservedSites, []);
  assert.equal(state.disclosureCleared, true);
  assert.equal(state.renderCalls, 1);
  assert.deepEqual(state.notifications, ['已清空全部站点数据']);
});

test('clear write failure with successful rollback preserves memory and never reports success', () => {
  const state = createClearState();
  const oldSites = [...state.sites, ...state.preservedSites];
  const groups = ['Current group'];
  const storage = createClearFailureStorage(oldSites, groups);

  const result = clearAllSitesSafely({
    persist: () => persistJsonArraysWithRollback(storage, [['sites', []], ['groups', groups]]),
    commit: () => commitClearState(state),
    notify: message => state.notifications.push(message)
  });

  assert.equal(result.ok, false);
  assert.equal(result.storageMayBeInconsistent, false);
  assert.deepEqual(JSON.parse(storage.values.get('sites')), oldSites);
  assert.deepEqual(state.sites, [{ id: 1, name: 'Visible' }]);
  assert.deepEqual(state.preservedSites, [{ id: 2, name: 'Hidden legacy record', url: 'invalid-url' }]);
  assert.equal(state.disclosureCleared, false);
  assert.equal(state.renderCalls, 0);
  assert.equal(state.notifications.length, 1);
  assert.match(state.notifications[0], /原有数据已保留/);
  assert.doesNotMatch(state.notifications[0], /已清空全部站点数据/);
});

test('clear write and rollback failure preserves memory and warns about inconsistent storage', () => {
  const state = createClearState();
  const oldSites = [...state.sites, ...state.preservedSites];
  const groups = ['Current group'];
  const storage = createClearFailureStorage(oldSites, groups, true);
  const reportedErrors = [];

  const result = clearAllSitesSafely({
    persist: () => persistJsonArraysWithRollback(storage, [['sites', []], ['groups', groups]]),
    commit: () => commitClearState(state),
    notify: message => state.notifications.push(message),
    reportError: error => reportedErrors.push(error)
  });

  assert.equal(result.ok, false);
  assert.equal(result.storageMayBeInconsistent, true);
  assert.equal(reportedErrors[0].code, 'STORAGE_ROLLBACK_FAILED');
  assert.deepEqual(state.sites, [{ id: 1, name: 'Visible' }]);
  assert.deepEqual(state.preservedSites, [{ id: 2, name: 'Hidden legacy record', url: 'invalid-url' }]);
  assert.equal(state.disclosureCleared, false);
  assert.equal(state.renderCalls, 0);
  assert.equal(state.notifications.length, 1);
  assert.match(state.notifications[0], /存储状态可能不一致/);
  assert.doesNotMatch(state.notifications[0], /已清空全部站点数据/);
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function assertFailedStagedMutation(t, {
  name,
  initialSites,
  initialGroups,
  nextSites,
  nextGroups,
  prepareState = () => ({}),
  commitExtra = () => {},
  assertExtra = () => {}
}) {
  await t.test(name, () => {
    const state = {
      sites: clone(initialSites),
      groups: clone(initialGroups),
      successMessages: [],
      failureMessages: [],
      ...prepareState()
    };
    const storage = createClearFailureStorage(initialSites, initialGroups);

    const result = persistBeforeCommit({
      persist: () => persistJsonArraysWithRollback(storage, [
        ['sites', nextSites],
        ['groups', nextGroups]
      ]),
      commit: () => {
        state.sites = clone(nextSites);
        state.groups = clone(nextGroups);
        commitExtra(state);
      },
      notifyFailure: () => state.failureMessages.push('保存失败')
    });
    if (result.ok) state.successMessages.push('保存成功');

    assert.equal(result.ok, false);
    assert.deepEqual(state.sites, initialSites);
    assert.deepEqual(state.groups, initialGroups);
    assert.deepEqual(JSON.parse(storage.values.get('sites')), initialSites);
    assert.deepEqual(JSON.parse(storage.values.get('groups')), initialGroups);
    assert.deepEqual(state.successMessages, []);
    assert.deepEqual(state.failureMessages, ['保存失败']);
    assertExtra(state);
  });
}

test('failed staged site mutations never commit memory or success UI', async t => {
  const baseSite = {
    id: 1,
    name: 'Original',
    group: 'A',
    checkedInToday: false,
    notes: [{ label: 'Credential', value: 'test-value', masked: true }]
  };
  const initialSites = [baseSite];
  const initialGroups = ['A', 'B'];

  await assertFailedStagedMutation(t, {
    name: 'new site', initialSites, initialGroups,
    nextSites: [{ ...baseSite, id: 2, name: 'New' }, ...initialSites],
    nextGroups: initialGroups
  });
  await assertFailedStagedMutation(t, {
    name: 'edit site keeps old content and modal open', initialSites, initialGroups,
    nextSites: [{ ...baseSite, name: 'Edited' }],
    nextGroups: initialGroups,
    prepareState: () => ({ modalOpen: true }),
    commitExtra: state => { state.modalOpen = false; },
    assertExtra: state => assert.equal(state.modalOpen, true)
  });
  await assertFailedStagedMutation(t, {
    name: 'delete site keeps disclosure state', initialSites, initialGroups,
    nextSites: [], nextGroups: initialGroups,
    prepareState: () => ({ expandedSiteIds: new Set([1]) }),
    commitExtra: state => state.expandedSiteIds.delete(1),
    assertExtra: state => assert.equal(state.expandedSiteIds.has(1), true)
  });
  await assertFailedStagedMutation(t, {
    name: 'global mask keeps previous masks', initialSites, initialGroups,
    nextSites: [{ ...baseSite, notes: baseSite.notes.map(note => ({ ...note, masked: false })) }],
    nextGroups: initialGroups
  });
  await assertFailedStagedMutation(t, {
    name: 'check-in keeps previous status', initialSites, initialGroups,
    nextSites: [{ ...baseSite, checkedInToday: true }],
    nextGroups: initialGroups
  });
  await assertFailedStagedMutation(t, {
    name: 'single mask keeps previous state', initialSites, initialGroups,
    nextSites: [{ ...baseSite, notes: baseSite.notes.map(note => ({ ...note, masked: false })) }],
    nextGroups: initialGroups
  });
  await assertFailedStagedMutation(t, {
    name: 'bookmark batch keeps pre-import sites', initialSites, initialGroups,
    nextSites: [{ ...baseSite, id: 2, name: 'Imported' }, ...initialSites],
    nextGroups: initialGroups,
    prepareState: () => ({ successDialogShown: false }),
    commitExtra: state => { state.successDialogShown = true; },
    assertExtra: state => assert.equal(state.successDialogShown, false)
  });
});

test('failed staged group mutations preserve groups and site assignments', async t => {
  const initialSites = [{ id: 1, name: 'Original', group: 'A', notes: [] }];
  const initialGroups = ['A', 'B'];

  await assertFailedStagedMutation(t, {
    name: 'rename group', initialSites, initialGroups,
    nextSites: [{ ...initialSites[0], group: 'Renamed' }],
    nextGroups: ['Renamed', 'B']
  });
  await assertFailedStagedMutation(t, {
    name: 'delete group and migrate sites', initialSites, initialGroups,
    nextSites: [{ ...initialSites[0], group: 'B' }],
    nextGroups: ['B']
  });
  await assertFailedStagedMutation(t, {
    name: 'add group', initialSites, initialGroups,
    nextSites: initialSites,
    nextGroups: ['A', 'B', 'C']
  });
  await assertFailedStagedMutation(t, {
    name: 'sort groups', initialSites, initialGroups,
    nextSites: initialSites,
    nextGroups: ['B', 'A']
  });
});
