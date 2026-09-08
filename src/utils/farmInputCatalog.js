import { evaluateSoilStandard, getSoilStandard } from './soil';

export const FARM_INPUT_CATALOG = [
  { id: 'vermicompost', name: 'Vermicompost', category: 'Organic manure', purpose: 'Soil + nutrients', fertilizer: true, nutrients: ['organic', 'N'] },
  { id: 'poultry-manure', name: 'Poultry manure', category: 'Organic manure', purpose: 'N + organic matter', fertilizer: true, nutrients: ['N', 'organic'] },
  { id: 'neem-cake', name: 'Neem cake', category: 'Organic fertilizer', purpose: 'N + soil benefits', fertilizer: true, nutrients: ['N'] },
  { id: 'groundnut-cake', name: 'Groundnut cake', category: 'Organic fertilizer', purpose: 'N', fertilizer: true, nutrients: ['N'] },
  { id: 'bone-meal', name: 'Bone meal', category: 'Organic/mineral nutrient', purpose: 'P + Ca', fertilizer: true, nutrients: ['P', 'Ca'] },
  { id: 'rock-phosphate', name: 'Rock phosphate', category: 'Mineral nutrient', purpose: 'P', fertilizer: true, nutrients: ['P'] },
  { id: 'wood-ash', name: 'Wood ash', category: 'Mineral/organic residue', purpose: 'K + Ca; alkalinity', fertilizer: true, nutrients: ['K', 'Ca'] },
  { id: 'agricultural-lime', name: 'Agricultural lime', category: 'Mineral amendment', purpose: 'Ca + pH correction', fertilizer: true, nutrients: ['Ca', 'pH'] },
  { id: 'gypsum', name: 'Gypsum', category: 'Mineral amendment', purpose: 'Ca + S', fertilizer: true, nutrients: ['Ca', 'S'] },
  { id: 'fish-hydrolysate', name: 'Fish hydrolysate', category: 'Organic liquid input', purpose: 'N + biostimulant', fertilizer: true, nutrients: ['N', 'biostimulant'] },
  { id: 'milk-eggs-jaggery', name: 'Milk-Eggs-Jaggery', category: 'Fermented biological input', purpose: 'Biostimulant/microbial', fertilizer: true, nutrients: ['biostimulant'] },
  { id: 'owdc', name: 'OWDC', category: 'Microbial input', purpose: 'Decomposition', fertilizer: true, nutrients: ['microbial'] },
  { id: 'jeevamrut', name: 'Jeevamrut', category: 'Biological input', purpose: 'Microbial activity', fertilizer: true, nutrients: ['microbial'] },
  { id: 'vermiwash', name: 'Vermiwash', category: 'Biological liquid', purpose: 'Biostimulant/nutrients', fertilizer: true, nutrients: ['biostimulant'] },
  { id: 'sulfur', name: 'Sulfur', category: 'Mineral fertilizer', purpose: 'S + pH effect', fertilizer: true, nutrients: ['S', 'pH'] },
  { id: 'magnesium-sulfate', name: 'Magnesium sulfate', category: 'Mineral fertilizer', purpose: 'Mg + S', fertilizer: true, nutrients: ['Mg', 'S'] },
  { id: 'natural-k-minerals', name: 'Natural K minerals', category: 'Mineral fertilizer', purpose: 'K', fertilizer: true, nutrients: ['K'] },
  { id: 'zinc-sulfate', name: 'Zinc sulfate', category: 'Micronutrient fertilizer', purpose: 'Zn', fertilizer: true, nutrients: ['Zn'] },
  { id: 'borax', name: 'Borax/B sources', category: 'Micronutrient fertilizer', purpose: 'B', fertilizer: true, nutrients: ['B'] },
  { id: 'vam-amf', name: 'VAM/AMF', category: 'Biofertilizer', purpose: 'Root symbiosis', fertilizer: true, nutrients: ['microbial'] },
  { id: 'rice-water', name: 'Rice water', category: 'Biological substrate', purpose: 'Microbial food', fertilizer: true, nutrients: ['microbial'] },
  { id: 'tender-coconut-water', name: 'Tender coconut water', category: 'Biostimulant', purpose: 'Growth-supporting compounds', fertilizer: true, nutrients: ['biostimulant'] },
  { id: 'dashparni-ark', name: 'Dashparni Ark', category: 'Botanical pesticide', purpose: 'Pest management', fertilizer: false, nutrients: ['pest'] },
  { id: 'agniastra', name: 'AgniAstra', category: 'Botanical pesticide', purpose: 'Pest management', fertilizer: false, nutrients: ['pest'] },
  { id: 'owdc-micronutrients', name: 'OWDC + micronutrients', category: 'Microbial + micronutrient', purpose: 'Decomposition + micronutrients', fertilizer: true, nutrients: ['microbial', 'Zn', 'B'] },
];

export function farmInputById(id) {
  return FARM_INPUT_CATALOG.find((item) => item.id === id) || null;
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

/**
 * One catalog input per nutrient that is actually low on this tree.
 * Stage only chooses which N source; it does not add extra products.
 */
export function suggestFertilizerInputs(profile = {}, stage = '') {
  const flowering = stageKey(stage).includes('flower');
  const picks = [];
  const seen = new Set();

  const add = (id, reason) => {
    const item = farmInputById(id);
    if (!item?.fertilizer || seen.has(id)) return;
    seen.add(id);
    picks.push({
      id: item.id,
      name: item.name,
      category: item.category,
      purpose: item.purpose,
      reason,
    });
  };

  if (isLow('organic_carbon', profile.organic_carbon)) {
    add('vermicompost', 'Organic carbon is low.');
  }
  if (isLow('nitrogen', profile.nitrogen)) {
    add(flowering ? 'neem-cake' : 'poultry-manure', flowering
      ? 'Nitrogen is low; neem cake during flowering.'
      : 'Nitrogen is low.');
  }
  if (isLow('phosphorus', profile.phosphorus)) {
    add('bone-meal', 'Phosphorus is low.');
  }
  if (isLow('potassium', profile.potassium)) {
    add('natural-k-minerals', 'Potassium is low.');
  }
  if (isLow('ph', profile.ph)) {
    add('agricultural-lime', 'pH is low.');
  }
  if (isLow('sulphur', profile.sulphur)) {
    add('gypsum', 'Sulphur is low.');
  }
  if (isLow('zinc', profile.zinc)) {
    add('zinc-sulfate', 'Zinc is low.');
  }
  if (isLow('boron', profile.boron)) {
    add('borax', 'Boron is low.');
  }

  return picks;
}

export function formatSuggestedInputNames(products) {
  if (!Array.isArray(products) || !products.length) return '—';
  return products.map((item) => item.name).join(', ');
}
