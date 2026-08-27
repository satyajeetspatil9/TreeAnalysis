import {
  MOISTURE_PERCENT_ADEQUATE_MAX,
  MOISTURE_PERCENT_ADEQUATE_MIN,
} from './soilSensorMoisture';

export const SENSOR_READING_FIELDS = [
  { key: 'moisture_percent', label: 'Moisture', unit: '%', decimals: 0, standardKey: 'moisture_percent' },
  { key: 'ph', label: 'pH', decimals: 1, standardKey: 'ph' },
  { key: 'ec', label: 'EC', unit: 'dS/m', decimals: 2, standardKey: 'ec' },
  { key: 'temperature_c', label: 'Temperature', unit: '°C', decimals: 1 },
  { key: 'nitrogen', label: 'N', decimals: 2, standardKey: 'nitrogen', unit: 'kg/ha' },
  { key: 'phosphorus', label: 'P', decimals: 2, standardKey: 'phosphorus', unit: 'kg/ha' },
  { key: 'potassium', label: 'K', decimals: 2, standardKey: 'potassium', unit: 'kg/ha' },
];

export const LAB_NUTRIENT_FIELDS = [
  { key: 'sulphur', label: 'S', unit: 'ppm', standardKey: 'sulphur' },
  { key: 'zinc', label: 'Zn', unit: 'ppm', standardKey: 'zinc' },
  { key: 'boron', label: 'B', unit: 'ppm', standardKey: 'boron' },
  { key: 'iron', label: 'Fe', unit: 'ppm', standardKey: 'iron' },
  { key: 'manganese', label: 'Mn', unit: 'ppm', standardKey: 'manganese' },
  { key: 'copper', label: 'Cu', unit: 'ppm', standardKey: 'copper' },
  { key: 'organic_carbon', label: 'OC', unit: 'w%', standardKey: 'organic_carbon' },
];

/** Required soil nutrient ranges for mango orchard (Devgad). */
export const SOIL_NUTRIENT_STANDARDS = {
  // Moisture % is derived from raw Modbus m: m≤30 → 0%, m≥250 → 100%.
  // Adequate band on raw m is 100–180 (see soilSensorMoisture.js).
  moisture_percent: {
    label: 'Moisture',
    unit: '%',
    min: MOISTURE_PERCENT_ADEQUATE_MIN,
    max: MOISTURE_PERCENT_ADEQUATE_MAX,
    okLabel: 'Adequate',
    rangeLabel: `< ${Math.round(MOISTURE_PERCENT_ADEQUATE_MIN)}% low · ${Math.round(MOISTURE_PERCENT_ADEQUATE_MIN)}–${Math.round(MOISTURE_PERCENT_ADEQUATE_MAX)}% adequate · > ${Math.round(MOISTURE_PERCENT_ADEQUATE_MAX)}% high`,
  },
  nitrogen: { label: 'N', unit: 'kg/ha', min: 280, max: 560, rangeLabel: '280–560 kg/ha' },
  phosphorus: { label: 'P', unit: 'kg/ha', min: 10, max: 25, rangeLabel: '10–25 kg/ha' },
  potassium: { label: 'K', unit: 'kg/ha', min: 120, max: 280, rangeLabel: '120–280 kg/ha' },
  ph: { label: 'pH', min: 5.5, max: 8.5, rangeLabel: '5.5–8.5' },
  ec: { label: 'EC', unit: 'dS/m', max: 1, exclusiveMax: true, rangeLabel: '< 1 dS/m' },
  organic_carbon: {
    label: 'OC',
    unit: 'w%',
    min: 0.5,
    idealMin: 0.75,
    higherIsGood: true,
    rangeLabel: '0.5–0.75 w% (higher is good)',
  },
  sulphur: { label: 'S', unit: 'ppm', min: 10, higherIsGood: true, rangeLabel: '> 10 ppm' },
  zinc: { label: 'Zn', unit: 'ppm', min: 0.6, higherIsGood: true, rangeLabel: '> 0.6 ppm' },
  boron: { label: 'B', unit: 'ppm', min: 0.5, higherIsGood: true, rangeLabel: '> 0.5 ppm' },
  iron: { label: 'Fe', unit: 'ppm', min: 4.5, higherIsGood: true, rangeLabel: '> 4.5 ppm' },
  manganese: { label: 'Mn', unit: 'ppm', min: 2, higherIsGood: true, rangeLabel: '> 2 ppm' },
  copper: { label: 'Cu', unit: 'ppm', min: 0.2, higherIsGood: true, rangeLabel: '> 0.2 ppm' },
};

