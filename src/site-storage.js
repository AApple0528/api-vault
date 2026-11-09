import { createUniqueSiteId } from './site-ids.js';

export function partitionSitesForDisplay(storedSites, normalizeSite) {
  const sites = [];
  const preservedSites = [];

  storedSites.forEach(storedSite => {
    const normalized = normalizeSite(storedSite);
    if (normalized === null) preservedSites.push(storedSite);
    else sites.push(normalized);
  });

  return { sites, preservedSites };
}

export function mergeSitesForPersistence(sites, preservedSites) {
  return [...sites, ...preservedSites];
}

export function createUniqueSiteIdForState(sites, preservedSites, seed = Date.now()) {
  return createUniqueSiteId(mergeSitesForPersistence(sites, preservedSites), seed);
}

export function persistBeforeCommit({ persist, commit, notifyFailure, reportError = () => {} }) {
  try {
    persist();
  } catch (error) {
    reportError(error);
    const storageMayBeInconsistent = error?.code === 'STORAGE_ROLLBACK_FAILED';
    notifyFailure(error, storageMayBeInconsistent);
    return { ok: false, storageMayBeInconsistent, error };
  }

  commit();
  return { ok: true, storageMayBeInconsistent: false };
}

export function clearAllSitesSafely({ persist, commit, notify, reportError = () => {} }) {
  const result = persistBeforeCommit({
    persist,
    commit,
    reportError,
    notifyFailure(error, storageMayBeInconsistent) {
      notify(storageMayBeInconsistent
        ? '清空失败，存储状态可能不一致，请重新打开应用检查数据'
        : '清空失败，原有数据已保留，请检查设备可用空间');
    }
  });
  if (!result.ok) return result;

  notify('已清空全部站点数据');
  return result;
}
