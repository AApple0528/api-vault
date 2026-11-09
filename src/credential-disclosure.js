export function createCredentialDisclosureState() {
  const expandedSiteIds = new Set();

  return {
    isExpanded(siteId) {
      return expandedSiteIds.has(siteId);
    },
    toggle(siteId) {
      if (expandedSiteIds.has(siteId)) {
        expandedSiteIds.delete(siteId);
        return false;
      }
      expandedSiteIds.add(siteId);
      return true;
    },
    remove(siteId) {
      expandedSiteIds.delete(siteId);
    },
    clear() {
      expandedSiteIds.clear();
    }
  };
}
