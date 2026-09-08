-- =============================================================================
-- 052: Manual pause for running jobs + skip scheduled start when Climate rain
-- Run after 051_production_climate_phenology.sql
-- =============================================================================

ALTER TABLE public.irrigation_programs
  ADD COLUMN IF NOT EXISTS skip_if_rain BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.irrigation_programs.skip_if_rain IS
  'When true, the scheduler does not start this program if Climate rain (Rain_mm > 0) is detected.';

UPDATE public.irrigation_programs
SET skip_if_rain = false
WHERE program_type = 'fertigation';

ALTER TABLE public.irrigation_jobs
  DROP CONSTRAINT IF EXISTS irrigation_jobs_status_check;

ALTER TABLE public.irrigation_jobs
  ADD CONSTRAINT irrigation_jobs_status_check CHECK (status IN (
    'planned', 'running', 'paused_outside_window', 'paused_no_power',
    'paused_manual', 'completed', 'cancelled'
  ));
