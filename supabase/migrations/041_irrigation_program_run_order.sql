-- Program run order: lower runs first; next program waits until previous completes

ALTER TABLE public.irrigation_programs
  ADD COLUMN IF NOT EXISTS run_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_irrigation_programs_run_order
  ON public.irrigation_programs (farm_id, program_type, run_order, id);

COMMENT ON COLUMN public.irrigation_programs.run_order IS
  'Lower number runs first. Only one program job runs at a time; next starts after previous finishes.';
