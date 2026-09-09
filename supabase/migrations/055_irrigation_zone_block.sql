-- =============================================================================
-- 055: Irrigation zones belong to orchard block A or B
-- Run after 054_irrigation_zone_row_count.sql
-- =============================================================================

ALTER TABLE public.irrigation_zones
  ADD COLUMN IF NOT EXISTS block TEXT;

ALTER TABLE public.irrigation_zones
  DROP CONSTRAINT IF EXISTS irrigation_zones_block_ab;

ALTER TABLE public.irrigation_zones
  ADD CONSTRAINT irrigation_zones_block_ab
  CHECK (block IS NULL OR block IN ('A', 'B'));

COMMENT ON COLUMN public.irrigation_zones.block IS
  'Orchard block this zone waters: A or B.';
