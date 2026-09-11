-- =============================================================================
-- 058: Start/end timestamps on irrigation and fertigation monitoring events
-- Run after 057_seed_catalog_products.sql
-- =============================================================================

ALTER TABLE public.irrigation_events
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

ALTER TABLE public.fertigation_events
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

COMMENT ON COLUMN public.irrigation_events.started_at IS
  'When watering actually began (from the irrigation job).';
COMMENT ON COLUMN public.irrigation_events.ended_at IS
  'When watering finished (job completed_at).';
COMMENT ON COLUMN public.fertigation_events.started_at IS
  'When fertigation actually began (from the irrigation job).';
COMMENT ON COLUMN public.fertigation_events.ended_at IS
  'When fertigation finished (job completed_at).';
