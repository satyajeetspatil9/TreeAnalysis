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

/**
 * Pick from the farm input catalog using latest lab values and GDD stage.
 * Pest inputs stay on the admin list only.
 */
export function suggestFertilizerInputs(lab = {}, stage = '') {
  const key = stageKey(stage);
  const flowering = key.includes('flower');
  const fruit = key.includes('fruit') || key.includes('nut');
  const maturity = key.includes('maturity');
  const vegetative = !flowering && !fruit && !maturity;

  const nLow = isLow('nitrogen', lab.nitrogen);
  const pLow = isLow('phosphorus', lab.phosphorus);
  const kLow = isLow('potassium', lab.potassium);
  const phLow = isLow('ph', lab.ph);
  const ocLow = isLow('organic_carbon', lab.organic_carbon);
  const sLow = isLow('sulphur', lab.sulphur);
  const znLow = isLow('zinc', lab.zinc);
  const bLow = isLow('boron', lab.boron);

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

  add('vermicompost', ocLow ? 'Organic carbon is low — build soil and nutrients.' : 'Base organic manure.');
  add('owdc', 'Support decomposition of organics.');
  add('jeevamrut', 'Keep soil microbial activity up.');
  add('vam-amf', 'Root symbiosis for nutrient uptake.');

  if (!flowering && (nLow || vegetative)) {
    add('poultry-manure', nLow ? 'Nitrogen is low.' : 'Vegetative growth needs nitrogen.');
  }
  if (nLow || vegetative || flowering) {
    add('neem-cake', flowering ? 'Moderate N with soil benefits during flowering.' : 'Organic nitrogen.');
  }
  if (nLow && !flowering) {
    add('groundnut-cake', 'Extra organic nitrogen.');
    add('fish-hydrolysate', 'Liquid N plus biostimulant.');
  }

  if (pLow || flowering) {
    add('bone-meal', pLow ? 'Phosphorus is low (with calcium).' : 'Support bloom with P and Ca.');
    add('rock-phosphate', 'Mineral phosphorus.');
  }

  if (kLow || fruit) {
    add('wood-ash', kLow ? 'Potassium is low (with calcium).' : 'Fruit fill needs potassium.');
    add('natural-k-minerals', 'Mineral potassium.');
  }

  if (phLow) {
    add('agricultural-lime', 'pH is low — calcium and pH correction.');
  }

  if (sLow) {
    add('gypsum', 'Sulphur (and calcium) from gypsum.');
    add('sulfur', 'Mineral sulphur.');
  } else if (phLow) {
    add('gypsum', 'Calcium without raising pH as strongly as lime.');
  }

  add('magnesium-sulfate', sLow ? 'Magnesium plus sulphur.' : 'Magnesium and sulphur maintenance.');

  if (znLow) add('zinc-sulfate', 'Zinc is low.');
  if (bLow) add('borax', 'Boron is low.');
  if (znLow || bLow) add('owdc-micronutrients', 'Decomposition plus micronutrients.');

  if (vegetative) {
    add('vermiwash', 'Liquid biostimulant.');
    add('milk-eggs-jaggery', 'Fermented microbial food.');
    add('rice-water', 'Microbial substrate.');
    add('tender-coconut-water', 'Growth-supporting compounds.');
  } else if (!maturity) {
    add('vermiwash', 'Light biostimulant.');
  }

  return picks;
}

export function formatSuggestedInputNames(products) {
  if (!Array.isArray(products) || !products.length) return '—';
  return products.map((item) => item.name).join(', ');
}
