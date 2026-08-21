-- =============================================================================
-- 028: Ensure products.active exists for Spray / Inventory product lists
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

UPDATE public.products
SET active = true
WHERE active IS NULL;
