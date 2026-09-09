-- =============================================================================
-- 054: Irrigation zones declare how many orchard rows they cover
-- Run after 053_fertigation_program_events.sql
-- =============================================================================

ALTER TABLE public.irrigation_zones
  ADD COLUMN IF NOT EXISTS row_count INTEGER;

ALTER TABLE public.irrigation_zones
  DROP CONSTRAINT IF EXISTS irrigation_zones_row_count_positive;

ALTER TABLE public.irrigation_zones
  ADD CONSTRAINT irrigation_zones_row_count_positive
  CHECK (row_count IS NULL OR row_count > 0);

COMMENT ON COLUMN public.irrigation_zones.row_count IS
  'Number of orchard rows this zone covers, from the bottom of the block upward.';
