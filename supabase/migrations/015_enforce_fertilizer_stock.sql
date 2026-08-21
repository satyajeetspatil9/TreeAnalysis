-- =============================================================================
-- 015: Enforce inventory stock on fertilizer use (fertigation + soil application)
-- Run in Supabase SQL Editor after 012 and 013.
-- Includes soil_application tables if 014 was not run yet. Safe to re-run.
-- =============================================================================

-- --- Soil application tables (from 014, skip if already created) ---
CREATE TABLE IF NOT EXISTS public.soil_application_events (
  id BIGSERIAL PRIMARY KEY,
  zone_id BIGINT NOT NULL REFERENCES public.irrigation_zones(id) ON DELETE CASCADE,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  application_method TEXT NOT NULL DEFAULT 'Basin',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (application_method IN ('Basin', 'Broadcast', 'Band', 'Ring', 'Other'))
);

CREATE TABLE IF NOT EXISTS public.soil_application_products (
  id BIGSERIAL PRIMARY KEY,
  soil_application_event_id BIGINT NOT NULL REFERENCES public.soil_application_events(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES public.products(id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit TEXT,
  unit_cost NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.soil_application_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.soil_application_products TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.soil_application_events_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.soil_application_products_id_seq TO authenticated;

ALTER TABLE public.soil_application_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS soil_application_events_select ON public.soil_application_events;
DROP POLICY IF EXISTS soil_application_events_insert ON public.soil_application_events;
DROP POLICY IF EXISTS soil_application_events_update ON public.soil_application_events;
DROP POLICY IF EXISTS soil_application_events_delete ON public.soil_application_events;

CREATE POLICY soil_application_events_select ON public.soil_application_events
  FOR SELECT TO authenticated USING (public.user_owns_zone(zone_id));

CREATE POLICY soil_application_events_insert ON public.soil_application_events
  FOR INSERT TO authenticated
  WITH CHECK (zone_id IS NOT NULL AND public.user_owns_zone(zone_id));

CREATE POLICY soil_application_events_update ON public.soil_application_events
  FOR UPDATE TO authenticated
  USING (public.user_owns_zone(zone_id))
  WITH CHECK (zone_id IS NOT NULL AND public.user_owns_zone(zone_id));

CREATE POLICY soil_application_events_delete ON public.soil_application_events
  FOR DELETE TO authenticated USING (public.user_owns_zone(zone_id));

ALTER TABLE public.soil_application_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS soil_application_products_select ON public.soil_application_products;
DROP POLICY IF EXISTS soil_application_products_insert ON public.soil_application_products;
DROP POLICY IF EXISTS soil_application_products_update ON public.soil_application_products;
DROP POLICY IF EXISTS soil_application_products_delete ON public.soil_application_products;

CREATE POLICY soil_application_products_select ON public.soil_application_products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id AND public.user_owns_zone(sae.zone_id)
    )
  );

CREATE POLICY soil_application_products_insert ON public.soil_application_products
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id AND public.user_owns_zone(sae.zone_id)
    )
  );

CREATE POLICY soil_application_products_update ON public.soil_application_products
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id AND public.user_owns_zone(sae.zone_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id AND public.user_owns_zone(sae.zone_id)
    )
  );

CREATE POLICY soil_application_products_delete ON public.soil_application_products
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id AND public.user_owns_zone(sae.zone_id)
    )
  );

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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_inventory ON public.inventory_transactions;
CREATE TRIGGER trg_sync_inventory
  AFTER INSERT ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_inventory_from_transaction();

CREATE OR REPLACE FUNCTION public.allocate_expense_to_trees()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tree_count INT;
  v_per_tree NUMERIC(14,2);
  rec RECORD;
BEGIN
  IF NEW.notes LIKE 'fertigation_event:%'
     OR NEW.notes LIKE 'spray_event:%'
     OR NEW.notes LIKE 'soil_application_event:%' THEN
    RETURN NEW;
  END IF;

  IF NEW.notes LIKE 'zone:%' THEN
    DECLARE v_zone_id BIGINT := split_part(NEW.notes, ':', 2)::BIGINT;
    BEGIN
      SELECT COUNT(*) INTO v_tree_count
      FROM public.tree_irrigation_zones tiz
      JOIN public.trees t ON t.id = tiz.tree_id
      WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active';

      IF v_tree_count > 0 THEN
        v_per_tree := NEW.amount / v_tree_count;
        FOR rec IN
          SELECT tiz.tree_id FROM public.tree_irrigation_zones tiz
          JOIN public.trees t ON t.id = tiz.tree_id
          WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active'
        LOOP
          INSERT INTO public.expense_allocations (expense_id, tree_id, zone_id, allocation_method, allocation_amount)
          VALUES (NEW.id, rec.tree_id, v_zone_id, 'BY_TREE_COUNT', v_per_tree);
        END LOOP;
      END IF;
    END;
  ELSIF NEW.notes LIKE 'tree:%' THEN
    INSERT INTO public.expense_allocations (expense_id, tree_id, allocation_method, allocation_amount)
    VALUES (NEW.id, split_part(NEW.notes, ':', 2)::UUID, 'DIRECT', NEW.amount);
  END IF;

  RETURN NEW;
