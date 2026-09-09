import { parsePositionCode, normalizeRow } from './positionCode';
import { getActiveIrrigationLink, getActiveTreeInstance } from './schema';
import { getPositionBlock } from './treeSearch';

export function formatRowCode(rowNumber) {
  const n = Number(rowNumber);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `R${String(Math.trunc(n)).padStart(2, '0')}`;
}

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
            irrigation_zones ( id, zone_code, description, row_count )
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

export function getPositionZone(pos) {
  return getActiveIrrigationLink(pos?.activeTree)?.irrigation_zones || null;
}

export function getPositionZoneCode(pos) {
  return getPositionZone(pos)?.zone_code || null;
}

export function parseZoneRowCount(zone) {
  const declared = Number(zone?.row_count);
  if (Number.isFinite(declared) && declared > 0) return declared;

  const description = String(zone?.description || '');
  const range = description.match(/R0?(\d+)\s*(?:[–-]|to)\s*R0?(\d+)/i);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from > 0 && to >= from) return to - from + 1;
  }
  const words = description.match(/(\d+)\s*rows?\b/i);
  if (words) {
    const n = Number(words[1]);
    if (n > 0) return n;
  }
  return null;
}

export function parseBlockToken(text) {
  const s = String(text || '').toUpperCase();
  const named = s.match(/BLOCK\s*([AB])\b/);
  if (named) return named[1];
  const token = s.match(/(?:^|[-_\s/])([AB])(?:[-_\s]|$|\d)/);
  if (token) return token[1];
  return null;
}

export function inferZoneBlock(zone, allPositions = []) {
  const saved = String(zone?.block || '').toUpperCase();
  if (saved === 'A' || saved === 'B') return saved;

  const fromLabel = parseBlockToken(zone?.zone_code) || parseBlockToken(zone?.description);
  if (fromLabel) return fromLabel;

  const counts = { A: 0, B: 0 };
  allPositions.forEach((pos) => {
    if (getPositionZone(pos)?.id !== zone?.id) return;
    const block = getPositionBlock(pos);
    if (block === 'A' || block === 'B') counts[block] += 1;
  });
  if (counts.A > counts.B) return 'A';
  if (counts.B > counts.A) return 'B';
  return null;
}

function uniqueZonesFromPositions(positions) {
  const map = new Map();
  positions.forEach((pos) => {
    const zone = getPositionZone(pos);
    if (zone?.id && !map.has(zone.id)) map.set(zone.id, zone);
  });
  return [...map.values()];
}

function zonesForBlock(block, allZones, allPositions, blockPositions) {
  const byId = new Map();
  (allZones || []).forEach((zone) => {
    if (inferZoneBlock(zone, allPositions) === block) byId.set(zone.id, zone);
  });
  uniqueZonesFromPositions(blockPositions).forEach((zone) => {
    if (inferZoneBlock(zone, allPositions) === block) {
      byId.set(zone.id, { ...zone, ...(byId.get(zone.id) || {}) });
    }
  });
  return [...byId.values()];
}

function minRowForZone(positions, zoneId) {
  const rows = positions
    .filter((pos) => getPositionZone(pos)?.id === zoneId)
    .map(getPositionRowNumber)
    .filter((n) => n > 0);
  return rows.length ? Math.min(...rows) : Number.POSITIVE_INFINITY;
}

function maxRowForZone(positions, zoneId) {
  const rows = positions
    .filter((pos) => getPositionZone(pos)?.id === zoneId)
    .map(getPositionRowNumber)
    .filter((n) => n > 0);
  return rows.length ? Math.max(...rows) : 0;
}

function rowRangeHint(positions, startRow, endRow) {
  if (startRow && endRow && Number.isFinite(endRow)) {
    return startRow === endRow
      ? `Row ${formatRowCode(startRow)}`
      : `Rows ${formatRowCode(startRow)}–${formatRowCode(endRow)}`;
  }
  if (startRow && !Number.isFinite(endRow)) {
    return `Rows ${formatRowCode(startRow)}+`;
  }
  const rows = [...new Set(positions.map(getPositionRowNumber).filter((n) => n > 0))].sort((a, b) => a - b);
  if (!rows.length) return 'Rows not set';
  if (rows.length === 1) return `Row ${formatRowCode(rows[0])}`;
  return `Rows ${formatRowCode(rows[0])}–${formatRowCode(rows[rows.length - 1])}`;
}

