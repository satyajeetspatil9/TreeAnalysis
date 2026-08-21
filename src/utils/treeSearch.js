import {
  buildPositionCode,
  formatLocationLabel,
  normalizeLot,
  normalizeRow,
  normalizeTree,
  parsePositionCode,
} from './positionCode';

export const EMPTY_TREE_FILTERS = {
  block: '',
  row: '',
  lot: '',
  tree: '',
  variety: '',
};

export function getPositionBlock(pos) {
  const parsed = parsePositionCode(pos?.position_code);
  return parsed?.section || pos?.sectionName?.toUpperCase() || '';
}

export function matchesTreeSearch(pos, searchQuery) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;

  const code = (pos.position_code || '').toLowerCase();
  const variety = (pos.activeTree?.variety || '').toLowerCase();
  const parsed = parsePositionCode(pos.position_code);
  const location = parsed ? formatLocationLabel(parsed).toLowerCase() : '';

  return (
    code.includes(q)
    || variety.includes(q)
    || location.includes(q)
    || (parsed?.section || '').toLowerCase().includes(q)
    || (parsed?.row || '').toLowerCase().includes(q)
    || (parsed?.lot || '').toLowerCase().includes(q)
    || (parsed?.tree || '').toLowerCase().includes(q)
  );
}

export function matchesTreeFilters(pos, searchQuery, filters = EMPTY_TREE_FILTERS) {
  if (!matchesTreeSearch(pos, searchQuery)) return false;

  const parsed = parsePositionCode(pos.position_code);
  if (filters.block && getPositionBlock(pos) !== filters.block) return false;
  if (filters.row && parsed?.row !== filters.row) return false;
  if (filters.lot && parsed?.lot !== filters.lot) return false;
  if (filters.tree && parsed?.tree !== filters.tree) return false;
  if (filters.variety && pos.activeTree?.variety !== filters.variety) return false;

  return true;
}

export function buildTreeFilterOptions(allPositions, filters = EMPTY_TREE_FILTERS) {
  const blocks = new Set();
  const rows = new Set();
  const lots = new Set();
  const trees = new Set();
  const varieties = new Set();

  allPositions.forEach((pos) => {
    const parsed = parsePositionCode(pos.position_code);
    const block = getPositionBlock(pos);
    if (block) blocks.add(block);
    if (pos.activeTree?.variety) varieties.add(pos.activeTree.variety);

    if (filters.block && block !== filters.block) return;
    if (parsed?.row) rows.add(parsed.row);

    if (filters.row && parsed?.row !== filters.row) return;
    if (parsed?.lot) lots.add(parsed.lot);

    if (filters.lot && parsed?.lot !== filters.lot) return;
    if (parsed?.tree) trees.add(parsed.tree);
  });

  return {
    blocks: [...blocks].sort(),
    rows: [...rows].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    lots: [...lots].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    trees: [...trees].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    varieties: [...varieties].sort(),
  };
}

export function hasActiveTreeFilters(searchQuery, filters = EMPTY_TREE_FILTERS) {
  return Boolean(
    searchQuery.trim()
    || filters.block
    || filters.row
    || filters.lot
    || filters.tree
    || filters.variety,
  );
}

export function buildPositionCodeFromFilters(filters = EMPTY_TREE_FILTERS) {
  if (!filters.block || !filters.row || !filters.lot || !filters.tree) return '';
  return buildPositionCode({
    section: filters.block,
    row: filters.row,
    lot: filters.lot,
    tree: filters.tree,
  });
}

export function applyFilterPatch(filters, key, value) {
  const next = { ...filters, [key]: value };
  if (key === 'block') {
    next.row = '';
    next.lot = '';
    next.tree = '';
  }
  if (key === 'row') {
    next.lot = '';
    next.tree = '';
  }
  if (key === 'lot') {
    next.tree = '';
  }
  return next;
}

export function normalizeFilterValue(key, value) {
  if (!value) return '';
  if (key === 'block') return String(value).trim().toUpperCase();
  if (key === 'row') return normalizeRow(value);
  if (key === 'lot') return normalizeLot(value);
  if (key === 'tree') return normalizeTree(value);
  return String(value).trim();
}
