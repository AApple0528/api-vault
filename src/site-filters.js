export function siteMatchesFilters(site, { status = '全部', group = null, query = '' } = {}) {
  const matchStatus = status === '全部' ? true :
    status === '待签到' ? Boolean(site.needCheckIn && !site.checkedInToday) :
    status === '已签到' ? Boolean(site.needCheckIn && site.checkedInToday) : false;
  const matchGroup = !group || site.group === group;
  const normalizedQuery = String(query).trim().toLowerCase();
  const matchQuery = !normalizedQuery ||
    String(site.name || '').toLowerCase().includes(normalizedQuery) ||
    String(site.url || '').toLowerCase().includes(normalizedQuery) ||
    (site.tags || []).some(tag => String(tag).toLowerCase().includes(normalizedQuery));
  return matchStatus && matchGroup && matchQuery;
}