function sortZonesBottomFirst(zones, positions) {
  return zones.slice().sort((a, b) => {
    const minA = minRowForZone(positions, a.id);
    const minB = minRowForZone(positions, b.id);
    if (minA !== minB) return minA - minB;
    return String(a.zone_code || '').localeCompare(String(b.zone_code || ''), undefined, { numeric: true });
  });
}

function positionsInRowRange(positions, startRow, endRow) {
  const cap = Number.isFinite(endRow) ? endRow : Number.POSITIVE_INFINITY;
  return positions
    .filter((pos) => {
      const row = getPositionRowNumber(pos);
      return row >= startRow && row <= cap;
    })
    .sort((a, b) => a.position_code.localeCompare(b.position_code));
}

/** Zone cards for one block: every zone for that block, split by row count, higher rows on top. */
export function buildBlockZoneBands(blockPositions, options = {}) {
  const { block, allZones = [], allPositions = blockPositions } = options;
  const positions = blockPositions
    .slice()
    .sort((a, b) => a.position_code.localeCompare(b.position_code));
  const zones = sortZonesBottomFirst(
    block
      ? zonesForBlock(block, allZones, allPositions, positions)
      : uniqueZonesFromPositions(positions),
    positions,
  );

  if (!zones.length) {
    return [{
      key: 'unassigned',
      fallbackLabel: 'No irrigation zone',
      rowHint: rowRangeHint(positions),
      positions,
    }];
  }

  const counts = zones.map((zone) => parseZoneRowCount(zone));
  const useRowCounts = counts.some(Boolean);

  if (useRowCounts) {
    let start = 1;
    const bands = zones.map((zone, index) => {
      const count = counts[index];
      const isLast = index === zones.length - 1;
      const end = isLast
        ? (count ? start + count - 1 : Number.POSITIVE_INFINITY)
        : start + (count || Math.max(1, maxRowForZone(positions, zone.id) - start + 1)) - 1;
      const bandPositions = positionsInRowRange(positions, start, end);
      const band = {
        key: String(zone.id),
        fallbackLabel: zone.zone_code || 'Zone',
        rowHint: count
          ? `${count} row${count === 1 ? '' : 's'} · ${rowRangeHint(bandPositions, start, end)}`
          : rowRangeHint(bandPositions, start, end),
        positions: bandPositions,
      };
      start = Number.isFinite(end) ? end + 1 : start;
      return band;
    });
    return bands.reverse();
  }

  const assigned = zones.map((zone) => {
    const bandPositions = positions.filter((pos) => getPositionZone(pos)?.id === zone.id)
      .sort((a, b) => a.position_code.localeCompare(b.position_code));
    return {
      key: String(zone.id),
      fallbackLabel: zone.zone_code || 'Zone',
      rowHint: rowRangeHint(bandPositions),
      maxRow: maxRowForZone(positions, zone.id),
      positions: bandPositions,
    };
  }).sort((a, b) => b.maxRow - a.maxRow);

  const claimed = new Set(assigned.flatMap((band) => band.positions.map((pos) => pos.id)));
  const unassigned = positions.filter((pos) => !claimed.has(pos.id) && !getPositionZone(pos)?.id);
  if (unassigned.length) {
    assigned.push({
      key: 'unassigned',
      fallbackLabel: 'No irrigation zone',
      rowHint: rowRangeHint(unassigned),
      positions: unassigned,
    });
  }
  return assigned;
}

export function getPositionBandKey(pos, blockPositions, options = {}) {
  const bands = buildBlockZoneBands(blockPositions, options);
  const band = bands.find((item) => item.positions.some((tree) => tree.id === pos.id));
  return band?.key || 'unassigned';
}

export function positionsInBlock(positions, section) {
  return positions
    .filter((pos) => getPositionBlock(pos) === section)
    .sort((a, b) => a.position_code.localeCompare(b.position_code));
}

export function zoneTitleForPositions(positions, fallbackLabel) {
  const codes = [...new Set(positions.map(getPositionZoneCode).filter(Boolean))].sort();
  if (codes.length === 1) return codes[0];
  if (codes.length > 1) return codes.join(' · ');
  return fallbackLabel;
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
