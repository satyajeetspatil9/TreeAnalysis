import { supabase } from '../supabaseClient';
import { getActiveTreeInstance } from './schema';
import { cornersToPolygon, parseLotBoundary, polygonToCorners } from './geo';

const MIGRATION_HINT =
  'Run supabase/migrations/006_lot_rows.sql in the Supabase SQL Editor, then reload the app.';

export const BOUNDARY_MIGRATION_HINT =
  'Run supabase/migrations/025_lot_boundary.sql in Supabase → SQL Editor, then reload the app.';

export const LOT_SATELLITE_MIGRATION_HINT =
  'Run supabase/migrations/026_lot_satellite_cache.sql in Supabase → SQL Editor, then reload the app.';

function isMissingColumnError(error, column) {
  const msg = (error?.message || '').toLowerCase();
  const col = column.toLowerCase();
  if (error?.code === '42703') return true;
  if (!msg.includes(col)) return false;
  return msg.includes('schema cache')
    || msg.includes('does not exist')
    || msg.includes('could not find');
}

function isMissingBoundaryColumn(error) {
  return isMissingColumnError(error, 'boundary');
}

function isMissingTableError(error, table) {
  const msg = (error?.message || '').toLowerCase();
  return msg.includes('schema cache') && msg.includes(table.toLowerCase());
}

/** Create a lot and link one or more rows (uses legacy row_id if section_id is not migrated yet). */
export async function createLotWithRows({ name, sectionId, rowIds }) {
  if (!rowIds?.length) throw new Error('Select at least one row.');

  const primaryRowId = Number(rowIds[0]);
  let lot = null;

  const modern = await supabase
    .from('lots')
    .insert([{ name, section_id: Number(sectionId) }])
    .select('id')
    .single();

  if (!modern.error) {
    lot = modern.data;
  } else if (isMissingColumnError(modern.error, 'section_id')) {
    const legacy = await supabase
      .from('lots')
      .insert([{ name, row_id: primaryRowId }])
      .select('id')
      .single();
    if (legacy.error) throw legacy.error;
    lot = legacy.data;
  } else {
    throw modern.error;
  }

  if (rowIds.length === 1 && !modern.error) {
    const link = await supabase.from('lot_rows').insert([{ lot_id: lot.id, row_id: primaryRowId }]);
    if (link.error && !isMissingTableError(link.error, 'lot_rows')) throw link.error;
    return lot;
  }

  if (rowIds.length === 1 && modern.error) {
    return lot;
  }

  const links = await supabase.from('lot_rows').insert(
    rowIds.map((rowId) => ({ lot_id: lot.id, row_id: Number(rowId) }))
  );

  if (links.error) {
    if (isMissingTableError(links.error, 'lot_rows')) {
      await supabase.from('lots').delete().eq('id', lot.id);
      throw new Error(`Assigning multiple rows to one lot requires the lot_rows table. ${MIGRATION_HINT}`);
    }
    throw links.error;
  }

  return lot;
}

/** Update a row name within the user's farm layout. */
export async function updateRowName(rowId, name) {
  const normalized = name.trim();
  if (!normalized) throw new Error('Row name is required.');
  const { error } = await supabase.from('rows').update({ name: normalized }).eq('id', rowId);
  if (error) throw error;
}

/** Delete a row when it is not linked to lots. */
export async function deleteRow(rowId) {
  const { count: lotLinkCount, error: lotLinkError } = await supabase
    .from('lot_rows')
    .select('*', { count: 'exact', head: true })
    .eq('row_id', rowId);
  if (lotLinkError && !isMissingTableError(lotLinkError, 'lot_rows')) throw lotLinkError;

  if ((lotLinkCount || 0) > 0) {
    throw new Error('Cannot delete row — it is assigned to one or more lots. Remove lot assignments first.');
  }

  const { count: legacyLotCount, error: legacyError } = await supabase
    .from('lots')
    .select('*', { count: 'exact', head: true })
    .eq('row_id', rowId);
  if (legacyError && !isMissingColumnError(legacyError, 'row_id')) throw legacyError;

  if ((legacyLotCount || 0) > 0) {
    throw new Error('Cannot delete row — a lot still references it.');
  }

  const { error } = await supabase.from('rows').delete().eq('id', rowId);
  if (error) throw error;
}

