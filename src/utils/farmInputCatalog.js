import { evaluateSoilStandard, getSoilStandard } from './soil';

export const CATALOG_ANALYSIS_FIELDS = [
  { key: 'N', label: 'N %' },
  { key: 'P2O5', label: 'P₂O₅ %' },
  { key: 'K2O', label: 'K₂O %' },
  { key: 'Ca', label: 'Ca %' },
  { key: 'Mg', label: 'Mg %' },
  { key: 'S', label: 'S %' },
  { key: 'Zn', label: 'Zn %' },
  { key: 'B', label: 'B %' },
];

function analysis(N, P2O5, K2O, Ca, Mg, S, Zn, B) {
  return {
    N, P2O5, K2O, Ca, Mg, S, Zn, B,
  };
}

export const FARM_INPUT_CATALOG = [
  { id: 'vermicompost', name: 'Vermicompost', category: 'Organic manure', purpose: 'Soil + nutrients', fertilizer: true, unit: 'kg', nutrients: ['organic', 'N'] },
  { id: 'poultry-manure', name: 'Poultry manure', category: 'Organic manure', purpose: 'N + organic matter', fertilizer: true, unit: 'kg', nutrients: ['N', 'organic'], composition: analysis(3.15, 2.77, 2.33, 2.50, 0.50, 0.30, 0.02, 0.003) },
  { id: 'neem-cake', name: 'Neem cake', category: 'Organic fertilizer', purpose: 'N + soil benefits', fertilizer: true, unit: 'kg', nutrients: ['N'], composition: analysis(5.00, 1.00, 1.50, 1.50, 0.50, 1.00, 0.005, 0.005) },
  { id: 'groundnut-cake', name: 'Groundnut cake', category: 'Organic fertilizer', purpose: 'N', fertilizer: true, unit: 'kg', nutrients: ['N'], composition: analysis(7.30, 1.50, 1.30, 1.50, 0.50, 0.50, 0.005, 0.005) },
  { id: 'bone-meal', name: 'Bone meal', category: 'Organic/mineral nutrient', purpose: 'P + Ca', fertilizer: true, unit: 'kg', nutrients: ['P', 'Ca'], composition: analysis(3.00, 15.00, 0.00, 22.00, 0.50, 0.00, 0.01, 0.00) },
  { id: 'rock-phosphate', name: 'Rock phosphate', category: 'Mineral nutrient', purpose: 'P', fertilizer: true, unit: 'kg', nutrients: ['P'], composition: analysis(0.00, 30.00, 0.00, 30.00, 1.00, 0.50, 0.01, 0.00) },
  { id: 'wood-ash', name: 'Wood ash', category: 'Mineral/organic residue', purpose: 'K + Ca; alkalinity', fertilizer: true, unit: 'kg', nutrients: ['K', 'Ca'], composition: analysis(0.00, 2.00, 6.00, 20.00, 1.00, 0.50, 0.02, 0.05) },
  { id: 'agricultural-lime', name: 'Agricultural lime', category: 'Mineral amendment', purpose: 'Ca + pH correction', fertilizer: true, unit: 'kg', nutrients: ['Ca', 'pH'], composition: analysis(0.00, 0.00, 0.00, 38.00, 0.00, 0.00, 0.00, 0.00) },
  { id: 'gypsum', name: 'Gypsum', category: 'Mineral amendment', purpose: 'Ca + S', fertilizer: true, unit: 'kg', nutrients: ['Ca', 'S'], composition: analysis(0.00, 0.00, 0.00, 23.00, 0.30, 18.00, 0.00, 0.00) },
  { id: 'fish-hydrolysate', name: 'Fish hydrolysate', category: 'Organic liquid input', purpose: 'N + biostimulant', fertilizer: true, unit: 'L', nutrients: ['N', 'biostimulant'], composition: analysis(2.00, 1.20, 0.20, 1.00, 0.10, 0.20, 0.01, 0.00) },
  { id: 'milk-eggs-jaggery', name: 'Milk–Eggs–Jaggery', category: 'Fermented biological input', purpose: 'Biostimulant/microbial', fertilizer: true, unit: 'L', nutrients: ['biostimulant'], composition: analysis(1.00, 0.50, 0.50, 1.00, 0.10, 0.10, 0.005, 0.002) },
  { id: 'owdc', name: 'OWDC', category: 'Microbial input', purpose: 'Decomposition', fertilizer: true, unit: 'kg', nutrients: ['microbial'], composition: analysis(2.00, 1.50, 1.50, 2.00, 0.50, 0.30, 0.01, 0.003) },
  { id: 'jeevamrut', name: 'Jeevamrut', category: 'Biological input', purpose: 'Microbial activity', fertilizer: true, unit: 'L', nutrients: ['microbial'], composition: analysis(0.05, 0.02, 0.05, 0.02, 0.01, 0.01, 0.001, 0.001) },
  { id: 'vermiwash', name: 'Vermiwash', category: 'Biological liquid', purpose: 'Biostimulant/nutrients', fertilizer: true, unit: 'L', nutrients: ['biostimulant'], composition: analysis(0.50, 0.30, 0.40, 0.10, 0.05, 0.03, 0.002, 0.001) },
  { id: 'sulfur', name: 'Sulfur', category: 'Mineral fertilizer', purpose: 'S + pH effect', fertilizer: true, unit: 'kg', nutrients: ['S', 'pH'], composition: analysis(0.00, 0.00, 0.00, 0.00, 0.00, 95.00, 0.00, 0.00) },
  { id: 'magnesium-sulfate', name: 'Magnesium sulfate', category: 'Mineral fertilizer', purpose: 'Mg + S', fertilizer: true, unit: 'kg', nutrients: ['Mg', 'S'], composition: analysis(0.00, 0.00, 0.00, 0.00, 9.80, 13.00, 0.00, 0.00) },
  { id: 'natural-k-minerals', name: 'Natural K minerals', category: 'Mineral fertilizer', purpose: 'K', fertilizer: true, unit: 'kg', nutrients: ['K'], composition: analysis(0.00, 0.00, 10.00, 2.00, 3.00, 0.50, 0.01, 0.005) },
  { id: 'zinc-sulfate', name: 'Zinc sulfate', category: 'Micronutrient fertilizer', purpose: 'Zn', fertilizer: true, unit: 'kg', nutrients: ['Zn'], composition: analysis(0.00, 0.00, 0.00, 0.00, 0.00, 15.00, 33.00, 0.00) },
  { id: 'borax', name: 'Borax', category: 'Micronutrient fertilizer', purpose: 'B', fertilizer: true, unit: 'kg', nutrients: ['B'], composition: analysis(0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 11.00) },
  { id: 'vam-amf', name: 'VAM/AMF', category: 'Biofertilizer', purpose: 'Root symbiosis', fertilizer: true, unit: 'kg', nutrients: ['microbial'], composition: analysis(0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00) },
  { id: 'rice-water', name: 'Rice water', category: 'Biological substrate', purpose: 'Microbial food', fertilizer: true, unit: 'L', nutrients: ['microbial'], composition: analysis(0.10, 0.05, 0.05, 0.02, 0.01, 0.01, 0.001, 0.001) },
  { id: 'tender-coconut-water', name: 'Tender coconut water', category: 'Biostimulant', purpose: 'Growth-supporting compounds', fertilizer: true, unit: 'L', nutrients: ['biostimulant'], composition: analysis(0.05, 0.02, 0.20, 0.03, 0.02, 0.01, 0.001, 0.001) },
  { id: 'dashparni-ark', name: 'Dashparni Ark', category: 'Botanical pesticide', purpose: 'Pest management', fertilizer: false, unit: 'L', nutrients: ['pest'], composition: analysis(0.10, 0.05, 0.10, 0.05, 0.02, 0.02, 0.001, 0.001) },
  { id: 'agniastra', name: 'AgniAstra', category: 'Botanical pesticide', purpose: 'Pest management', fertilizer: false, unit: 'L', nutrients: ['pest'], composition: analysis(0.05, 0.02, 0.05, 0.02, 0.01, 0.01, 0.001, 0.001) },
  { id: 'owdc-micronutrients', name: 'OWDC + micronutrients', category: 'Microbial + micronutrient', purpose: 'Decomposition + micronutrients', fertilizer: true, unit: 'kg', nutrients: ['microbial', 'Zn', 'B'], composition: analysis(2.00, 1.50, 1.50, 2.00, 0.50, 0.30, 0.50, 0.10) },
];

