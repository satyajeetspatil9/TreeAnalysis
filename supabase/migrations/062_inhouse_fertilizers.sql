-- =============================================================================
-- 062: In-House Fertilizers & Direct Rate Support
-- 1. Flag products prepared in-house (e.g. DGA, Jeevamrut, Vermiwash, Ark)
-- 2. Exempt in-house products from inventory stock requirements
-- 3. Use direct rate (default_unit_cost) everywhere for expense & cost calculations
-- =============================================================================

-- Add in-house flag and preparation notes to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_inhouse BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS preparation_notes TEXT;

COMMENT ON COLUMN public.products.is_inhouse IS
  'If true, product is prepared in-house (e.g. DGA, Jeevamrut). Uses direct unit rate without requiring purchase inventory.';
COMMENT ON COLUMN public.products.preparation_notes IS
  'Optional preparation instructions, ingredients, or recipe notes for in-house formulations.';

-- Mark existing farm-prepared organic formulations as in-house
UPDATE public.products
SET is_inhouse = TRUE
WHERE lower(name) IN (
  'dga',
  'dga-spray',
  'jeevamrut',
  'vermiwash',
  'dashparni ark',
  'dashparni-ark',
  'agniastra',
  'rice water',
  'tender coconut water',
  'owdc',
  'owdc + micronutrients'
);

