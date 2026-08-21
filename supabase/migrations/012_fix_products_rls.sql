-- =============================================================================
-- 012: Fix products + inventory RLS (Add Product / Record Purchase)
-- Run in Supabase SQL Editor if inserts fail with row-level security errors.
-- Safe to re-run.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_transactions TO authenticated;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

-- products (farm-wide input catalog — any logged-in user)
DROP POLICY IF EXISTS products_read ON public.products;
DROP POLICY IF EXISTS products_write ON public.products;
DROP POLICY IF EXISTS products_own ON public.products;
DROP POLICY IF EXISTS products_select ON public.products;
DROP POLICY IF EXISTS products_insert ON public.products;
DROP POLICY IF EXISTS products_update ON public.products;
DROP POLICY IF EXISTS products_delete ON public.products;

CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY products_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY products_update ON public.products
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY products_delete ON public.products
  FOR DELETE TO authenticated
  USING (true);

-- inventory
DROP POLICY IF EXISTS inventory_all ON public.inventory;
DROP POLICY IF EXISTS inventory_select ON public.inventory;
DROP POLICY IF EXISTS inventory_insert ON public.inventory;
DROP POLICY IF EXISTS inventory_update ON public.inventory;
DROP POLICY IF EXISTS inventory_delete ON public.inventory;

CREATE POLICY inventory_select ON public.inventory
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY inventory_insert ON public.inventory
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY inventory_update ON public.inventory
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY inventory_delete ON public.inventory
  FOR DELETE TO authenticated
  USING (true);

-- inventory_transactions
DROP POLICY IF EXISTS inventory_tx_all ON public.inventory_transactions;
DROP POLICY IF EXISTS inventory_transactions_select ON public.inventory_transactions;
DROP POLICY IF EXISTS inventory_transactions_insert ON public.inventory_transactions;
DROP POLICY IF EXISTS inventory_transactions_update ON public.inventory_transactions;
DROP POLICY IF EXISTS inventory_transactions_delete ON public.inventory_transactions;

CREATE POLICY inventory_transactions_select ON public.inventory_transactions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY inventory_transactions_insert ON public.inventory_transactions
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY inventory_transactions_update ON public.inventory_transactions
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY inventory_transactions_delete ON public.inventory_transactions
  FOR DELETE TO authenticated
  USING (true);