export const SOIL_STANDARDS_REFERENCE = [
  SOIL_NUTRIENT_STANDARDS.moisture_percent,
  SOIL_NUTRIENT_STANDARDS.nitrogen,
  SOIL_NUTRIENT_STANDARDS.phosphorus,
  SOIL_NUTRIENT_STANDARDS.potassium,
  SOIL_NUTRIENT_STANDARDS.ph,
  SOIL_NUTRIENT_STANDARDS.ec,
  SOIL_NUTRIENT_STANDARDS.organic_carbon,
  SOIL_NUTRIENT_STANDARDS.sulphur,
  SOIL_NUTRIENT_STANDARDS.zinc,
  SOIL_NUTRIENT_STANDARDS.boron,
  SOIL_NUTRIENT_STANDARDS.iron,
  SOIL_NUTRIENT_STANDARDS.manganese,
  SOIL_NUTRIENT_STANDARDS.copper,
];

export function getSoilStandard(standardKey) {
  return standardKey ? SOIL_NUTRIENT_STANDARDS[standardKey] : null;
}

export function fieldLabelWithUnit(field) {
  if (!field) return '';
  return field.unit ? `${field.label} (${field.unit})` : field.label;
}

export function evaluateSoilStandard(standard, value) {
  if (!standard || value == null || value === '' || Number.isNaN(Number(value))) {
    return { status: 'unknown', label: '' };
  }

  const v = Number(value);

  if (standard.exclusiveMax && standard.max != null) {
    if (v < standard.max) return { status: 'good', label: 'OK' };
    return { status: 'high', label: 'High' };
  }

  if (standard.higherIsGood && standard.min != null) {
    if (standard.idealMin != null && v >= standard.idealMin) {
      return { status: 'good', label: 'Good' };
    }
    // Targets like "> 10 ppm" mean the minimum itself is still deficient.
    if (standard.idealMin != null) {
      if (v >= standard.min) return { status: 'ok', label: 'OK' };
    } else if (v > standard.min) {
      return { status: 'ok', label: 'OK' };
    }
    return { status: 'low', label: 'Low' };
  }

  if (standard.min != null && standard.max != null) {
    const okLabel = standard.okLabel || 'OK';
    if (v >= standard.min && v <= standard.max) return { status: 'good', label: okLabel };
    if (v < standard.min) return { status: 'low', label: 'Low' };
    return { status: 'high', label: 'High' };
  }

  if (standard.min != null) {
    if (v >= standard.min) return { status: 'good', label: 'OK' };
    return { status: 'low', label: 'Low' };
  }

  return { status: 'unknown', label: '' };
}

export function soilStatusColor(status) {
  if (status === 'good' || status === 'ok') return 'success.main';
  if (status === 'low') return 'warning.main';
  if (status === 'high') return 'error.main';
  return 'text.secondary';
}

export function soilRangeStatus(standardKey, value) {
  return evaluateSoilStandard(getSoilStandard(standardKey), value);
}

export function soilRangePaletteKey(standardKey, value) {
  const { status } = soilRangeStatus(standardKey, value);
  if (status === 'low') return 'warning';
  if (status === 'high') return 'error';
  if (status === 'good' || status === 'ok') return 'success';
  return null;
}

export function soilReadingCellSx(standardKey, value) {
  if (value == null || value === '') return undefined;
  const { status } = soilRangeStatus(standardKey, value);
  if (status === 'unknown') return undefined;
  return { color: soilStatusColor(status), fontWeight: 700 };
}

export function soilValueColor(standardKey, value) {
  return soilStatusColor(soilRangeStatus(standardKey, value).status);
}