/** Rename a lot. */
export async function updateLotName(lotId, name) {
  const normalized = name.trim();
  if (!normalized) throw new Error('Lot name is required.');
  const { error } = await supabase.from('lots').update({ name: normalized }).eq('id', lotId);
  if (error) throw error;
}

/** Save plot boundary from 4+ corner GPS coordinates. */
export async function updateLotBoundary(lotId, corners) {
  const boundary = cornersToPolygon(corners);
  const { error } = await supabase.from('lots').update({ boundary }).eq('id', lotId);
  if (error) {
    if (isMissingBoundaryColumn(error)) {
      throw new Error(BOUNDARY_MIGRATION_HINT);
    }
    throw error;
  }
  return boundary;
}

export async function fetchLotBoundary(supabaseClient, lotId) {
  const { data, error } = await supabaseClient
    .from('lots')
    .select('boundary')
    .eq('id', lotId)
    .maybeSingle();

  if (error) {
    if (isMissingBoundaryColumn(error)) {
      throw new Error(BOUNDARY_MIGRATION_HINT);
    }
    throw error;
  }

  return parseLotBoundary(data?.boundary);
}

export async function fetchLotTreePoints(supabaseClient, lotId) {
  const { data, error } = await supabaseClient
    .from('tree_positions')
    .select('id, latitude, longitude, trees ( id, status, planting_date )')
    .eq('lot_id', lotId)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) throw error;

  return (data || [])
    .map((position) => {
      const activeTree = getActiveTreeInstance(position.trees);
      const treeId = activeTree?.id;
      if (!treeId) return null;
      return {
        positionId: position.id,
        treeId,
        latitude: Number(position.latitude),
        longitude: Number(position.longitude),
      };
    })
    .filter(Boolean);
}

export function getLotBoundaryCorners(lot) {
  return polygonToCorners(parseLotBoundary(lot?.boundary));
}

/** Delete a lot when it has no tree positions. */
export async function deleteLot(lotId) {
  const { count, error: countError } = await supabase
    .from('tree_positions')
    .select('*', { count: 'exact', head: true })
    .eq('lot_id', lotId);
  if (countError) throw countError;

  if ((count || 0) > 0) {
    throw new Error('Cannot delete lot — tree positions exist on this lot. Remove trees first.');
  }

  const { error } = await supabase.from('lots').delete().eq('id', lotId);
  if (error) throw error;
}

/** Replace row assignments for an existing lot. */
export async function assignLotRows(lotId, rowIds) {
  if (!rowIds?.length) throw new Error('Select at least one row.');

  const { error: deleteError } = await supabase.from('lot_rows').delete().eq('lot_id', lotId);
  if (deleteError) {
    if (isMissingTableError(deleteError, 'lot_rows')) {
      throw new Error(`Row assignment requires the lot_rows table. ${MIGRATION_HINT}`);
    }
    throw deleteError;
  }

  const { error: insertError } = await supabase.from('lot_rows').insert(
    rowIds.map((rowId) => ({ lot_id: lotId, row_id: Number(rowId) }))
  );

  if (insertError) throw insertError;
}

/** Returns true when lot_rows + lots.section_id exist (migration 006 applied). */
export async function hasMultiRowLotsSupport() {
  const { error: lotRowsError } = await supabase.from('lot_rows').select('lot_id').limit(0);
  if (lotRowsError) return false;
  const { error: sectionError } = await supabase.from('lots').select('section_id').limit(0);
  return !sectionError;
}

