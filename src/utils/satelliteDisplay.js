import { formatNumber } from './formatters';

/** Plain-language copy for orchard-planetary API index_status and stress fields. */

export const SATELLITE_INDEX_INFO = {
  NDVI: {
    title: 'Tree greenness',
    short: 'Canopy health & leaf density',
    hint: 'Higher usually means more active, healthy leaves.',
  },
  NDMI: {
    title: 'Moisture in soil & leaves',
    short: 'Water stress signal from satellite',
    hint: 'Low values often mean dry soil or drought stress.',
  },
  NDRE: {
    title: 'Leaf nitrogen signal',
    short: 'Nutrient status in the canopy',
    hint: 'Low values can mean nitrogen is limiting growth.',
  },
  S1_VV: {
    title: 'Radar moisture signal',
    short: 'Under-canopy moisture (Sentinel-1)',
    hint: 'Used to detect unusual wetness changes over time.',
  },
};

const INDEX_STATUS_FRIENDLY = {
  'very low': {
    label: 'Very low',
    summary: 'Very sparse canopy — vegetation is weak at this spot.',
    action: 'Inspect tree health, irrigation, and recent stress events.',
  },
  low: {
    label: 'Low',
    summary: 'Below-normal greenness for a healthy tree.',
    action: 'Compare with neighbouring trees; check water and pests.',
  },
  moderate: {
    label: 'Fair',
    summary: 'Moderate canopy cover — room to improve.',
    action: 'Monitor over the next 2–4 weeks.',
  },
  good: {
    label: 'Good',
    summary: 'Canopy looks reasonably healthy.',
    action: 'Continue normal orchard care.',
  },
  healthy: {
    label: 'Healthy',
    summary: 'Strong, vigorous canopy at this location.',
    action: 'No immediate action needed from satellite view.',
  },
  'very dry': {
    label: 'Very dry',
    summary: 'Soil and leaves appear very dry.',
    action: 'Priority: check drip irrigation and soil moisture.',
  },
  dry: {
    label: 'Dry',
    summary: 'Moisture is below comfortable levels.',
    action: 'Consider irrigation if soil probe also reads low.',
  },
  'normal moisture': {
    label: 'OK',
    summary: 'Moisture is in a normal range.',
    action: 'No water stress signal from satellite.',
  },
  'good moisture': {
    label: 'Good',
    summary: 'Adequate moisture in soil and leaves.',
    action: 'Irrigation appears sufficient for now.',
  },
  'very high moisture': {
    label: 'Very wet',
    summary: 'Very high moisture — possible over-irrigation or drainage issue.',
    action: 'Check for waterlogging after heavy rain or long irrigation.',
  },
  'low nutrient indicator': {
    label: 'Low nutrients',
    summary: 'Leaves may be short on nitrogen.',
    action: 'Compare with soil test; consider fertigation if soil N is low.',
  },
  'moderate nutrient indicator': {
    label: 'Borderline nutrients',
    summary: 'Canopy nutrient signal is middling.',
    action: 'Watch with next soil report before changing fertilizer.',
  },
  'no data': {
    label: 'No data',
    summary: 'Satellite could not estimate this value for the period.',
    action: 'Cloud cover or image quality may have blocked the reading.',
  },
  'earlier radar': {
    label: 'Earlier radar',
    summary: 'Last stored Sentinel-1 wetness signal.',
    action: null,
  },
};

const STRESS_STATUS_FRIENDLY = {
  'earlier radar': {
    label: 'Earlier radar',
    summary: 'Last stored Sentinel-1 wetness signal.',
    action: null,
  },
  'no stress': {
    label: 'No stress',
    summary: 'No significant water stress detected.',
    action: 'Continue normal irrigation schedule.',
  },
  normal: {
    label: 'Normal',
    summary: 'Water status looks normal.',
    action: 'No change needed based on satellite alone.',
  },
  'mild stress': {
    label: 'Mild stress',
    summary: 'Early sign of water stress.',
    action: 'Verify soil moisture at the tree base.',
  },
  'moderate stress': {
    label: 'Moderate stress',
    summary: 'Clear water-stress signal.',
    action: 'Review irrigation timing and emitter output.',
  },
  'high stress': {
    label: 'High stress',
    summary: 'Strong water-stress signal.',
    action: 'Inspect irrigation and tree urgently.',
  },
  'no significant radar anomaly': {
    label: 'Normal',
    summary: 'No unusual radar wetness change detected.',
    action: 'Radar baseline looks stable.',
  },
  'moderate nutrient stress indicator': {
    label: 'Moderate nutrient stress',
    summary: 'Canopy may need more nutrients.',
    action: 'Use with soil lab report before adjusting fertilizer.',
  },
  'mild nutrient stress indicator': {
    label: 'Mild nutrient stress',
    summary: 'Slight nutrient stress in canopy.',
    action: 'Monitor; confirm with soil testing.',
  },
  'high nutrient stress indicator': {
    label: 'High nutrient stress',
    summary: 'Strong nutrient stress signal in leaves.',
    action: 'Review N/P/K from soil test and fertigation plan.',
  },
  'severe nutrient stress indicator': {
    label: 'Severe nutrient stress',
    summary: 'Very low canopy nutrient signal.',
    action: 'Field visit and soil test recommended.',
  },
  'no nutrient stress': {
    label: 'No nutrient stress',
    summary: 'Canopy nutrient signal looks fine.',
    action: 'No nutrient action needed from satellite alone.',
  },
};

