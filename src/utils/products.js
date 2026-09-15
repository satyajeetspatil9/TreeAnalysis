import { catalogToProductRecord, FARM_INPUT_CATALOG } from './farmInputCatalog';

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
  { key: 'P', label: 'Phosphorus (P₂O₅)', unit: '%' },
  { key: 'K', label: 'Potassium (K₂O)', unit: '%' },
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

function normalizeProductName(name) {
  return String(name || '').trim().toLowerCase().replace(/[–—]/g, '-');
}

function findExistingProduct(byName, productName) {
  const key = normalizeProductName(productName);
  if (byName.has(key)) return byName.get(key);
  for (const [name, row] of byName) {
    if (name === key || name.startsWith(`${key}/`) || name.startsWith(`${key} `)) return row;
  }
  return null;
}

/** Insert analysed catalog materials into products, or refresh nutrient % on name match. */
export async function syncCatalogProducts(supabase) {
  const { data: existing, error } = await supabase.from('products').select('id, name');
  if (error) return { error, created: 0, updated: 0 };

  const byName = new Map(
    (existing || []).map((row) => [normalizeProductName(row.name), row]),
  );

  let created = 0;
  let updated = 0;
  for (const item of FARM_INPUT_CATALOG) {
    if (!item.composition) continue;
    const payload = catalogToProductRecord(item);
    const found = findExistingProduct(byName, payload.name);
    if (found) {
      const { error: updateError } = await supabase
        .from('products')
        .update({
          nutrient_composition: payload.nutrient_composition,
          active: true,
        })
        .eq('id', found.id);
      if (updateError) return { error: updateError, created, updated };
      updated += 1;
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('products')
      .insert([payload])
      .select('id, name')
      .single();
    if (insertError) return { error: insertError, created, updated };
    byName.set(normalizeProductName(inserted.name), inserted);
    created += 1;
  }

  return { error: null, created, updated };
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

/** Sum quantities per product and verify against inventory stock (in-house fertilizers are exempt). */
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
    if (product?.is_inhouse) {
      // In-house prepared fertilizers have direct unit rates and zero inventory requirement
      continue;
    }
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
  if (product.is_inhouse) {
    const rate = Number(product.default_unit_cost) || 0;
    return `${product.name} (In-house · ₹${rate}/${product.unit})`;
  }
  return `${product.name} (${getProductStock(product)} ${product.unit} in stock)`;
}

export function emptyInHouseProductForm() {
  return {
    product_id: '',
    name: '',
    category: 'Fertilizer',
    unit: 'L',
    default_unit_cost: '0',
    preparation_notes: '',
    active: true,
  };
}

export async function loadInHouseProducts(supabase) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_inhouse', true)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function loadAllProducts(supabase) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function saveInHouseProduct(supabase, form, id = null) {
  let targetId = id || form.product_id;
  const trimmedName = form.name?.trim();

  // If no explicit targetId, check if product already exists in master catalog by name
  if (!targetId && trimmedName) {
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .ilike('name', trimmedName)
      .maybeSingle();
    if (existing?.id) {
      targetId = existing.id;
    }
  }

  const payload = {
    category: form.category || 'Fertilizer',
    unit: form.unit || 'L',
    default_unit_cost: form.default_unit_cost !== '' && form.default_unit_cost != null
      ? Number(form.default_unit_cost)
      : 0,
    preparation_notes: form.preparation_notes?.trim() || null,
    is_inhouse: true,
    active: form.active !== false,
  };

  if (trimmedName) {
    payload.name = trimmedName;
  }

  if (targetId) {
    return supabase.from('products').update(payload).eq('id', targetId);
  }
  return supabase.from('products').insert(payload).select().single();
}

export async function deleteInHouseProduct(supabase, id) {
  // If historical records reference this product, hard delete will fail due to foreign keys.
  // In that case, gracefully remove it from the in-house list and clear direct cost.
  const { error: deleteError } = await supabase.from('products').delete().eq('id', id);
  if (deleteError) {
    return supabase
      .from('products')
      .update({ is_inhouse: false, default_unit_cost: null })
      .eq('id', id);
  }
  return { error: null };
}
