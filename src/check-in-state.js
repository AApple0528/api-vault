export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeCheckInDate(site, today = getLocalDateKey()) {
  if (typeof site?.lastCheckInDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(site.lastCheckInDate)) {
    return site.lastCheckInDate;
  }
  return site?.checkedInToday === true ? today : null;
}

export function isCheckedInToday(site, today = getLocalDateKey()) {
  return normalizeCheckInDate(site, today) === today;
}

export function refreshCheckInStatus(sites, today = getLocalDateKey()) {
  return sites.map(site => ({ ...site, checkedInToday: isCheckedInToday(site, today) }));
}

export function setCheckInForToday(site, today = getLocalDateKey()) {
  const checkedInToday = !isCheckedInToday(site, today);
  return {
    ...site,
    lastCheckInDate: checkedInToday ? today : null,
    checkedInToday
  };
}

export function serializeSitesWithCheckInDate(sites) {
  return sites.map(site => {
    const persisted = { ...site };
    delete persisted.checkedInToday;
    return persisted;
  });
}

export function migrateCheckInDates(sites, today = getLocalDateKey()) {
  let changed = false;
  const migratedSites = sites.map(site => {
    if (!site || typeof site !== 'object' || Array.isArray(site)) return site;
    const lastCheckInDate = normalizeCheckInDate(site, today);
    if (site.lastCheckInDate === lastCheckInDate && !Object.hasOwn(site, 'checkedInToday')) return site;
    const migrated = { ...site, lastCheckInDate };
    delete migrated.checkedInToday;
    changed = true;
    return migrated;
  });
  return { sites: migratedSites, changed };
}
