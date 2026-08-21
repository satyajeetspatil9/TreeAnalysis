-- =============================================================================
-- 022: Reverse inventory + expenses when spray events are deleted; fix spray RLS
-- Run in Supabase SQL Editor if spray edit/delete fails with RLS errors.
-- Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reverse_spray_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_expense_id BIGINT;
BEGIN
  FOR rec IN
    SELECT it.product_id, it.quantity, it.unit_cost
    FROM public.inventory_transactions it
    WHERE it.reference = 'spray:' || OLD.id
      AND it.transaction_type = 'SPRAY_USE'
  LOOP
    INSERT INTO public.inventory_transactions (
      product_id, transaction_type, quantity, unit_cost, total_cost, reference, notes
    ) VALUES (
      rec.product_id,
      'RETURN',
      rec.quantity,
      rec.unit_cost,
      rec.quantity * COALESCE(rec.unit_cost, 0),
      'spray_reversal:' || OLD.id,
      'Stock restored after spray delete'
    );
  END LOOP;

  SELECT id INTO v_expense_id
  FROM public.expenses
  WHERE notes = 'spray_event:' || OLD.id::TEXT
  LIMIT 1;

  IF v_expense_id IS NOT NULL THEN
    DELETE FROM public.expense_allocations WHERE expense_id = v_expense_id;
    DELETE FROM public.expenses WHERE id = v_expense_id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_spray_expense_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.expenses
  SET expense_date = NEW.event_date
  WHERE notes = 'spray_event:' || NEW.id::TEXT;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reverse_spray_event ON public.spray_events;
CREATE TRIGGER trg_reverse_spray_event
  BEFORE DELETE ON public.spray_events
  FOR EACH ROW EXECUTE FUNCTION public.reverse_spray_event();

DROP TRIGGER IF EXISTS trg_sync_spray_expense_date ON public.spray_events;
CREATE TRIGGER trg_sync_spray_expense_date
  AFTER UPDATE OF event_date ON public.spray_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_spray_expense_date();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spray_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spray_products TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.spray_events_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.spray_products_id_seq TO authenticated;

ALTER TABLE public.spray_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spray_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spray_events_own ON public.spray_events;
DROP POLICY IF EXISTS spray_events_select ON public.spray_events;
DROP POLICY IF EXISTS spray_events_insert ON public.spray_events;
DROP POLICY IF EXISTS spray_events_update ON public.spray_events;
DROP POLICY IF EXISTS spray_events_delete ON public.spray_events;

CREATE POLICY spray_events_select ON public.spray_events
  FOR SELECT TO authenticated
  USING (zone_id IS NOT NULL AND public.user_owns_zone(zone_id));

CREATE POLICY spray_events_insert ON public.spray_events
  FOR INSERT TO authenticated
  WITH CHECK (zone_id IS NOT NULL AND public.user_owns_zone(zone_id));

CREATE POLICY spray_events_update ON public.spray_events
  FOR UPDATE TO authenticated
  USING (zone_id IS NOT NULL AND public.user_owns_zone(zone_id))
  WITH CHECK (zone_id IS NOT NULL AND public.user_owns_zone(zone_id));

CREATE POLICY spray_events_delete ON public.spray_events
  FOR DELETE TO authenticated
  USING (zone_id IS NOT NULL AND public.user_owns_zone(zone_id));

DROP POLICY IF EXISTS spray_products_own ON public.spray_products;
DROP POLICY IF EXISTS spray_products_select ON public.spray_products;
DROP POLICY IF EXISTS spray_products_insert ON public.spray_products;
DROP POLICY IF EXISTS spray_products_update ON public.spray_products;
DROP POLICY IF EXISTS spray_products_delete ON public.spray_products;

CREATE POLICY spray_products_select ON public.spray_products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.spray_events se
      WHERE se.id = spray_event_id AND public.user_owns_zone(se.zone_id)
    )
  );

CREATE POLICY spray_products_insert ON public.spray_products
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.spray_events se
      WHERE se.id = spray_event_id AND public.user_owns_zone(se.zone_id)
    )
  );

CREATE POLICY spray_products_update ON public.spray_products
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.spray_events se
      WHERE se.id = spray_event_id AND public.user_owns_zone(se.zone_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.spray_events se
      WHERE se.id = spray_event_id AND public.user_owns_zone(se.zone_id)
    )
  );

CREATE POLICY spray_products_delete ON public.spray_products
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.spray_events se
      WHERE se.id = spray_event_id AND public.user_owns_zone(se.zone_id)
    )
  );
