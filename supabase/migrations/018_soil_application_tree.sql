-- =============================================================================
-- 018: Individual tree soil fertilizer application
-- Run in Supabase SQL Editor after 015. Safe to re-run.
-- =============================================================================

ALTER TABLE public.soil_application_events
  ADD COLUMN IF NOT EXISTS tree_id UUID REFERENCES public.trees(id) ON DELETE CASCADE;

ALTER TABLE public.soil_application_events
  ALTER COLUMN zone_id DROP NOT NULL;

ALTER TABLE public.soil_application_events
  DROP CONSTRAINT IF EXISTS soil_application_events_scope_check;

ALTER TABLE public.soil_application_events
  ADD CONSTRAINT soil_application_events_scope_check CHECK (
    (zone_id IS NOT NULL AND tree_id IS NULL)
    OR (tree_id IS NOT NULL AND zone_id IS NULL)
  );

CREATE OR REPLACE FUNCTION public.user_owns_soil_application_event(
  p_zone_id BIGINT,
  p_tree_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_tree_id IS NOT NULL THEN public.user_owns_tree(p_tree_id)
    WHEN p_zone_id IS NOT NULL THEN public.user_owns_zone(p_zone_id)
    ELSE false
  END;
$$;

DROP POLICY IF EXISTS soil_application_events_select ON public.soil_application_events;
DROP POLICY IF EXISTS soil_application_events_insert ON public.soil_application_events;
DROP POLICY IF EXISTS soil_application_events_update ON public.soil_application_events;
DROP POLICY IF EXISTS soil_application_events_delete ON public.soil_application_events;

CREATE POLICY soil_application_events_select ON public.soil_application_events
  FOR SELECT TO authenticated
  USING (public.user_owns_soil_application_event(zone_id, tree_id));

CREATE POLICY soil_application_events_insert ON public.soil_application_events
  FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_soil_application_event(zone_id, tree_id));

CREATE POLICY soil_application_events_update ON public.soil_application_events
  FOR UPDATE TO authenticated
  USING (public.user_owns_soil_application_event(zone_id, tree_id))
  WITH CHECK (public.user_owns_soil_application_event(zone_id, tree_id));

CREATE POLICY soil_application_events_delete ON public.soil_application_events
  FOR DELETE TO authenticated
  USING (public.user_owns_soil_application_event(zone_id, tree_id));

DROP POLICY IF EXISTS soil_application_products_select ON public.soil_application_products;
DROP POLICY IF EXISTS soil_application_products_insert ON public.soil_application_products;
DROP POLICY IF EXISTS soil_application_products_update ON public.soil_application_products;
DROP POLICY IF EXISTS soil_application_products_delete ON public.soil_application_products;

CREATE POLICY soil_application_products_select ON public.soil_application_products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id
        AND public.user_owns_soil_application_event(sae.zone_id, sae.tree_id)
    )
  );

CREATE POLICY soil_application_products_insert ON public.soil_application_products
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id
        AND public.user_owns_soil_application_event(sae.zone_id, sae.tree_id)
    )
  );

CREATE POLICY soil_application_products_update ON public.soil_application_products
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id
        AND public.user_owns_soil_application_event(sae.zone_id, sae.tree_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id
        AND public.user_owns_soil_application_event(sae.zone_id, sae.tree_id)
    )
  );

CREATE POLICY soil_application_products_delete ON public.soil_application_products
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.soil_application_events sae
      WHERE sae.id = soil_application_event_id
        AND public.user_owns_soil_application_event(sae.zone_id, sae.tree_id)
    )
  );

CREATE OR REPLACE FUNCTION public.process_soil_application_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_id BIGINT;
  v_tree_id UUID;
  v_event_date DATE;
  v_method TEXT;
  v_total NUMERIC(14,2);
  v_expense_id BIGINT;
  v_tree_count INT;
  v_per_tree NUMERIC(14,2);
  v_unit_cost NUMERIC(12,2);
  v_description TEXT;
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

  SELECT sae.zone_id, sae.tree_id, sae.event_date, sae.application_method
  INTO v_zone_id, v_tree_id, v_event_date, v_method
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

  IF v_tree_id IS NOT NULL THEN
    v_description := 'Soil application (' || v_method || ') - Tree ' || COALESCE((
      SELECT tp.position_code
      FROM public.trees t
      JOIN public.tree_positions tp ON tp.id = t.position_id
      WHERE t.id = v_tree_id
    ), v_tree_id::TEXT);
  ELSE
    v_description := 'Soil application (' || v_method || ') - Zone ' || (
      SELECT zone_code FROM public.irrigation_zones WHERE id = v_zone_id
    );
  END IF;

  IF v_expense_id IS NULL THEN
    INSERT INTO public.expenses (expense_date, category, description, amount, expense_type, notes)
    VALUES (
      v_event_date,
      'Fertilizer',
      v_description,
      v_total,
      'OPEX',
      'soil_application_event:' || NEW.soil_application_event_id
    ) RETURNING id INTO v_expense_id;
  ELSE
    UPDATE public.expenses SET amount = v_total, expense_date = v_event_date, description = v_description
    WHERE id = v_expense_id;
    DELETE FROM public.expense_allocations WHERE expense_id = v_expense_id;
  END IF;

  IF v_tree_id IS NOT NULL THEN
    SELECT tiz.zone_id INTO v_zone_id
    FROM public.tree_irrigation_zones tiz
    WHERE tiz.tree_id = v_tree_id AND tiz.end_date IS NULL
    ORDER BY tiz.start_date DESC NULLS LAST, tiz.id DESC
    LIMIT 1;

    INSERT INTO public.expense_allocations (expense_id, tree_id, zone_id, allocation_method, allocation_amount)
    VALUES (v_expense_id, v_tree_id, v_zone_id, 'DIRECT', v_total);
  ELSE
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
  END IF;

  RETURN NEW;
END;
$$;
