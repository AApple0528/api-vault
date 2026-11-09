export const STATUS_FILTER_NAMES = ['待签到', '已签到'];
export const DEFAULT_GROUPS = ['主力站', '白嫖备用', '公益站'];

export function normalizeCustomGroups(groups) {
  if (!Array.isArray(groups)) return [...DEFAULT_GROUPS];
  const normalized = [...new Set(groups
    .filter(group => typeof group === 'string' && group.trim() && !STATUS_FILTER_NAMES.includes(group.trim()))
    .map(group => group.trim()))];
  return normalized.length ? normalized : [...DEFAULT_GROUPS];
}

export function resolveSiteGroup(group, groups) {
  return groups.includes(String(group)) ? String(group) : (groups[0] || DEFAULT_GROUPS[0]);
}