-- Update stock assertion: in-house products are exempt from inventory stock checks
CREATE OR REPLACE FUNCTION public.assert_product_stock_available(p_product_id BIGINT, p_quantity NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock NUMERIC(14,3);
  v_name TEXT;
  v_is_inhouse BOOLEAN;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT p.name, COALESCE(p.is_inhouse, FALSE)
  INTO v_name, v_is_inhouse
  FROM public.products p
  WHERE p.id = p_product_id;

  -- In-house fertilizers have direct rate and no inventory stock requirements
  IF v_is_inhouse THEN
    RETURN;
  END IF;

  SELECT i.current_stock INTO v_stock
  FROM public.inventory i
  WHERE i.product_id = p_product_id;

  IF COALESCE(v_stock, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for %. Available: %, requested: %',
      COALESCE(v_name, 'product'),
      COALESCE(v_stock, 0),
      p_quantity;
  END IF;
END;
$$;

-- Update latest unit cost lookup: for in-house products, directly return the configured rate
CREATE OR REPLACE FUNCTION public.latest_product_unit_cost(p_product_id BIGINT)
RETURNS NUMERIC(12,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.default_unit_cost FROM public.products p WHERE p.id = p_product_id AND p.is_inhouse = TRUE),
    (
      SELECT it.unit_cost
      FROM public.inventory_transactions it
      WHERE it.product_id = p_product_id
        AND it.transaction_type = 'PURCHASE'
        AND it.unit_cost IS NOT NULL
      ORDER BY it.transaction_date DESC NULLS LAST, it.id DESC
      LIMIT 1
    ),
    (SELECT p.default_unit_cost FROM public.products p WHERE p.id = p_product_id),
    0
  );
$$;

-- Update inventory sync trigger so INHOUSE_USE does not decrement current_stock
CREATE OR REPLACE FUNCTION public.sync_inventory_from_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.inventory (product_id, current_stock, last_updated)
  VALUES (NEW.product_id, 0, now())
  ON CONFLICT (product_id) DO NOTHING;

  IF NEW.transaction_type IN ('PURCHASE', 'RETURN') THEN
    UPDATE public.inventory
    SET current_stock = current_stock + ABS(NEW.quantity),
        last_updated = now()
    WHERE product_id = NEW.product_id;
  ELSIF NEW.transaction_type IN ('FERTIGATION_USE', 'SPRAY_USE', 'SOIL_APPLICATION_USE', 'ADJUSTMENT') THEN
    UPDATE public.inventory
    SET current_stock = current_stock - ABS(NEW.quantity),
        last_updated = now()
    WHERE product_id = NEW.product_id;
  -- Note: INHOUSE_USE does not modify inventory.current_stock
  END IF;

  RETURN NEW;
END;
$$;

-- Update fertigation product trigger to handle in-house products
CREATE OR REPLACE FUNCTION public.process_fertigation_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_id BIGINT;
  v_event_date DATE;
  v_total NUMERIC(14,2);
  v_expense_id BIGINT;
  v_tree_count INT;
  v_per_tree NUMERIC(14,2);
  v_unit_cost NUMERIC(12,2);
  v_is_inhouse BOOLEAN;
  rec RECORD;
BEGIN
  SELECT COALESCE(p.is_inhouse, FALSE) INTO v_is_inhouse
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF NOT v_is_inhouse THEN
    PERFORM public.assert_product_stock_available(NEW.product_id, NEW.quantity);
  END IF;

  v_unit_cost := COALESCE(
    public.latest_product_unit_cost(NEW.product_id),
    (SELECT p.default_unit_cost FROM public.products p WHERE p.id = NEW.product_id),
    0
  );

  INSERT INTO public.inventory_transactions (
    product_id, transaction_type, quantity, unit_cost, total_cost, reference, notes
  ) VALUES (
    NEW.product_id,
    CASE WHEN v_is_inhouse THEN 'INHOUSE_USE' ELSE 'FERTIGATION_USE' END,
    NEW.quantity,
    v_unit_cost,
    NEW.quantity * v_unit_cost,
    'fertigation:' || NEW.fertigation_event_id,
    CASE WHEN v_is_inhouse THEN 'In-house fertilizer applied in fertigation' ELSE 'Auto-deducted from fertigation' END
  );

  SELECT fe.zone_id, fe.event_date INTO v_zone_id, v_event_date
  FROM public.fertigation_events fe
  WHERE fe.id = NEW.fertigation_event_id;

  SELECT COALESCE(SUM(
    fp.quantity * COALESCE(
      public.latest_product_unit_cost(fp.product_id),
      (SELECT p.default_unit_cost FROM public.products p WHERE p.id = fp.product_id),
      0
    )
  ), 0) INTO v_total
  FROM public.fertigation_products fp
  WHERE fp.fertigation_event_id = NEW.fertigation_event_id;

  SELECT id INTO v_expense_id FROM public.expenses
  WHERE notes = 'fertigation_event:' || NEW.fertigation_event_id::TEXT
  LIMIT 1;

  IF v_expense_id IS NULL THEN
    INSERT INTO public.expenses (expense_date, category, description, amount, expense_type, notes)
    VALUES (
      v_event_date,
      'Fertilizer',
      'Fertigation - Zone ' || (SELECT zone_code FROM public.irrigation_zones WHERE id = v_zone_id),
      v_total,
      'OPERATIONAL',
      'fertigation_event:' || NEW.fertigation_event_id::TEXT
    ) RETURNING id INTO v_expense_id;
  ELSE
    UPDATE public.expenses SET amount = v_total WHERE id = v_expense_id;
  END IF;

  DELETE FROM public.expense_allocations WHERE expense_id = v_expense_id;

  SELECT COUNT(*) INTO v_tree_count
  FROM public.tree_irrigation_zones tiz
  JOIN public.trees t ON t.id = tiz.tree_id
  WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active';

  IF v_tree_count > 0 AND v_total > 0 THEN
    v_per_tree := v_total / v_tree_count;
    FOR rec IN
      SELECT tiz.tree_id FROM public.tree_irrigation_zones tiz
      JOIN public.trees t ON t.id = tiz.tree_id
      WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active'
    LOOP
      INSERT INTO public.expense_allocations (expense_id, tree_id, zone_id, allocation_method, allocation_amount)
      VALUES (v_expense_id, rec.tree_id, v_zone_id, 'BY_TREE_COUNT', v_per_tree);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- Update soil application trigger to handle in-house products
CREATE OR REPLACE FUNCTION public.process_soil_application_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_id BIGINT;
  v_event_date DATE;
  v_method TEXT;
  v_total NUMERIC(14,2);
  v_expense_id BIGINT;
  v_tree_count INT;
  v_per_tree NUMERIC(14,2);
  v_unit_cost NUMERIC(12,2);
  v_is_inhouse BOOLEAN;
  rec RECORD;
BEGIN
  SELECT COALESCE(p.is_inhouse, FALSE) INTO v_is_inhouse
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF NOT v_is_inhouse THEN
    PERFORM public.assert_product_stock_available(NEW.product_id, NEW.quantity);
  END IF;

  v_unit_cost := COALESCE(
    NEW.unit_cost,
    public.latest_product_unit_cost(NEW.product_id),
    (SELECT p.default_unit_cost FROM public.products p WHERE p.id = NEW.product_id),
    0
  );

  INSERT INTO public.inventory_transactions (
    product_id, transaction_type, quantity, unit_cost, total_cost, reference, notes
  ) VALUES (
    NEW.product_id,
    CASE WHEN v_is_inhouse THEN 'INHOUSE_USE' ELSE 'SOIL_APPLICATION_USE' END,
    NEW.quantity,
    v_unit_cost,
    NEW.quantity * v_unit_cost,
    'soil_application:' || NEW.soil_application_event_id,
    CASE WHEN v_is_inhouse THEN 'In-house fertilizer applied directly to soil' ELSE 'Auto-deducted from direct soil application' END
  );

  SELECT sae.zone_id, sae.event_date, sae.application_method
  INTO v_zone_id, v_event_date, v_method
  FROM public.soil_application_events sae
  WHERE sae.id = NEW.soil_application_event_id;

  SELECT COALESCE(SUM(
    sap.quantity * COALESCE(
      sap.unit_cost,
      public.latest_product_unit_cost(sap.product_id),
      (SELECT p.default_unit_cost FROM public.products p WHERE p.id = sap.product_id),
      0
    )
  ), 0) INTO v_total
  FROM public.soil_application_products sap
  WHERE sap.soil_application_event_id = NEW.soil_application_event_id;

  SELECT id INTO v_expense_id FROM public.expenses
  WHERE notes = 'soil_application_event:' || NEW.soil_application_event_id::TEXT
  LIMIT 1;

  IF v_expense_id IS NULL THEN
    INSERT INTO public.expenses (expense_date, category, description, amount, expense_type, notes)
    VALUES (
      v_event_date,
      'Fertilizer',
      'Soil application (' || v_method || ') - Zone ' || (
        SELECT zone_code FROM public.irrigation_zones WHERE id = v_zone_id
      ),
      v_total,
      'OPERATIONAL',
      'soil_application_event:' || NEW.soil_application_event_id::TEXT
    ) RETURNING id INTO v_expense_id;
  ELSE
    UPDATE public.expenses SET amount = v_total WHERE id = v_expense_id;
  END IF;

  DELETE FROM public.expense_allocations WHERE expense_id = v_expense_id;

  SELECT COUNT(*) INTO v_tree_count
  FROM public.tree_irrigation_zones tiz
  JOIN public.trees t ON t.id = tiz.tree_id
  WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active';

  IF v_tree_count > 0 AND v_total > 0 THEN
    v_per_tree := v_total / v_tree_count;
    FOR rec IN
      SELECT tiz.tree_id FROM public.tree_irrigation_zones tiz
      JOIN public.trees t ON t.id = tiz.tree_id
      WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active'
    LOOP
      INSERT INTO public.expense_allocations (expense_id, tree_id, zone_id, allocation_method, allocation_amount)
      VALUES (v_expense_id, rec.tree_id, v_zone_id, 'BY_TREE_COUNT', v_per_tree);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;
