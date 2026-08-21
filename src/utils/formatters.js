import { parsePositionCode, formatLocationLabel, getLotSectionName, normalizeLot } from './positionCode';

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatCurrency(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(value, decimals = 1) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(decimals);
}

export function getTreeDisplayId(tree) {
  return tree?.tree_positions?.position_code
    || tree?.position_code
    || '—';
}

export function getTreeLocation(tree) {
  const code = getTreeDisplayId(tree);
  const parsed = parsePositionCode(code);
  if (parsed) {
    return {
      section: parsed.section,
      row: parsed.row,
      lot: parsed.lot,
      tree: parsed.tree,
      label: formatLocationLabel(parsed),
    };
  }

  const lot = tree?.tree_positions?.lots;
  if (!lot) return null;
  return {
    section: getLotSectionName(lot),
    row: null,
    lot: normalizeLot(lot.name),
    tree: null,
    label: [getLotSectionName(lot), normalizeLot(lot.name)].filter(Boolean).join(' · '),
  };
}
