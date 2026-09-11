-- =============================================================================
-- 060: Cron must send Authorization so irrigation-scheduler can be invoked
-- Run after 040_irrigation_scheduler_cron.sql
-- =============================================================================

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
      'Authorization', 'Bearer ' || cfg.anon_key,
      'apikey', cfg.anon_key,
      'x-cron-secret', cfg.cron_secret
    ),
    body := '{}'::jsonb
  )
  INTO request_id;
END;
$$;
