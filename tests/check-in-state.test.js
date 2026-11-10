import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalDateKey,
  isCheckedInToday,
  migrateCheckInDates,
  refreshCheckInStatus,
  serializeSitesWithCheckInDate,
  setCheckInForToday
} from '../src/check-in-state.js';

test('check-in remains complete for the same local day after reopening', () => {
  const checkedIn = setCheckInForToday({ id: 1, checkedInToday: false }, '2026-11-11');
  assert.equal(checkedIn.lastCheckInDate, '2026-11-11');
  assert.equal(isCheckedInToday(checkedIn, '2026-11-11'), true);

  const persisted = JSON.parse(JSON.stringify(serializeSitesWithCheckInDate([checkedIn])));
  const reopened = migrateCheckInDates(persisted, '2026-11-11').sites[0];
  assert.equal(isCheckedInToday(reopened, '2026-11-11'), true);
});

test('a new local date resets status and allows check-in again', () => {
  const site = { id: 1, lastCheckInDate: '2026-11-10' };
  assert.equal(isCheckedInToday(site, '2026-11-11'), false);
  const refreshed = refreshCheckInStatus([site], '2026-11-11');
  assert.equal(refreshed[0].checkedInToday, false);

  const checkedInAgain = setCheckInForToday(refreshed[0], '2026-11-11');
  assert.equal(checkedInAgain.lastCheckInDate, '2026-11-11');
  assert.equal(checkedInAgain.checkedInToday, true);
});

test('legacy boolean values migrate once without losing other site fields', () => {
  const oldSites = [
    { id: 1, name: 'Signed', checkedInToday: true, tags: ['daily'], notes: [{ value: 'keep' }] },
    { id: 2, name: 'Pending', checkedInToday: false, group: '备用' }
  ];
  const migration = migrateCheckInDates(oldSites, '2026-11-11');

  assert.equal(migration.changed, true);
  assert.equal(migration.sites[0].lastCheckInDate, '2026-11-11');
  assert.equal(migration.sites[1].lastCheckInDate, null);
  assert.equal('checkedInToday' in migration.sites[0], false);
  assert.deepEqual(migration.sites[0].tags, ['daily']);
  assert.deepEqual(migration.sites[0].notes, [{ value: 'keep' }]);
  assert.equal(migration.sites[1].group, '备用');

  const nextDay = migrateCheckInDates(migration.sites, '2026-11-12').sites;
  assert.equal(isCheckedInToday(nextDay[0], '2026-11-12'), false);
});

test('local date key uses local calendar fields instead of the UTC date slice', () => {
  const localCalendarDate = {
    getFullYear: () => 2026,
    getMonth: () => 10,
    getDate: () => 11,
    toISOString: () => '2026-11-10T08:15:00.000Z'
  };
  assert.equal(getLocalDateKey(localCalendarDate), '2026-11-11');
  assert.notEqual(getLocalDateKey(localCalendarDate), localCalendarDate.toISOString().slice(0, 10));
});

test('check-in serialization preserves unrelated site and group data', () => {
  const groups = ['主力站', '备用'];
  const sites = [{
    id: 7,
    name: 'Site',
    group: '备用',
    tags: ['tag'],
    notes: [{ label: 'key', value: 'secret' }],
    desc: 'remark',
    needCheckIn: true,
    lastCheckInDate: '2026-11-11',
    checkedInToday: true
  }];
  const serialized = serializeSitesWithCheckInDate(sites);

  assert.deepEqual(serialized, [{
    id: 7,
    name: 'Site',
    group: '备用',
    tags: ['tag'],
    notes: [{ label: 'key', value: 'secret' }],
    desc: 'remark',
    needCheckIn: true,
    lastCheckInDate: '2026-11-11'
  }]);
  assert.deepEqual(groups, ['主力站', '备用']);
  assert.equal(sites[0].checkedInToday, true);
});

test('application reload migrates legacy check-in booleans and refreshes on foreground', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /migrateCheckInDates\(storedSiteSource\)/);
  assert.match(source, /sites = refreshCheckInStatus\(sites\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
});