/** Load farm → phases → sections with rows and lots (works before and after migration 006). */
async function fetchLotsForLayout(sectionIds, rowIds) {
  const selectWithBoundary = 'id, name, section_id, row_id, boundary, lot_rows ( row_id, rows ( id, name ) )';
  const selectLegacy = 'id, name, row_id';

  async function queryLots(select, filter) {
    const result = await supabase.from('lots').select(select)[filter.method](filter.column, filter.values);
    if (!result.error) return result.data || [];
    if (isMissingBoundaryColumn(result.error) && select.includes('boundary')) {
      const retrySelect = select.replace(', boundary', '');
      const retry = await supabase.from('lots').select(retrySelect)[filter.method](filter.column, filter.values);
      if (retry.error) throw retry.error;
      return retry.data || [];
    }
    throw result.error;
  }

  const merged = new Map();

  if (sectionIds.length) {
    try {
      const bySection = await queryLots(selectWithBoundary, {
        method: 'in',
        column: 'section_id',
        values: sectionIds,
      });
      bySection.forEach((lot) => merged.set(lot.id, lot));
    } catch (error) {
      if (!isMissingColumnError(error, 'section_id')) throw error;
    }
  }

  if (rowIds.length) {
    const byRow = await queryLots(selectWithBoundary, {
      method: 'in',
      column: 'row_id',
      values: rowIds,
    });
    byRow.forEach((lot) => merged.set(lot.id, lot));
  }

  if (!merged.size && rowIds.length) {
    const legacyLots = await queryLots(selectLegacy, {
      method: 'in',
      column: 'row_id',
      values: rowIds,
    });
    legacyLots.forEach((lot) => merged.set(lot.id, { ...lot, lot_rows: [] }));
  }

  return [...merged.values()];
}

export async function fetchFarmLayout(farmId) {
  const { data: farmBase, error: farmError } = await supabase
    .from('farms')
    .select('id, name')
    .eq('id', farmId)
    .maybeSingle();

  if (farmError) throw farmError;
  if (!farmBase) return null;

  const { data: phases, error: phaseError } = await supabase
    .from('phases')
    .select('id, name, sections ( id, name, rows ( id, name ) )')
    .eq('farm_id', farmId);

  if (phaseError) throw phaseError;

  const sections = (phases || []).flatMap((p) => p.sections || []);
  const sectionIds = sections.map((s) => s.id);
  const rowIds = sections.flatMap((s) => (s.rows || []).map((r) => r.id));

  let lots = [];
  if (sectionIds.length || rowIds.length) {
    try {
      lots = await fetchLotsForLayout(sectionIds, rowIds);
    } catch (error) {
      if (isMissingTableError(error, 'lot_rows')) {
        const fallback = await supabase.from('lots').select('id, name, section_id, row_id, boundary').in('section_id', sectionIds);
        if (fallback.error && isMissingBoundaryColumn(fallback.error)) {
          const noBoundary = await supabase.from('lots').select('id, name, section_id, row_id').in('section_id', sectionIds);
          if (noBoundary.error) throw noBoundary.error;
          lots = (noBoundary.data || []).map((lot) => ({ ...lot, lot_rows: [] }));
        } else {
          if (fallback.error) throw fallback.error;
          lots = (fallback.data || []).map((lot) => ({ ...lot, lot_rows: [] }));
        }
      } else {
        throw error;
      }
    }
  }

  const sectionsWithLots = sections.map((section) => {
    const sectionRowIds = new Set((section.rows || []).map((row) => row.id));
    const sectionLots = lots.filter((lot) => {
      if (lot.section_id != null) return lot.section_id === section.id;
      if (lot.lot_rows?.length) {
        return lot.lot_rows.some((link) => sectionRowIds.has(link.row_id));
      }
      return sectionRowIds.has(lot.row_id);
    });
    return { ...section, lots: sectionLots };
  });

  return {
    ...farmBase,
    phases: (phases || []).map((phase) => ({
      ...phase,
      sections: sectionsWithLots.filter((s) =>
        (phase.sections || []).some((ps) => ps.id === s.id)
      ),
    })),
  };
}
