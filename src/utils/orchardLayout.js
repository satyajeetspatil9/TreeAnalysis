import { parsePositionCode, normalizeRow } from './positionCode';
import { getActiveIrrigationLink, getActiveTreeInstance } from './schema';
import { getPositionBlock } from './treeSearch';

export const SECOND_SECTION_START_ROW = 9;

export const ROW_BANDS = [
  { key: 'upper', fallbackLabel: `Zone · rows ${SECOND_SECTION_START_ROW}+`, rowHint: `Rows ${SECOND_SECTION_START_ROW}+` },
  { key: 'lower', fallbackLabel: `Zone · rows 1–${SECOND_SECTION_START_ROW - 1}`, rowHint: `Rows 1–${SECOND_SECTION_START_ROW - 1}` },
];

export const BLOCK_ACCENT = {
  B: 'info',
  A: 'primary',
};

export const ORCHARD_ROWS_SELECT = `
  id, name,
  sections ( name ),
  lot_rows (
    lots (
      id, name,
      tree_positions (
        id, position_code,
        trees (
          id, status, variety, planting_date,
          tree_irrigation_zones (
            zone_id,
            end_date,
            irrigation_zones ( id, zone_code )
          )
        )
      )
    )
  )
`;

export function collectRowPositions(row) {
  const rowCode = normalizeRow(row.name);
  return (row.lot_rows || []).flatMap((lr) =>
    (lr.lots?.tree_positions || [])
      .filter((pos) => parsePositionCode(pos.position_code)?.row === rowCode)
      .map((pos) => {
        const activeTree = getActiveTreeInstance(pos.trees);
        return activeTree
          ? { ...pos, activeTree, rowId: row.id, rowCode, sectionName: row.sections?.name }
          : null;
      })
      .filter(Boolean),
  );
}

export function rowNumberFromCode(rowCode) {
  const n = Number(String(rowCode || '').replace(/^R/i, ''));
  return Number.isFinite(n) ? n : 0;
}

export function getPositionRowNumber(pos) {
  const parsed = parsePositionCode(pos?.position_code);
  return rowNumberFromCode(parsed?.row || pos?.rowCode);
}

export function getPositionRowBand(pos) {
  return getPositionRowNumber(pos) >= SECOND_SECTION_START_ROW ? 'upper' : 'lower';
}

export function getPositionZoneCode(pos) {
  return getActiveIrrigationLink(pos?.activeTree)?.irrigation_zones?.zone_code || null;
}

export function zoneTitleForPositions(positions, fallbackLabel) {
  const codes = [...new Set(positions.map(getPositionZoneCode).filter(Boolean))].sort();
  if (codes.length === 1) return codes[0];
  if (codes.length > 1) return codes.join(' · ');
  return fallbackLabel;
}

export function positionsInSectionBand(positions, section, band) {
  return positions
    .filter((pos) => getPositionBlock(pos) === section && getPositionRowBand(pos) === band)
    .sort((a, b) => a.position_code.localeCompare(b.position_code));
}

export function groupPositionsByRow(positions) {
  const map = new Map();
  positions.forEach((pos) => {
    const row = parsePositionCode(pos.position_code)?.row || pos.rowCode || '—';
    if (!map.has(row)) map.set(row, []);
    map.get(row).push(pos);
  });
  return [...map.entries()].sort(
    (a, b) => rowNumberFromCode(b[0]) - rowNumberFromCode(a[0]),
  );
}

function treeCodeSortValue(pos) {
  return parsePositionCode(pos.position_code)?.tree || pos.position_code;
}

export function groupRowLots(rowPositions) {
  const byLot = new Map();
  rowPositions.forEach((pos) => {
    const lot = parsePositionCode(pos.position_code)?.lot || '—';
    if (!byLot.has(lot)) byLot.set(lot, []);
    byLot.get(lot).push(pos);
  });
  return [...byLot.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lot, trees]) => [
      lot,
      trees.slice().sort((a, b) => treeCodeSortValue(a).localeCompare(treeCodeSortValue(b), undefined, { numeric: true })),
    ]);
}

export function treeShortName(pos) {
  const parsed = parsePositionCode(pos.position_code);
  return parsed?.tree || pos.position_code.split('-').pop() || pos.position_code;
}
