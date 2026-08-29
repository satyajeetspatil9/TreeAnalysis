-- =============================================================================
-- 045: Mains power presence, per-pin commands, and a completion cap for
--      liter-target jobs.
-- Run after 044_irrigation_event_notes.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Mains power reported by the controller (farm-wide, one row per farm)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.irrigation_power_status (
  farm_id BIGINT PRIMARY KEY REFERENCES public.farms(id) ON DELETE CASCADE,
  power_present BOOLEAN NOT NULL DEFAULT true,
  changed_at TIMESTAMPTZ,
  reported_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.irrigation_power_status IS
  'Latest mains power presence reported by the controller. When power_present is false the scheduler pauses every running job and resumes it once power returns.';
COMMENT ON COLUMN public.irrigation_power_status.changed_at IS
  'When power_present last flipped, used to show how long the outage has lasted.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_power_status TO authenticated;

ALTER TABLE public.irrigation_power_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS irrigation_power_status_select ON public.irrigation_power_status;
CREATE POLICY irrigation_power_status_select ON public.irrigation_power_status
  FOR SELECT USING (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_power_status_insert ON public.irrigation_power_status;
CREATE POLICY irrigation_power_status_insert ON public.irrigation_power_status
  FOR INSERT WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_power_status_update ON public.irrigation_power_status;
CREATE POLICY irrigation_power_status_update ON public.irrigation_power_status
  FOR UPDATE USING (public.user_owns_farm(farm_id)) WITH CHECK (public.user_owns_farm(farm_id));

-- ---------------------------------------------------------------------------
-- 2. Jobs can now be paused because mains power is gone
-- ---------------------------------------------------------------------------
ALTER TABLE public.irrigation_jobs
  DROP CONSTRAINT IF EXISTS irrigation_jobs_status_check;

ALTER TABLE public.irrigation_jobs
  ADD CONSTRAINT irrigation_jobs_status_check CHECK (status IN (
    'planned', 'running', 'paused_outside_window', 'paused_no_power',
    'completed', 'cancelled'
  ));

-- ---------------------------------------------------------------------------
-- 3. Completion cap for liter-target jobs
--
-- A water job whose target_liters can never be reached (no flow telemetry)
-- used to stay open forever and, through the one-job-at-a-time rule, block
-- every later program. max_duration_minutes gives the job a second way to
-- finish and doubles as the until.minutes fail-safe sent to the controller.
-- ---------------------------------------------------------------------------
ALTER TABLE public.irrigation_jobs
  ADD COLUMN IF NOT EXISTS max_duration_minutes INT
    CHECK (max_duration_minutes IS NULL OR max_duration_minutes > 0);

COMMENT ON COLUMN public.irrigation_jobs.max_duration_minutes IS
  'Run-time cap in minutes. The job completes at whichever comes first: target_liters, on_duration_minutes, or this cap.';

-- ---------------------------------------------------------------------------
-- 4. Retire queue rows whose device_code is not a controller terminal
--
-- Older builds wrote ZONE-<zone_code> into device_code. The controller has no
-- such pin, so those rows can never be applied.
-- ---------------------------------------------------------------------------
UPDATE public.irrigation_command_queue
SET status = 'cancelled'
WHERE status = 'pending'
  AND device_code !~ '^[XY][0-9]+$';

-- Legacy single-command mirror: drop anything the controller never picked up.
UPDATE public.irrigation_zone_status
SET pending_command = NULL,
    pending_command_at = NULL
WHERE pending_command IS NOT NULL
  AND (pending_command_at IS NULL OR pending_command_at < now() - INTERVAL '1 hour');

-- ---------------------------------------------------------------------------
-- 5. Index for the per-pin "what did we last tell this terminal" lookup
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_irrigation_command_queue_device_recent
  ON public.irrigation_command_queue (farm_id, device_code, created_at DESC);
