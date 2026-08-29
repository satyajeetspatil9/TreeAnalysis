-- Duration-based fertigation jobs: motor + injector run for on_duration_minutes.

ALTER TABLE public.irrigation_jobs
  ADD COLUMN IF NOT EXISTS on_duration_minutes INT
    CHECK (on_duration_minutes IS NULL OR on_duration_minutes > 0),
  ADD COLUMN IF NOT EXISTS duration_elapsed_minutes NUMERIC(10, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.irrigation_jobs.on_duration_minutes IS
  'When set, the job (valve, irrigation motor, injector) stops after this many minutes instead of a liter target.';
