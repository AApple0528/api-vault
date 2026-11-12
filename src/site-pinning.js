export function normalizePinnedState(site) {
  return site?.pinned === true;
}

export function sortSitesPinnedFirst(sites) {
  return [
    ...sites.filter(normalizePinnedState),
    ...sites.filter(site => !normalizePinnedState(site))
  ];
}
