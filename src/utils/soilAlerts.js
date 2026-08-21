import { formatNumber, getTreeDisplayId } from './formatters';
import { buildTreeNutrientDeficiencyReport } from './soil';

export const SOIL_NUTRIENT_ALERT_TYPE = 'Soil Nutrient';

export function isSoilNutrientAlert(alert) {
  return alert?.alert_type === SOIL_NUTRIENT_ALERT_TYPE;
}

export function getAlertNavigationPath(alert) {
  if (isSoilNutrientAlert(alert)) return '/monitoring/soil';
  return `/tree/${getTreeDisplayId(alert?.trees || {})}`;
}

/** Open alerts for dashboard, including soil nutrient rows even if DB sync failed. */
export function buildOpenActionAlerts(openAlerts, observations) {
  const deficiencies = buildTreeNutrientDeficiencyReport(observations || []);
  const alerts = openAlerts || [];
  const soilAlertTreeIds = new Set(
    alerts
      .filter(isSoilNutrientAlert)
      .map((alert) => alert.tree_id),
  );

  const syntheticSoilAlerts = deficiencies
    .filter((row) => !soilAlertTreeIds.has(row.treeId))
    .map((row) => ({
      id: `nutrient-${row.treeId}`,
      synthetic: true,
      tree_id: row.treeId,
      trees: row.trees,
      alert_type: SOIL_NUTRIENT_ALERT_TYPE,
      reason: formatLowNutrientReason(row.lowNutrients),
      status: 'Open',
    }));

  const soilAlerts = [
    ...syntheticSoilAlerts,
    ...alerts.filter(isSoilNutrientAlert),
  ];
  const otherAlerts = alerts.filter((alert) => !isSoilNutrientAlert(alert));

  return [...soilAlerts, ...otherAlerts];
}

export function formatLowNutrientReason(lowNutrients) {
  return (lowNutrients || [])
    .map((nutrient) => {
      const valueText = nutrient.value != null
        ? formatNumber(nutrient.value, nutrient.decimals ?? 2)
        : '—';
      const unitText = nutrient.unit ? ` ${nutrient.unit}` : '';
      return `${nutrient.label}: ${valueText}${unitText} (target ${nutrient.rangeLabel})`;
    })
    .join('; ');
}

function alertDateFromObservation(observedAt) {
  if (!observedAt) return new Date().toISOString().slice(0, 10);
  return String(observedAt).slice(0, 10);
}

export async function syncSoilNutrientAlerts(supabase, observations) {
  const deficiencies = buildTreeNutrientDeficiencyReport(observations);
  const deficientTreeIds = new Set(deficiencies.map((row) => row.treeId));

  const { data: openAlerts, error: loadError } = await supabase
    .from('tree_alerts')
    .select('id, tree_id, reason, status')
    .eq('alert_type', SOIL_NUTRIENT_ALERT_TYPE)
    .in('status', ['Open', 'Investigating']);

  if (loadError) {
    return { error: loadError.message, created: 0, updated: 0, resolved: 0 };
  }

  const openByTree = {};
  (openAlerts || []).forEach((alert) => {
    openByTree[alert.tree_id] = alert;
  });

  let created = 0;
  let updated = 0;
  let resolved = 0;

  for (const row of deficiencies) {
    const reason = formatLowNutrientReason(row.lowNutrients);
    const alertDate = alertDateFromObservation(row.observedAt);
    const existing = openByTree[row.treeId];

    if (existing) {
      if (existing.reason !== reason) {
        const { error } = await supabase
          .from('tree_alerts')
          .update({ reason, alert_date: alertDate })
          .eq('id', existing.id);
        if (!error) updated += 1;
      }
      continue;
    }

    const { error } = await supabase.from('tree_alerts').insert([{
      tree_id: row.treeId,
      alert_type: SOIL_NUTRIENT_ALERT_TYPE,
      severity: 'Medium',
      source: 'Soil sensor',
      reason,
      status: 'Open',
      alert_date: alertDate,
    }]);

    if (!error) created += 1;
  }

  for (const alert of openAlerts || []) {
    if (deficientTreeIds.has(alert.tree_id)) continue;

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

export async function refreshSoilNutrientAlerts(supabase) {
  const { data, error } = await supabase
    .from('soil_observations')
    .select('*')
    .order('observed_at', { ascending: false })
    .limit(500);

  if (error) {
    return { error: error.message, created: 0, updated: 0, resolved: 0 };
  }

  return syncSoilNutrientAlerts(supabase, data || []);
}
