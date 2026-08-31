-- =============================================================================
-- 049: Lab reports do not include temperature (sensor-only).
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.farm_soil_lab_reports
  DROP COLUMN IF EXISTS temperature_c;
