-- =============================================================================
-- 047: Controller-supplied outage end time.
-- Run after 046_irrigation_power_day_shift.sql
-- =============================================================================

ALTER TABLE public.irrigation_power_status
  ADD COLUMN IF NOT EXISTS outage_ended_at TIMESTAMPTZ;

COMMENT ON COLUMN public.irrigation_power_status.outage_started_at IS
  'Mains outage start as reported by the controller. Not inferred from ingest time.';
COMMENT ON COLUMN public.irrigation_power_status.outage_ended_at IS
  'Mains outage end as reported by the controller. The scheduler applies the delay only when both start and end are set.';
