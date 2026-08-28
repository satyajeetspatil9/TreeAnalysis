-- =============================================================================
-- 040: pg_cron for irrigation-scheduler (every minute)
-- Requires: pg_cron + pg_net (same as 036). Run after 039.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.irrigation_scheduler_cron_settings (
  singleton_id INT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  supabase_project_url TEXT NOT NULL DEFAULT 'https://jzgfeqiboxrhjnvwxywh.supabase.co',
  anon_key TEXT NOT NULL DEFAULT '',
  cron_secret TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.irrigation_scheduler_cron_settings ENABLE ROW LEVEL SECURITY;

-- Config holds secrets; no client access. Service role / SQL editor only.
DROP POLICY IF EXISTS irrigation_scheduler_cron_settings_all ON public.irrigation_scheduler_cron_settings;
REVOKE ALL ON public.irrigation_scheduler_cron_settings FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.run_irrigation_scheduler_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cfg RECORD;
  request_id BIGINT;
BEGIN
  SELECT *
  INTO cfg
  FROM public.irrigation_scheduler_cron_settings
  WHERE singleton_id = 1
    AND enabled = TRUE
    AND anon_key <> ''
    AND cron_secret <> '';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT net.http_post(
    url := rtrim(cfg.supabase_project_url, '/') || '/functions/v1/irrigation-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', cfg.anon_key,
      'x-cron-secret', cfg.cron_secret
    ),
    body := '{}'::jsonb
  )
  INTO request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.run_irrigation_scheduler_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_irrigation_scheduler_cron() TO postgres;

DO $$
DECLARE
  existing_job_id BIGINT;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'irrigation-scheduler-minute';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'irrigation-scheduler-minute',
    '* * * * *',
    $cron$SELECT public.run_irrigation_scheduler_cron();$cron$
  );
END;
$$;

COMMENT ON TABLE public.irrigation_scheduler_cron_settings IS
  'Enable irrigation scheduler: set anon_key, cron_secret (IRRIGATION_SCHEDULER_CRON_SECRET), enabled=true.';
COMMENT ON FUNCTION public.run_irrigation_scheduler_cron IS
  'Posts to irrigation-scheduler edge function every minute when enabled.';
