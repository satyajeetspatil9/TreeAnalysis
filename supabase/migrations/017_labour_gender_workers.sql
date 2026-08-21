-- =============================================================================
-- 017: Labour by male/female worker counts and wages (replaces hours × rate)
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.labour_events
  ADD COLUMN IF NOT EXISTS male_workers INTEGER,
  ADD COLUMN IF NOT EXISTS female_workers INTEGER,
  ADD COLUMN IF NOT EXISTS male_wage NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS female_wage NUMERIC(12,2);
