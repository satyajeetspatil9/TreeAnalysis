export const HEALTH_CONFIG = {
  healthy: { emoji: '🟢', label: 'Healthy', color: 'success.main' },
  watch: { emoji: '🟡', label: 'Watch', color: 'warning.main' },
  attention: { emoji: '🔴', label: 'Attention', color: 'error.main' },
};

export function deriveHealthStatus(tree, openAlertCount = 0) {
  const status = tree?.status || 'Active';
  if (status === 'Dead' || status === 'Removed') return 'attention';
  if (status === 'Replaced') return 'attention';
  if (openAlertCount >= 2) return 'attention';
  if (openAlertCount >= 1) return 'watch';
  return 'healthy';
}

export function getHealthDisplay(tree, openAlertCount = 0) {
  const key = deriveHealthStatus(tree, openAlertCount);
  return HEALTH_CONFIG[key] || HEALTH_CONFIG.healthy;
}
