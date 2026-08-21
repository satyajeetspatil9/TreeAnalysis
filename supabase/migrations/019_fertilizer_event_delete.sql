-- =============================================================================
-- 019: Reverse inventory + expenses when fertigation / soil events are deleted
-- Also sync expense date when event date changes. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reverse_fertigation_event()
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
    WHERE it.reference = 'fertigation:' || OLD.id
      AND it.transaction_type = 'FERTIGATION_USE'
  LOOP
    INSERT INTO public.inventory_transactions (
      product_id, transaction_type, quantity, unit_cost, total_cost, reference, notes
    ) VALUES (
      rec.product_id,
      'RETURN',
      rec.quantity,
      rec.unit_cost,
      rec.quantity * COALESCE(rec.unit_cost, 0),
      'fertigation_reversal:' || OLD.id,
      'Stock restored after fertigation delete'
    );
  END LOOP;

  SELECT id INTO v_expense_id
  FROM public.expenses
  WHERE notes = 'fertigation_event:' || OLD.id::TEXT
  LIMIT 1;

  IF v_expense_id IS NOT NULL THEN
    DELETE FROM public.expense_allocations WHERE expense_id = v_expense_id;
    DELETE FROM public.expenses WHERE id = v_expense_id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_soil_application_event()
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
    WHERE it.reference = 'soil_application:' || OLD.id
      AND it.transaction_type = 'SOIL_APPLICATION_USE'
  LOOP
    INSERT INTO public.inventory_transactions (
      product_id, transaction_type, quantity, unit_cost, total_cost, reference, notes
    ) VALUES (
      rec.product_id,
      'RETURN',
      rec.quantity,
      rec.unit_cost,
      rec.quantity * COALESCE(rec.unit_cost, 0),
      'soil_application_reversal:' || OLD.id,
      'Stock restored after soil application delete'
    );
  END LOOP;

  SELECT id INTO v_expense_id
  FROM public.expenses
  WHERE notes = 'soil_application_event:' || OLD.id::TEXT
  LIMIT 1;

  IF v_expense_id IS NOT NULL THEN
    DELETE FROM public.expense_allocations WHERE expense_id = v_expense_id;
    DELETE FROM public.expenses WHERE id = v_expense_id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_fertigation_expense_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.expenses
  SET expense_date = NEW.event_date
  WHERE notes = 'fertigation_event:' || NEW.id::TEXT;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_soil_application_expense_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.expenses
  SET expense_date = NEW.event_date
  WHERE notes = 'soil_application_event:' || NEW.id::TEXT;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reverse_fertigation_event ON public.fertigation_events;
CREATE TRIGGER trg_reverse_fertigation_event
  BEFORE DELETE ON public.fertigation_events
  FOR EACH ROW EXECUTE FUNCTION public.reverse_fertigation_event();

DROP TRIGGER IF EXISTS trg_reverse_soil_application_event ON public.soil_application_events;
CREATE TRIGGER trg_reverse_soil_application_event
  BEFORE DELETE ON public.soil_application_events
  FOR EACH ROW EXECUTE FUNCTION public.reverse_soil_application_event();

DROP TRIGGER IF EXISTS trg_sync_fertigation_expense_date ON public.fertigation_events;
CREATE TRIGGER trg_sync_fertigation_expense_date
  AFTER UPDATE OF event_date ON public.fertigation_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_fertigation_expense_date();

DROP TRIGGER IF EXISTS trg_sync_soil_application_expense_date ON public.soil_application_events;
CREATE TRIGGER trg_sync_soil_application_expense_date
  AFTER UPDATE OF event_date ON public.soil_application_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_soil_application_expense_date();
