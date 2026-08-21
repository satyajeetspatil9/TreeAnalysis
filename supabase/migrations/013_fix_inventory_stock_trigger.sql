-- =============================================================================
-- 013: Ensure purchase → stock sync trigger works (SECURITY DEFINER)
-- Run in Supabase SQL Editor if purchases succeed but Current Stock stays empty.
-- Safe to re-run. Requires 012_fix_products_rls.sql for inventory RLS.
-- =============================================================================

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
  ELSIF NEW.transaction_type IN ('FERTIGATION_USE', 'SPRAY_USE', 'ADJUSTMENT') THEN
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
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_inventory_from_transaction();
