export const PRODUCT_CATEGORIES = ['Fertilizer', 'Plant Protection', 'Other'];

/** Categories treated as spray / plant protection products in the UI. */
export const SPRAY_PRODUCT_CATEGORY_VALUES = [
  'Plant Protection',
  'Spray',
  'Pesticide',
  'Fungicide',
  'Insecticide',
];

export function isActiveProduct(product) {
  return product?.active !== false;
}

export function isSprayProductCategory(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (!normalized) return false;
  if (SPRAY_PRODUCT_CATEGORY_VALUES.some((value) => value.toLowerCase() === normalized)) {
    return true;
  }
  return (
    normalized.includes('plant protection')
    || normalized.includes('pesticide')
    || normalized.includes('fungicide')
    || normalized.includes('insecticide')
    || normalized === 'spray'
  );
}

export function isSprayProduct(product) {
  return isActiveProduct(product) && isSprayProductCategory(product?.category);
}

export function filterSprayProducts(products) {
  return (products || []).filter(isSprayProduct);
}

export async function loadProductsWithInventory(supabase) {
  const query = supabase
    .from('products')
    .select('*, inventory(current_stock)')
    .order('name');

  let { data, error } = await query.eq('active', true);

  if (error && /active/i.test(error.message || '')) {
    ({ data, error } = await query);
  }

  if (error) throw error;

  return (data || []).filter(isActiveProduct);
}

export async function loadSprayProducts(supabase) {
  const products = await loadProductsWithInventory(supabase);
  return filterSprayProducts(products);
}

export const PRODUCT_UNITS = ['kg', 'L', 'g', 'ml'];

/** Nutrient keys stored in products.nutrient_composition (% by weight/volume). */
export const PRODUCT_NUTRIENT_FIELDS = [
  { key: 'N', label: 'Nitrogen (N)', unit: '%' },
  { key: 'P', label: 'Phosphorus (P)', unit: '%' },
  { key: 'K', label: 'Potassium (K)', unit: '%' },
  { key: 'Ca', label: 'Calcium (Ca)', unit: '%' },
  { key: 'Mg', label: 'Magnesium (Mg)', unit: '%' },
  { key: 'S', label: 'Sulphur (S)', unit: '%' },
  { key: 'Fe', label: 'Iron (Fe)', unit: '%' },
  { key: 'Zn', label: 'Zinc (Zn)', unit: '%' },
  { key: 'Cu', label: 'Copper (Cu)', unit: '%' },
  { key: 'Mn', label: 'Manganese (Mn)', unit: '%' },
  { key: 'B', label: 'Boron (B)', unit: '%' },
];

function emptyNutrients() {
  return Object.fromEntries(PRODUCT_NUTRIENT_FIELDS.map(({ key }) => [key, '']));
}

export function emptyProductForm() {
  return {
    name: '',
    category: 'Fertilizer',
    unit: 'kg',
    nutrients: emptyNutrients(),
  };
}

export function buildProductPayload(form) {
  const nutrientComposition = {};
  PRODUCT_NUTRIENT_FIELDS.forEach(({ key }) => {
    const value = form.nutrients?.[key];
    if (value !== '' && value != null) nutrientComposition[key] = Number(value);
  });

  return {
    name: form.name.trim(),
    category: form.category,
    unit: form.unit,
    nutrient_composition: Object.keys(nutrientComposition).length ? nutrientComposition : null,
    active: true,
  };
}

export function productFormFromRecord(product) {
  const nutrients = emptyNutrients();
  PRODUCT_NUTRIENT_FIELDS.forEach(({ key }) => {
    if (product?.nutrient_composition?.[key] != null) {
      nutrients[key] = String(product.nutrient_composition[key]);
    }
  });
  return {
    name: product?.name || '',
    category: product?.category || 'Fertilizer',
    unit: product?.unit || 'kg',
    nutrients,
  };
}

export function buildProductUpdatePayload(form) {
  const payload = buildProductPayload(form);
  delete payload.active;
  return payload;
}

export function formatNutrientComposition(composition) {
  if (!composition || typeof composition !== 'object') return '—';
  const parts = PRODUCT_NUTRIENT_FIELDS
    .filter(({ key }) => composition[key] != null && composition[key] !== '')
    .map(({ key, label, unit }) => `${label} ${composition[key]}${unit || ''}`);
  return parts.length ? parts.join(', ') : '—';
}

export function nutrientFieldLabel(field) {
  return field.unit ? `${field.label} (${field.unit})` : field.label;
}

export function updateProductNutrient(form, key, value) {
  return {
    ...form,
    nutrients: { ...form.nutrients, [key]: value },
  };
}

export function productsRlsHint(message) {
  if (!message?.includes('row-level security')) return message;
  return `${message} Re-run supabase/migrations/012_fix_products_rls.sql in Supabase SQL Editor.`;
}

export function inventoryStockHint(message) {
  if (!message) return message;
  if (message.includes('row-level security')) {
    return `${message} Re-run supabase/migrations/012_fix_products_rls.sql in Supabase SQL Editor.`;
  }
  return message;
}

export function getProductStock(product) {
  const inv = product?.inventory;
  if (Array.isArray(inv)) return Number(inv[0]?.current_stock ?? 0);
  return Number(inv?.current_stock ?? 0);
}

/** Sum quantities per product and verify against inventory stock. */
export function validateFertilizerStock(products, lineItems) {
  const totals = {};

  for (const li of lineItems) {
    if (!li.product_id || li.quantity === '' || li.quantity == null) continue;
    const qty = Number(li.quantity);
    if (Number.isNaN(qty) || qty <= 0) {
      return { ok: false, message: 'Enter a valid quantity for each product.' };
    }
    const id = String(li.product_id);
    totals[id] = (totals[id] || 0) + qty;
  }

  if (!Object.keys(totals).length) {
    return { ok: false, message: 'Add at least one product and quantity.' };
  }

  for (const [productId, needed] of Object.entries(totals)) {
    const product = products.find((p) => String(p.id) === productId);
    const stock = getProductStock(product);
    if (needed > stock) {
      return {
        ok: false,
        message: `Not enough stock for ${product?.name || 'product'} (have ${stock} ${product?.unit || ''}, need ${needed}). Record a purchase in Inventory first.`,
      };
    }
  }

  return { ok: true };
}

export function productStockLabel(product) {
  if (!product) return '';
  return `${product.name} (${getProductStock(product)} ${product.unit} in stock)`;
}
