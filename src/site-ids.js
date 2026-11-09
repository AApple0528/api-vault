export function toValidSiteId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function nextAvailableSiteId(unavailableIds, seed) {
  let candidate = toValidSiteId(seed) || 1;
  while (unavailableIds.has(candidate)) {
    candidate = candidate === Number.MAX_SAFE_INTEGER ? 1 : candidate + 1;
  }
  return candidate;
}

export function createUniqueSiteId(sites, seed = Date.now()) {
  const unavailableIds = new Set(
    sites.map(site => toValidSiteId(site?.id)).filter(id => id !== null)
  );
  return nextAvailableSiteId(unavailableIds, seed);
}

export function ensureUniqueSiteIds(sites, seed = Date.now()) {
  const reservedIds = new Set(
    sites
      .filter(site => site && typeof site === 'object' && !Array.isArray(site))
      .map(site => toValidSiteId(site.id))
      .filter(id => id !== null)
  );
  const unavailableIds = new Set(reservedIds);
  const seenIds = new Set();
  let nextSeed = seed;
  let repairedCount = 0;

  const uniqueSites = sites.map(site => {
    if (!site || typeof site !== 'object' || Array.isArray(site)) return site;
    const id = toValidSiteId(site?.id);
    if (id !== null && !seenIds.has(id)) {
      seenIds.add(id);
      return site.id === id ? site : { ...site, id };
    }

    const uniqueId = nextAvailableSiteId(unavailableIds, nextSeed);
    unavailableIds.add(uniqueId);
    seenIds.add(uniqueId);
    nextSeed = uniqueId === Number.MAX_SAFE_INTEGER ? 1 : uniqueId + 1;
    repairedCount++;
    return { ...site, id: uniqueId };
  });

  return { sites: uniqueSites, repairedCount };
}

export function migrateStoredSiteIds(storage, key, storedSites, seed = Date.now()) {
  const result = ensureUniqueSiteIds(storedSites, seed);
  if (result.repairedCount > 0) {
    storage.setItem(key, JSON.stringify(result.sites));
  }
  return result;
}