export function farmInputById(id) {
  return FARM_INPUT_CATALOG.find((item) => item.id === id) || null;
}

/** Map catalog analysis (P₂O₅ / K₂O) onto products.nutrient_composition keys. */
export function catalogToNutrientComposition(item) {
  const c = item?.composition;
  if (!c) return null;
  return {
    N: c.N,
    P: c.P2O5,
    K: c.K2O,
    Ca: c.Ca,
    Mg: c.Mg,
    S: c.S,
    Zn: c.Zn,
    B: c.B,
  };
}

export function catalogToProductRecord(item) {
  return {
    name: item.name,
    category: item.fertilizer === false ? 'Plant Protection' : 'Fertilizer',
    unit: item.unit || 'kg',
    nutrient_composition: catalogToNutrientComposition(item),
    active: true,
  };
}

export function formatCatalogAnalysisValue(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  return String(n);
}

function isLow(standardKey, value) {
  return evaluateSoilStandard(getSoilStandard(standardKey), value).status === 'low';
}

function stageKey(stage) {
  return String(stage || '').toLowerCase();
}

/** Tree 7-in-1 reading first; farm lab fills nutrients the sensor does not have. */
export function mergeTreeNutrientProfile(observation, lab = {}) {
  return {
    nitrogen: observation?.nitrogen ?? lab?.nitrogen ?? null,
    phosphorus: observation?.phosphorus ?? lab?.phosphorus ?? null,
    potassium: observation?.potassium ?? lab?.potassium ?? null,
    ph: observation?.ph ?? lab?.ph ?? null,
    organic_carbon: observation?.organic_carbon ?? lab?.organic_carbon ?? null,
    sulphur: observation?.sulphur ?? lab?.sulphur ?? null,
    zinc: observation?.zinc ?? lab?.zinc ?? null,
    boron: observation?.boron ?? lab?.boron ?? null,
  };
}

