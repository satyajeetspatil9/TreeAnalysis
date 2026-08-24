export const TREE_DASHBOARD_TAB_SLUGS = {
  overview: 0,
  soil: 1,
  irrigation: 2,
  fertilizer: 3,
  disease: 4,
  photos: 5,
  satellite: 6,
  growth: 7,
  cost: 8,
  yield: 9,
  history: 10,
};

export function treeDashboardTabIndex(tabSlug) {
  if (!tabSlug) return 0;
  const index = TREE_DASHBOARD_TAB_SLUGS[String(tabSlug).toLowerCase()];
  return index ?? 0;
}

export function treeDashboardUrl(positionCode, tabSlug) {
  const path = `/tree/${encodeURIComponent(positionCode)}`;
  if (!tabSlug) return path;
  return `${path}?tab=${encodeURIComponent(tabSlug)}`;
}