export function soilRangeCardSx(standardKey, value) {
  const paletteKey = soilRangePaletteKey(standardKey, value);
  return (theme) => {
    if (!paletteKey) {
      return { bgcolor: theme.palette.action.hover };
    }
    const color = theme.palette[paletteKey].main;
    return {
      bgcolor: `${color}29`,
      border: '1px solid',
      borderColor: color,
    };
  };
}

export function soilRangeFieldSx(standardKey, value) {
  const color = soilValueColor(standardKey, value);
  return {
    '& .MuiInputBase-input': { color, fontWeight: 700 },
    '& .MuiFormHelperText-root': { color },
  };
}

export function soilStatusChipSx(status) {
  return {
    height: 28,
    bgcolor: 'transparent',
    border: 1,
    borderColor: soilStatusColor(status),
    color: soilStatusColor(status),
    '& .MuiChip-label': {
      fontSize: '0.875rem',
      fontWeight: 600,
      px: 1,
      py: 0.25,
    },
  };
}

export function soilStatusBadgeSx(status) {
  return {
    px: 1,
    py: 0.5,
    border: 1,
    borderRadius: 1,
    borderColor: soilStatusColor(status),
    color: soilStatusColor(status),
    fontSize: '0.875rem',
    fontWeight: 600,
    lineHeight: 1.2,
  };
}

export const SENSOR_SOURCE = 'SENSOR';
export const SENSOR_METHOD = '7-in-1 sensor';
export const LEGACY_SENSOR_METHOD = '8-in-1 sensor';

export function formatSensorMethodLabel(method) {
  if (!method || method === LEGACY_SENSOR_METHOD) return SENSOR_METHOD;
  return method;
}

export function emptySensorForm() {
  return {
    observed_at: new Date().toISOString().slice(0, 10),
    moisture_percent: '',
    ph: '',
    ec: '',
    temperature_c: '',
    nitrogen: '',
    phosphorus: '',
    potassium: '',
  };
}

export function emptyLabForm() {
  return {
    sample_date: new Date().toISOString().slice(0, 10),
    lab_name: '',
    sulphur: '',
    zinc: '',
    iron: '',
    manganese: '',
    boron: '',
    copper: '',
    organic_carbon: '',
  };
}

export function buildSensorObservationPayload(treeId, form) {
  const payload = {
    tree_id: treeId,
    source: SENSOR_SOURCE,
    method: SENSOR_METHOD,
    observed_at: form.observed_at ? `${form.observed_at}T12:00:00` : undefined,
  };

  SENSOR_READING_FIELDS.forEach(({ key }) => {
    payload[key] = form[key] !== '' && form[key] != null ? Number(form[key]) : null;
  });

  return payload;
}

export function buildSensorUpdatePayload(form, treeId) {
  const payload = {
    tree_id: treeId,
    source: SENSOR_SOURCE,
    method: SENSOR_METHOD,
    observed_at: form.observed_at ? `${form.observed_at}T12:00:00` : undefined,
  };

  SENSOR_READING_FIELDS.forEach(({ key }) => {
    payload[key] = form[key] !== '' && form[key] != null ? Number(form[key]) : null;
  });

  return payload;
}

export function observationToForm(observation) {
  const form = emptySensorForm();
  if (!observation) return form;

  form.observed_at = observation.observed_at
    ? new Date(observation.observed_at).toISOString().slice(0, 10)
    : form.observed_at;
  SENSOR_READING_FIELDS.forEach(({ key }) => {
    form[key] = observation[key] != null ? String(observation[key]) : '';
  });
  return form;
}

export function buildLabReportPayload(farmId, form) {
  const payload = {
    farm_id: farmId,
    sample_date: form.sample_date,
    lab_name: form.lab_name || null,
  };

  LAB_NUTRIENT_FIELDS.forEach(({ key }) => {
    payload[key] = form[key] !== '' && form[key] != null ? Number(form[key]) : null;
  });

  return payload;
}

