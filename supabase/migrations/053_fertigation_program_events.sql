-- =============================================================================
-- 053: Log scheduled fertigation jobs to fertigation_events; never rain-skip fertigation
-- Run after 052_irrigation_pause_and_skip_rain.sql
-- =============================================================================

ALTER TABLE public.fertigation_events
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_fertigation_events_notes
  ON public.fertigation_events (notes)
  WHERE notes IS NOT NULL;

COMMENT ON COLUMN public.fertigation_events.notes IS
  'Idempotent key for scheduler logs: irrigation_job:{id}:seq:{n}.';

UPDATE public.irrigation_programs
SET skip_if_rain = false
WHERE program_type = 'fertigation'
  AND skip_if_rain IS DISTINCT FROM false;
