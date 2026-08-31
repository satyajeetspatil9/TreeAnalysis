-- =============================================================================
-- 048: Farm lab reports — pH, EC, temperature, N, P, K (same as 7-in-1 sensor)
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.farm_soil_lab_reports
  ADD COLUMN IF NOT EXISTS ph NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS ec NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS nitrogen NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS phosphorus NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS potassium NUMERIC(12,3);