export function lowNutrientLabels(profile = {}) {
  const checks = [
    ['nitrogen', 'N'],
    ['phosphorus', 'P'],
    ['potassium', 'K'],
    ['ph', 'pH'],
    ['organic_carbon', 'OC'],
    ['sulphur', 'S'],
    ['zinc', 'Zn'],
    ['boron', 'B'],
  ];
  return checks
    .filter(([key]) => isLow(key, profile[key]))
    .map(([, label]) => label);
}

function isFertilizerProduct(product) {
  if (product?.active === false) return false;
  const category = String(product?.category || '').toLowerCase();
  if (
    category.includes('plant protection')
    || category.includes('pesticide')
    || category.includes('fungicide')
    || category.includes('insecticide')
  ) {
    return false;
  }
  return true;
}

function productNutrientPercent(product, key) {
  const value = Number(product?.nutrient_composition?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function pickProductForNutrient(products, key, preferNameIncludes) {
  const scored = products
    .map((product) => ({ product, pct: productNutrientPercent(product, key) }))
    .filter((row) => row.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  if (!scored.length) return null;
  if (preferNameIncludes) {
    const needle = String(preferNameIncludes).toLowerCase();
    const preferred = scored.find((row) => String(row.product.name || '').toLowerCase().includes(needle));
    if (preferred) return preferred.product;
  }
  return scored[0].product;
}

function pickProductByName(products, needle) {
  const key = String(needle || '').toLowerCase();
  return products.find((product) => String(product.name || '').toLowerCase().includes(key)) || null;
}

/**
 * One fertilizer product per low nutrient, chosen from the Products list.
 * Flowering prefers neem cake for nitrogen when that product exists.
 */
export function suggestProductsForProfile(profile = {}, products = [], stage = '') {
  const pool = (products || []).filter(isFertilizerProduct);
  const flowering = stageKey(stage).includes('flower');
  const picks = [];
  const seen = new Set();

  const add = (product, reason) => {
    if (!product || seen.has(String(product.id))) return;
    seen.add(String(product.id));
    picks.push({
      id: product.id,
      name: product.name,
      category: product.category,
      reason,
    });
  };

  if (isLow('organic_carbon', profile.organic_carbon)) {
    add(pickProductByName(pool, 'vermicompost'), 'Organic carbon is low.');
  }
  if (isLow('nitrogen', profile.nitrogen)) {
    add(
      pickProductForNutrient(pool, 'N', flowering ? 'neem' : 'poultry'),
      flowering ? 'Nitrogen is low; neem cake during flowering.' : 'Nitrogen is low.',
    );
  }
  if (isLow('phosphorus', profile.phosphorus)) {
    add(pickProductForNutrient(pool, 'P'), 'Phosphorus is low.');
  }
  if (isLow('potassium', profile.potassium)) {
    add(pickProductForNutrient(pool, 'K'), 'Potassium is low.');
  }
  if (isLow('ph', profile.ph)) {
    add(pickProductByName(pool, 'lime') || pickProductForNutrient(pool, 'Ca'), 'pH is low.');
  }
  if (isLow('sulphur', profile.sulphur)) {
    add(pickProductForNutrient(pool, 'S'), 'Sulphur is low.');
  }
  if (isLow('zinc', profile.zinc)) {
    add(pickProductForNutrient(pool, 'Zn'), 'Zinc is low.');
  }
  if (isLow('boron', profile.boron)) {
    add(pickProductForNutrient(pool, 'B'), 'Boron is low.');
  }

  return picks;
}

export function formatSuggestedInputNames(products) {
  if (!Array.isArray(products) || !products.length) return '—';
  return products.map((item) => item.name).join(', ');
}
