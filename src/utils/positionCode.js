/** Orchard position code: A-R01-L01-T01 = Block-Row-Lot-Tree */

export const VALID_SECTIONS = ['A', 'B'];
export const VALID_LOT_CODES = ['L01', 'L02'];

const POSITION_CODE_REGEX = /^([AB])-(R\d{2})-(L\d{2})-(T\d{2})$/i;

export function parsePositionCode(code) {
  if (!code) return null;
  const match = String(code).trim().toUpperCase().match(POSITION_CODE_REGEX);
  if (!match) return null;
  return {
    section: match[1],
    row: match[2],
    lot: match[3],
    tree: match[4],
  };
}

/** Extract A-R01-L01-T01 from plain text, URLs, or labels in a QR scan. */
export function extractPositionCodeFromScan(rawText) {
  if (!rawText) return null;

  const text = String(rawText).trim();
  const direct = parsePositionCode(text);
  if (direct) return buildPositionCode(direct);

  const embedded = text.toUpperCase().match(/([AB]-R\d{2}-L\d{2}-T\d{2})/);
  if (embedded) {
    const parsed = parsePositionCode(embedded[1]);
    if (parsed) return buildPositionCode(parsed);
  }

  return null;
}

export function findLotForPositionCode(lots, code) {
  const parsed = parsePositionCode(code);
  if (!parsed) return null;
  return (lots || []).find((lot) => lotMatchesPositionCode(lot, code)) || null;
}

export function buildPositionCode({ section, row, lot, tree }) {
  const s = String(section || '').trim().toUpperCase();
  const r = normalizeRow(row);
  const l = normalizeLot(lot);
  const t = normalizeTree(tree);
  if (!s || !r || !l || !t) return '';
  return `${s}-${r}-${l}-${t}`;
}

export function normalizeRow(value) {
  if (!value) return '';
  const raw = String(value).trim().toUpperCase();
  if (/^R\d{2}$/.test(raw)) return raw;
  const num = raw.replace(/^R/, '');
  if (/^\d+$/.test(num)) return `R${num.padStart(2, '0')}`;
  return raw;
}

export function normalizeLot(value) {
  if (!value) return '';
  const raw = String(value).trim().toUpperCase();
  if (/^L\d{2}$/.test(raw)) return raw;
  const num = raw.replace(/^L/, '');
  if (/^\d+$/.test(num)) return `L${num.padStart(2, '0')}`;
  return raw;
}

export function normalizeTree(value) {
  if (!value) return '';
  const raw = String(value).trim().toUpperCase();
  if (/^T\d{2}$/.test(raw)) return raw;
  const num = raw.replace(/^T/, '');
  if (/^\d+$/.test(num)) return `T${num.padStart(2, '0')}`;
  return raw;
}

export function getLotSectionName(lot) {
  return lot?.sections?.name
    || lot?.rows?.sections?.name
    || getLotAssignedRows(lot)[0]?.sections?.name
    || null;
}

export function getLotAssignedRows(lot) {
  if (lot?.lot_rows?.length) {
    return lot.lot_rows.map((lr) => lr.rows).filter(Boolean);
  }
  if (lot?.rows) return [lot.rows];
  return [];
}

export function getLotRowNames(lot) {
  return getLotAssignedRows(lot)
    .map((row) => normalizeRow(row.name))
    .filter(Boolean)
    .sort();
}

export function formatLotRowAssignment(lot) {
  const names = getLotRowNames(lot);
  if (!names.length) return '—';
  if (names.length <= 4) return names.join(', ');
  return `${names[0]} … ${names[names.length - 1]} (${names.length} rows)`;
}

export function formatLotPath(lot) {
  const block = getLotSectionName(lot) || '?';
  const lotCode = normalizeLot(lot?.name) || lot?.name || '?';
  const rows = formatLotRowAssignment(lot);
  return `${block} / ${lotCode} (${rows})`;
}

export function formatLocationLabel(parsed) {
  if (!parsed) return '';
  return `${parsed.section} · ${parsed.row} · ${parsed.lot} · ${parsed.tree}`;
}

export function lotMatchesPositionCode(lot, code) {
  const parsed = parsePositionCode(code);
  if (!parsed || !lot) return false;
  const blockName = getLotSectionName(lot)?.toUpperCase();
  const lotName = normalizeLot(lot.name);
  const rowNames = getLotRowNames(lot);
  return blockName === parsed.section && lotName === parsed.lot && rowNames.includes(parsed.row);
}

export const LOT_SELECT = `
  id,
  name,
  section_id,
  sections ( name ),
  lot_rows ( row_id, rows ( id, name, sections ( name ) ) )
`;