const OVERALL_STATUS_FRIENDLY = {
  critical: {
    headline: 'Critical',
    summary: 'Multiple severe stress signals — inspect this tree as soon as possible.',
  },
  'high stress': {
    headline: 'High stress',
    summary: 'Strong stress across several indicators — field visit recommended.',
  },
  'moderate stress': {
    headline: 'Needs attention',
    summary: 'Some stress signals — worth a field check this week.',
  },
  'attention required': {
    headline: 'Needs attention',
    summary: 'Multiple stress indicators — inspect this tree soon.',
  },
  healthy: {
    headline: 'Looking good',
    summary: 'Satellite signals are broadly healthy for this period.',
  },
};

function normalizeKey(text) {
  return String(text || '').trim().toLowerCase();
}

export function friendlyIndexStatus(rawStatus) {
  const key = normalizeKey(rawStatus);
  return INDEX_STATUS_FRIENDLY[key] || {
    label: rawStatus || 'Unknown',
    summary: rawStatus || 'Status not available.',
    action: null,
  };
}

export function friendlyStressStatus(rawStatus) {
  const key = normalizeKey(rawStatus);
  return STRESS_STATUS_FRIENDLY[key] || friendlyIndexStatus(rawStatus);
}

export function friendlyOverallStatus(status, severity) {
  const key = normalizeKey(status || severity);
  return OVERALL_STATUS_FRIENDLY[key] || {
    headline: status || severity || 'Summary',
    summary: severity || status || 'See details below.',
  };
}

export function friendlyReason(reason) {
  const map = {
    'Low vegetation (NDVI)': 'Canopy looks thin (low greenness)',
    'Dry condition (NDMI)': 'Dry soil / leaf moisture',
    'Moderate nutrient indicator (NDRE)': 'Possible low leaf nitrogen',
    'Moderate stress water stress': 'Moderate water stress',
    'Moderate nutrient stress indicator': 'Moderate nutrient stress',
    'Very low vegetation (NDVI)': 'Very thin canopy',
    'Below-normal moisture (NDMI)': 'Below-normal moisture',
    'Low nutrient indicator (NDRE)': 'Low leaf nitrogen signal',
    'High stress water stress': 'High water stress',
    'Severe nutrient stress indicator': 'Severe nutrient stress',
    'Moderate-high radar water-stress indicator': 'Moderate–high radar wetness signal',
    'Moderate-high radar water-stress indicator radar water-stress indicator': 'Moderate–high radar wetness signal',
  };
  return map[reason] || reason;
}

/** MUI Chip color: error | warning | success | info | default */
export function stressLevelColor(label) {
  return severityToChipColor(label);
}

export function severityToChipColor(text) {
  const value = normalizeKey(text);
  if (value.includes('moderate-high') || value.includes('moderate–high')) {
    return 'warning';
  }
  if (
    value.includes('critical')
    || value.includes('severe')
    || value.includes('very low')
    || value.includes('very dry')
    || value.includes('very thin')
    || value.includes('high stress')
    || value.includes('high water')
  ) {
    return 'error';
  }
  if (
    value.includes('high')
    || value.includes('dry')
    || value.includes('attention')
  ) {
    return 'error';
  }
  if (
    value.includes('moderate')
    || value.includes('mild')
    || value.includes('borderline')
    || value.includes('fair')
    || value.includes('low')
    || value.includes('thin')
  ) {
    return 'warning';
  }
  if (
    value.includes('healthy')
    || value.includes('good')
    || value.includes('normal')
    || value.includes('no stress')
    || value.includes('ok')
    || value.includes('looking good')
  ) {
    return 'success';
  }
  return 'default';
}

export function confidenceChipColor(confidence) {
  const value = normalizeKey(confidence);
  if (value.includes('high')) return 'success';
  if (value.includes('medium') || value.includes('moderate')) return 'warning';
  if (value.includes('low')) return 'error';
  return 'info';
}

export function stressPercentLevel(stressPercentage) {
  const pct = Number(stressPercentage);
  if (Number.isNaN(pct)) return 'unknown';
  if (pct >= 85) return 'critical';
  if (pct >= 60) return 'high';
  if (pct >= 35) return 'moderate';
  return 'low';
}

export function stressPercentTextColor(stressPercentage) {
  const level = stressPercentLevel(stressPercentage);
  if (level === 'critical' || level === 'high') return 'error.main';
  if (level === 'moderate') return 'warning.main';
  return 'success.main';
}

export function overallStressLevel(severity, stressPercentage) {
  const level = stressPercentLevel(stressPercentage);
  const severityKey = normalizeKey(severity);
  if (level === 'critical' || severityKey.includes('critical')) return 'critical';
  if (level === 'high' || severityKey.includes('high stress') || severityKey.includes('attention')) return 'high';
  if (level === 'moderate' || severityKey.includes('moderate')) return 'moderate';
  return 'low';
}

export function reasonChipColor(rawReason) {
  const friendly = friendlyReason(rawReason);
  const combined = `${rawReason} ${friendly}`;
  return severityToChipColor(combined);
}

export function formatTechnicalIndex(key, value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const labels = {
    NDVI: 'Greenness index',
    NDMI: 'Moisture index',
    NDRE: 'Nutrient index',
    S1_VV: 'Radar value',
  };
  return `${labels[key] || key}: ${formatNumber(value, 3)}`;
}

export function overallActionHint(stressPercentage) {
  if (stressPercentage == null) return null;
  const pct = Number(stressPercentage);
  if (pct >= 70) return 'Visit this tree and check irrigation, pests, and recent damage.';
  if (pct >= 45) return 'Schedule a field check when convenient.';
  return 'Routine monitoring is enough unless you see issues on the ground.';
}

export function actionHintColor(stressPercentage) {
  const level = stressPercentLevel(stressPercentage);
  if (level === 'critical' || level === 'high') return 'error.main';
  if (level === 'moderate') return 'warning.main';
  return 'text.secondary';
}