export function buildLabUpdatePayload(form) {
  const payload = {
    sample_date: form.sample_date,
    lab_name: form.lab_name || null,
  };

  LAB_NUTRIENT_FIELDS.forEach(({ key }) => {
    payload[key] = form[key] !== '' && form[key] != null ? Number(form[key]) : null;
  });

  return payload;
}

export function labReportToForm(report) {
  const form = emptyLabForm();
  if (!report) return form;

  form.sample_date = report.sample_date || form.sample_date;
  form.lab_name = report.lab_name || '';
  LAB_NUTRIENT_FIELDS.forEach(({ key }) => {
    form[key] = report[key] != null ? String(report[key]) : '';
  });
  return form;
}

export function rlsHint(message, migration = '010_fix_soil_observations_rls.sql') {
  if (!message?.includes('row-level security')) return message;
  return `${message} Re-run supabase/migrations/${migration} in Supabase SQL Editor.`;
}

/** Most recent observation per tree (expects observations sorted newest first). */
export function getLatestObservationByTree(observations) {
  const byTree = {};
  (observations || []).forEach((observation) => {
    if (!observation?.tree_id || byTree[observation.tree_id]) return;
    byTree[observation.tree_id] = observation;
  });
  return byTree;
}

export function getLowNutrientsFromObservation(observation) {
  const lows = [];

  SENSOR_READING_FIELDS.forEach(({ key, label, unit, decimals, standardKey }) => {
    if (!standardKey) return;
    const standard = getSoilStandard(standardKey);
    const value = observation?.[key];
    const evaluation = evaluateSoilStandard(standard, value);
    if (evaluation.status !== 'low') return;

    lows.push({
      key,
      label: label || standard?.label || key,
      unit: unit || standard?.unit,
      value,
      decimals: decimals ?? 2,
      rangeLabel: standard?.rangeLabel,
    });
  });

  return lows;
}

export function getLowNutrientsFromLabReport(report) {
  const lows = [];

  LAB_NUTRIENT_FIELDS.forEach(({ key, label, unit, standardKey }) => {
    const standard = getSoilStandard(standardKey);
    const value = report?.[key];
    const evaluation = evaluateSoilStandard(standard, value);
    if (evaluation.status !== 'low') return;

    lows.push({
      key,
      label: label || standard?.label || key,
      unit: unit || standard?.unit,
      value: Number(value),
      decimals: 2,
      rangeLabel: standard?.rangeLabel,
    });
  });

  return lows;
}

/** Newest non-null value per lab nutrient across all farm reports. */
export function getMergedLatestLabNutrients(labReports) {
  const sorted = [...(labReports || [])].sort((a, b) =>
    String(b.sample_date || '').localeCompare(String(a.sample_date || '')),
  );

  const values = {};
  let reportId = null;
  let sampleDate = null;
  let labName = null;

  sorted.forEach((report) => {
    if (!reportId) {
      reportId = report.id;
      sampleDate = report.sample_date;
      labName = report.lab_name;
    }

    LAB_NUTRIENT_FIELDS.forEach(({ key }) => {
      if (values[key] == null && report[key] != null && report[key] !== '') {
        values[key] = Number(report[key]);
      }
    });
  });

  if (!Object.keys(values).length) return null;

  return { reportId, sampleDate, labName, values };
}

/** Latest farm lab report deficiencies (uses merged values from all reports). */
export function buildFarmLabNutrientDeficiencyReport(labReports) {
  const merged = getMergedLatestLabNutrients(labReports);
  if (!merged) return null;

  const lowNutrients = getLowNutrientsFromLabReport(merged.values);
  if (!lowNutrients.length) return null;

  return {
    reportId: merged.reportId,
    sampleDate: merged.sampleDate,
    labName: merged.labName,
    lowNutrients,
  };
}

export function buildTreeNutrientDeficiencyReport(observations) {
  const latestByTree = getLatestObservationByTree(observations);

  return Object.values(latestByTree)
    .map((observation) => {
      const lowNutrients = getLowNutrientsFromObservation(observation);
      if (!lowNutrients.length) return null;

      return {
        treeId: observation.tree_id,
        trees: observation.trees,
        observedAt: observation.observed_at,
        lowNutrients,
      };
    })
    .filter(Boolean);
}
