export function climateWorkAction(warning) {
  switch (warning?.type) {
    case 'SPRAY':
      return {
        label: 'Log spray skip',
        path: '/inputs/spray',
        recommendation: 'Do not spray today. Record a skip on the Spray page if a job was planned.',
      };
    case 'SPRAY_WINDOW':
      return {
        label: 'Plan spray',
        path: '/inputs/spray',
        recommendation: 'Spray window is open. Record the spray job on the Spray page.',
      };
    case 'IRRIGATION':
    case 'ROOT_STRESS':
      return {
        label: 'Open irrigation',
        path: '/orchard/irrigation',
        recommendation: 'Review zone run time and soil moisture before the next irrigation.',
      };
    case 'DISEASE':
    case 'PEST':
      return {
        label: 'Log field check',
        path: '/monitoring/disease',
        recommendation: 'Walk the orchard and record disease or pest if confirmed.',
      };
    default:
      return {
        label: 'Open alerts',
        path: '/monitoring/alerts',
        recommendation: warning?.message || 'Review this climate advisory.',
      };
  }
}

export async function createClimateWorkItem(supabase, {
  treeId,
  zoneId,
  warning,
}) {
  const action = climateWorkAction(warning);
  const today = new Date().toISOString().slice(0, 10);

  if (!treeId && !zoneId) {
    return { error: 'No tree or irrigation zone to attach this work item to.' };
  }

  const { error: recError } = await supabase.from('recommendations').insert([{
    tree_id: treeId || null,
    zone_id: zoneId || null,
    recommended_date: today,
    recommendation_type: warning.type,
    priority: warning.level === 'HIGH' ? 'High' : 'Medium',
    reason: warning.message,
    recommendation: action.recommendation,
    status: 'Open',
    source: 'Climate',
  }]);

  if (recError) return { error: recError.message, path: action.path };

  if (treeId) {
    await supabase.from('tree_alerts').insert([{
      tree_id: treeId,
      alert_type: `Climate ${String(warning.type).replace(/_/g, ' ')}`,
      severity: warning.level === 'HIGH' ? 'High' : 'Medium',
      source: 'Climate',
      reason: warning.message,
      status: 'Open',
      alert_date: today,
    }]);
  }

  return { error: null, path: action.path, label: action.label };
}
