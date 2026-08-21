/**
 * Sentinel-2 L2A index interpretation for orchard / tree crops.
 * Thresholds tuned for single-pixel tree GPS reads (noisy vs field averages).
 */

export const NDVI_STAGES = [
  { label: 'Water / Shadow', min: -Infinity, max: 0, color: 'info' },
  { label: 'Bare soil', min: 0, max: 0.12, color: 'default' },
  { label: 'Sparse / early growth', min: 0.12, max: 0.28, color: 'warning' },
  { label: 'Developing canopy', min: 0.28, max: 0.48, color: 'warning' },
  { label: 'Healthy crop', min: 0.48, max: Infinity, color: 'success' },
];

/** NDMI = (NIR − SWIR) / (NIR + SWIR) — canopy moisture / drought stress */
export const NDMI_STAGES = [
  { label: 'Very dry', min: -Infinity, max: 0.06, color: 'error' },
  { label: 'Dry', min: 0.06, max: 0.16, color: 'warning' },
  { label: 'Normal moisture', min: 0.16, max: 0.26, color: 'default' },
  { label: 'Good moisture', min: 0.26, max: 0.36, color: 'success' },
  { label: 'Very high moisture', min: 0.36, max: Infinity, color: 'info' },
];

/** NDRE = (NIR − Red Edge) / (NIR + Red Edge) — chlorophyll / nitrogen proxy */
export const NDRE_STAGES = [
  { label: 'Low nutrition', min: -Infinity, max: 0.16, color: 'error' },
  { label: 'Needs fertilizer', min: 0.16, max: 0.20, color: 'warning' },
  { label: 'Average nutrition', min: 0.20, max: 0.24, color: 'default' },
  { label: 'Good nutrition', min: 0.24, max: 0.28, color: 'success' },
  { label: 'Excellent nutrition', min: 0.28, max: Infinity, color: 'success' },
];

/** Sentinel-2 SCL class codes used for stage overrides */
export const SCL = {
  VEGETATION: 4,
  BARE_SOIL: 5,
  WATER: 6,
};

function classifyValue(value, stages) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);

  return stages.find((stage, index) => {
    const isLast = index === stages.length - 1;
    if (isLast) return v >= stage.min;
    return v >= stage.min && v < stage.max;
  }) || null;
}

export function classifyNdvi(value, scl) {
  if (scl === SCL.WATER) {
    return NDVI_STAGES.find((stage) => stage.label === 'Water / Shadow') || null;
  }
  if (scl === SCL.BARE_SOIL) {
    return NDVI_STAGES.find((stage) => stage.label === 'Bare soil') || null;
  }
  return classifyValue(value, NDVI_STAGES);
}

export function classifyNdmi(value) {
  return classifyValue(value, NDMI_STAGES);
}

export function classifyNdre(value) {
  return classifyValue(value, NDRE_STAGES);
}

/** 0 = vigorous canopy (NDVI ≥ 0.55), 1 = bare / water stressed (NDVI ≤ 0.05) */
export function computeStressFromNdvi(ndvi) {
  if (ndvi == null || !Number.isFinite(Number(ndvi))) return null;
  const v = Number(ndvi);
  if (v >= 0.55) return 0;
  if (v <= 0.05) return 1;
  return (0.55 - v) / 0.5;
}

export function formatStageRange(stage) {
  if (!stage) return '';
  if (stage.min === -Infinity) return `< ${formatBound(stage.max)}`;
  if (stage.max === Infinity) return `≥ ${formatBound(stage.min)}`;
  return `${formatBound(stage.min)}–${formatBound(stage.max)}`;
}

function formatBound(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Math.round(n * 100) / 100);
}

export function buildLegendLines(stages) {
  return stages.map((stage) => `${formatStageRange(stage)}: ${stage.label}`);
}