END;
$$;

-- --- Stock enforcement + triggers ---
CREATE OR REPLACE FUNCTION public.latest_product_unit_cost(p_product_id BIGINT)
RETURNS NUMERIC(12,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT it.unit_cost
  FROM public.inventory_transactions it
  WHERE it.product_id = p_product_id
    AND it.transaction_type = 'PURCHASE'
    AND it.unit_cost IS NOT NULL
  ORDER BY it.transaction_date DESC NULLS LAST, it.id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.assert_product_stock_available(p_product_id BIGINT, p_quantity NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock NUMERIC(14,3);
  v_name TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT i.current_stock INTO v_stock
  FROM public.inventory i
  WHERE i.product_id = p_product_id;

  SELECT p.name INTO v_name FROM public.products p WHERE p.id = p_product_id;

  IF COALESCE(v_stock, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for %. Available: %, requested: %',
      COALESCE(v_name, 'product'),
      COALESCE(v_stock, 0),
      p_quantity;
  END IF;
END;
$$;

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
  rec RECORD;
BEGIN
  PERFORM public.assert_product_stock_available(NEW.product_id, NEW.quantity);

  v_unit_cost := COALESCE(
    public.latest_product_unit_cost(NEW.product_id),
    (SELECT p.default_unit_cost FROM public.products p WHERE p.id = NEW.product_id),
    0
  );

  INSERT INTO public.inventory_transactions (
    product_id, transaction_type, quantity, unit_cost, total_cost, reference, notes
  ) VALUES (
    NEW.product_id,
    'FERTIGATION_USE',
    NEW.quantity,
    v_unit_cost,
    NEW.quantity * v_unit_cost,
    'fertigation:' || NEW.fertigation_event_id,
    'Auto-deducted from fertigation'
  );

  SELECT fe.zone_id, fe.event_date INTO v_zone_id, v_event_date
  FROM public.fertigation_events fe WHERE fe.id = NEW.fertigation_event_id;

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
  WHERE notes = 'fertigation_event:' || NEW.fertigation_event_id::TEXT LIMIT 1;

  IF v_expense_id IS NULL THEN
    INSERT INTO public.expenses (expense_date, category, description, amount, expense_type, notes)
    VALUES (
      v_event_date,
      'Fertilizer',
      'Fertigation - Zone ' || (SELECT zone_code FROM public.irrigation_zones WHERE id = v_zone_id),
      v_total,
      'OPEX',
      'fertigation_event:' || NEW.fertigation_event_id
    ) RETURNING id INTO v_expense_id;
  ELSE
    UPDATE public.expenses SET amount = v_total, expense_date = v_event_date WHERE id = v_expense_id;
    DELETE FROM public.expense_allocations WHERE expense_id = v_expense_id;
  END IF;

  SELECT COUNT(*) INTO v_tree_count
  FROM public.tree_irrigation_zones tiz
  JOIN public.trees t ON t.id = tiz.tree_id
  WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active';

  IF v_tree_count > 0 THEN
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
  rec RECORD;
BEGIN
  PERFORM public.assert_product_stock_available(NEW.product_id, NEW.quantity);

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
    'SOIL_APPLICATION_USE',
    NEW.quantity,
    v_unit_cost,
    NEW.quantity * v_unit_cost,
    'soil_application:' || NEW.soil_application_event_id,
    'Auto-deducted from direct soil application'
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
      'OPEX',
      'soil_application_event:' || NEW.soil_application_event_id
    ) RETURNING id INTO v_expense_id;
  ELSE
    UPDATE public.expenses SET amount = v_total, expense_date = v_event_date WHERE id = v_expense_id;
    DELETE FROM public.expense_allocations WHERE expense_id = v_expense_id;
  END IF;

  SELECT COUNT(*) INTO v_tree_count
  FROM public.tree_irrigation_zones tiz
  JOIN public.trees t ON t.id = tiz.tree_id
  WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active';

  IF v_tree_count > 0 THEN
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

DROP TRIGGER IF EXISTS trg_fertigation_product ON public.fertigation_products;
CREATE TRIGGER trg_fertigation_product
  AFTER INSERT ON public.fertigation_products
  FOR EACH ROW EXECUTE FUNCTION public.process_fertigation_product();

DROP TRIGGER IF EXISTS trg_soil_application_product ON public.soil_application_products;
CREATE TRIGGER trg_soil_application_product
  AFTER INSERT ON public.soil_application_products
  FOR EACH ROW EXECUTE FUNCTION public.process_soil_application_product();
