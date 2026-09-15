-- =============================================================================
-- 061: Advanced irrigation & fertigation programs:
-- 1. Pre-flush and post-flush minutes for 3-phase fertigation
-- 2. Phase tracking on irrigation_jobs (pre_flush, injecting, post_flush, full)
-- =============================================================================

ALTER TABLE public.irrigation_programs
  ADD COLUMN IF NOT EXISTS pre_flush_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS post_flush_minutes INT DEFAULT 0;

COMMENT ON COLUMN public.irrigation_programs.pre_flush_minutes IS
  'Minutes of pure water irrigation before fertilizer injection begins.';
COMMENT ON COLUMN public.irrigation_programs.post_flush_minutes IS
  'Minutes of pure water irrigation after fertilizer injection stops to flush drip emitters.';

ALTER TABLE public.irrigation_program_steps
  ADD COLUMN IF NOT EXISTS pre_flush_minutes INT,
  ADD COLUMN IF NOT EXISTS post_flush_minutes INT;

COMMENT ON COLUMN public.irrigation_program_steps.pre_flush_minutes IS
  'Override pre-flush minutes for this specific zone step.';
COMMENT ON COLUMN public.irrigation_program_steps.post_flush_minutes IS
  'Override post-flush minutes for this specific zone step.';

ALTER TABLE public.irrigation_jobs
  ADD COLUMN IF NOT EXISTS fertigation_phase TEXT DEFAULT 'full';

COMMENT ON COLUMN public.irrigation_jobs.fertigation_phase IS
  'Current fertigation sub-phase: pre_flush, injecting, post_flush, or full.';
