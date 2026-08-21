import { formatNumber } from './formatters';
import { getLotAssignedRows, getLotSectionName } from './positionCode';

export const SATELLITE_STRESS_ALERT_TYPE = 'SATELLITE_STRESS';
export const STRESS_ALERT_THRESHOLD = 0.6;

export function stressSeverity(stressScore) {
  const score = Number(stressScore);
  if (!Number.isFinite(score)) return 'Medium';
  if (score >= 0.8) return 'High';
  if (score >= STRESS_ALERT_THRESHOLD) return 'Medium';
  return 'Low';
}

export function formatStressReason(observation) {
  const parts = [];
  if (observation.stress_score != null) {
    parts.push(`Stress ${formatNumber(observation.stress_score, 2)}`);
  }
  if (observation.ndvi != null) {
    parts.push(`NDVI ${formatNumber(observation.ndvi, 3)}`);
  }
  if (observation.affected_area_sq_m != null) {
    parts.push(`${formatNumber(observation.affected_area_sq_m, 0)} m² affected`);
  }
  const scope = observation.section_id ? 'section stress' : 'farm stress';
  return parts.length ? `${parts.join(' · ')} (${scope})` : `Satellite ${scope}`;
}

export function getTreeLot(tree) {
  return tree?.tree_positions?.lots || null;
}

export function getTreeSectionId(tree) {
  const lot = getTreeLot(tree);
  return lot?.section_id || lot?.sections?.id || getLotAssignedRows(lot)[0]?.section_id || null;
}

export function getTreeSectionName(tree) {
  const lot = getTreeLot(tree);
  return getLotSectionName(lot) || '—';
}

export function getTreeRowLabel(tree) {
  const lot = getTreeLot(tree);
  const rows = getLotAssignedRows(lot).map((row) => row.name).filter(Boolean);
  if (!rows.length) return '—';
  if (rows.length <= 3) return rows.join(', ');
  return `${rows[0]}–${rows[rows.length - 1]} (${rows.length} rows)`;
}

export function observationAppliesToTree(observation, sectionId) {
  if (!observation) return false;
  if (observation.section_id == null) return true;
  if (sectionId == null) return false;
  return Number(observation.section_id) === Number(sectionId);
}

export function filterObservationsForTree(observations, sectionId) {
  return (observations || []).filter((row) => observationAppliesToTree(row, sectionId));
}

export function buildSatelliteChartData(observations) {
  return [...(observations || [])]
    .slice()
    .sort((a, b) => String(a.observation_date).localeCompare(String(b.observation_date)))
    .map((row) => ({
      dateKey: String(row.observation_date).slice(0, 10),
      label: new Date(row.observation_date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      ndvi: row.ndvi != null ? Number(row.ndvi) : null,
      stress: row.stress_score != null ? Number(row.stress_score) : null,
    }));
}

export async function fetchActiveTreesInSection(supabase, sectionId) {
  if (!sectionId) return [];

  const { data: lots, error: lotsError } = await supabase
    .from('lots')
    .select('id')
    .eq('section_id', sectionId);

  if (lotsError) throw lotsError;
  const lotIds = (lots || []).map((lot) => lot.id);
  if (!lotIds.length) return [];

  const { data: positions, error: positionsError } = await supabase
    .from('tree_positions')
    .select('id, trees(id, status)')
    .in('lot_id', lotIds);

  if (positionsError) throw positionsError;

  const trees = [];
  (positions || []).forEach((position) => {
    (position.trees || []).forEach((tree) => {
      if (tree.status === 'Active') trees.push(tree);
    });
  });

  return trees;
}

export async function syncSatelliteStressAlerts(supabase, observations) {
  const latestBySection = {};

  (observations || []).forEach((row) => {
    if (!row.section_id) return;
    const sectionId = Number(row.section_id);
    const existing = latestBySection[sectionId];
    if (!existing || String(row.observation_date) > String(existing.observation_date)) {
      latestBySection[sectionId] = row;
    }
  });

  const stressedSections = Object.values(latestBySection).filter(
    (row) => Number(row.stress_score) >= STRESS_ALERT_THRESHOLD,
  );

  const { data: openAlerts, error: loadError } = await supabase
    .from('tree_alerts')
    .select('id, tree_id, reason, status, alert_date, severity')
    .eq('alert_type', SATELLITE_STRESS_ALERT_TYPE)
    .in('status', ['Open', 'Investigating']);

  if (loadError) {
    return { error: loadError.message, created: 0, updated: 0, resolved: 0 };
  }

  const activeTreeIds = new Set();
  let created = 0;
  let updated = 0;

  for (const observation of stressedSections) {
    const trees = await fetchActiveTreesInSection(supabase, observation.section_id);
    const reason = formatStressReason(observation);
    const alertDate = String(observation.observation_date).slice(0, 10);
    const severity = stressSeverity(observation.stress_score);

    for (const tree of trees) {
      activeTreeIds.add(tree.id);
      const existing = (openAlerts || []).find((alert) => alert.tree_id === tree.id);

      if (existing) {
        if (existing.reason !== reason || existing.alert_date !== alertDate || existing.severity !== severity) {
          const { error } = await supabase
            .from('tree_alerts')
            .update({ reason, alert_date: alertDate, severity })
            .eq('id', existing.id);
          if (!error) updated += 1;
        }
        continue;
      }

      const { error } = await supabase.from('tree_alerts').insert([{
        tree_id: tree.id,
        alert_type: SATELLITE_STRESS_ALERT_TYPE,
        severity,
        source: 'Satellite',
        reason,
        status: 'Open',
        alert_date: alertDate,
      }]);

      if (!error) created += 1;
    }
  }

  let resolved = 0;
  for (const alert of openAlerts || []) {
    if (activeTreeIds.has(alert.tree_id)) continue;

    const { error } = await supabase
      .from('tree_alerts')
      .update({
        status: 'Resolved',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', alert.id);

    if (!error) resolved += 1;
  }

  return { error: null, created, updated, resolved };
}

export async function refreshSatelliteStressAlerts(supabase, farmId) {
  if (!farmId) {
    return { error: null, created: 0, updated: 0, resolved: 0 };
  }

  const { data, error } = await supabase
    .from('satellite_observations')
    .select('*')
    .eq('farm_id', farmId)
    .order('observation_date', { ascending: false })
    .limit(100);

  if (error) {
    return { error: error.message, created: 0, updated: 0, resolved: 0 };
  }

  return syncSatelliteStressAlerts(supabase, data || []);
}
