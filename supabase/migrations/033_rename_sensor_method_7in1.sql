-- =============================================================================
-- 033: Rename legacy 8-in-1 sensor method label to 7-in-1 in existing rows
-- Safe to re-run.
-- =============================================================================

UPDATE public.soil_observations
SET method = '7-in-1 sensor'
WHERE method = '8-in-1 sensor';
