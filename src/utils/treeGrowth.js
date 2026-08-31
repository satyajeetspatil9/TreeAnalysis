export const GROWTH_MEASUREMENT_FIELDS = [
  { key: 'height_cm', label: 'Height', unit: 'cm' },
  { key: 'trunk_diameter_cm', label: 'Trunk', unit: 'cm' },
  { key: 'canopy_ns_cm', label: 'Canopy N-S', unit: 'cm' },
  { key: 'canopy_ew_cm', label: 'Canopy E-W', unit: 'cm' },
];

export function trunkMmToCm(mm) {
  if (mm == null || mm === '') return null;
  const value = Number(mm);
  return Number.isFinite(value) ? value / 10 : null;
}

export function trunkCmToMm(cm) {
  if (cm == null || cm === '') return null;
  const value = Number(cm);
  return Number.isFinite(value) ? value * 10 : null;
}

export function emptyGrowthForm() {
  return {
    height_cm: '',
    trunk_diameter_cm: '',
    canopy_ns_cm: '',
    canopy_ew_cm: '',
    measurement_date: new Date().toISOString().slice(0, 10),
  };
}

export function hasGrowthMeasurement(form) {
  return GROWTH_MEASUREMENT_FIELDS.some(({ key }) => form[key] !== '' && form[key] != null);
}

export function buildGrowthPayload(form) {
  return {
    measurement_date: form.measurement_date,
    height_cm: form.height_cm !== '' && form.height_cm != null ? Number(form.height_cm) : null,
    trunk_diameter_mm: trunkCmToMm(form.trunk_diameter_cm),
    canopy_ns_cm: form.canopy_ns_cm !== '' && form.canopy_ns_cm != null ? Number(form.canopy_ns_cm) : null,
    canopy_ew_cm: form.canopy_ew_cm !== '' && form.canopy_ew_cm != null ? Number(form.canopy_ew_cm) : null,
  };
}

export function buildGrowthUpdatePayload(form) {
  return buildGrowthPayload(form);
}

export function recordToGrowthForm(record) {
  return {
    height_cm: record?.height_cm ?? '',
    trunk_diameter_cm: trunkMmToCm(record?.trunk_diameter_mm) ?? '',
    canopy_ns_cm: record?.canopy_ns_cm ?? '',
    canopy_ew_cm: record?.canopy_ew_cm ?? '',
    measurement_date: record?.measurement_date?.slice?.(0, 10) || '',
  };
}

export function growthRlsHint(message) {
  if (!message) return message;
  if (message.includes('row-level security')) {
    return `${message} Run supabase/migrations/023_fix_tree_growth_rls.sql in Supabase SQL Editor.`;
  }
  return message;
}

export function pickLatestGrowthByTree(records) {
  const byTree = {};
  (records || []).forEach((record) => {
    const existing = byTree[record.tree_id];
    if (!existing || new Date(record.measurement_date) > new Date(existing.measurement_date)) {
      byTree[record.tree_id] = record;
    }
  });
  return Object.values(byTree);
}
