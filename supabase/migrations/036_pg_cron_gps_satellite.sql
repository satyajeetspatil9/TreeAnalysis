-- =============================================================================
-- 036: pg_cron weekly GPS satellite batch refresh (replaces GitHub Actions)
-- Requires: pg_cron + pg_net extensions (enable in Dashboard → Database → Extensions)
-- Run after 035_tree_gps_satellite_cache.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Cron config (one row). Set cron_secret = same as Edge Function secret GPS_SATELLITE_CRON_SECRET.
CREATE TABLE IF NOT EXISTS public.gps_satellite_cron_settings (
  singleton_id INT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  supabase_project_url TEXT NOT NULL DEFAULT 'https://jzgfeqiboxrhjnvwxywh.supabase.co',
  anon_key TEXT NOT NULL DEFAULT '',
  cron_secret TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.gps_satellite_cron_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gps_satellite_cron_settings_own ON public.gps_satellite_cron_settings;
CREATE POLICY gps_satellite_cron_settings_own ON public.gps_satellite_cron_settings
  FOR ALL
  USING (public.user_owns_farm(farm_id))
  WITH CHECK (public.user_owns_farm(farm_id));

-- Invoked by pg_cron every 5 min Mon–Wed UTC; processes one tree per call via edge function.
CREATE OR REPLACE FUNCTION public.run_gps_satellite_batch_cron()
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
  FROM public.gps_satellite_cron_settings
  WHERE singleton_id = 1
    AND enabled = TRUE
    AND farm_id IS NOT NULL
    AND anon_key <> ''
    AND cron_secret <> '';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT net.http_post(
    url := rtrim(cfg.supabase_project_url, '/') || '/functions/v1/refresh-gps-satellite-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', cfg.anon_key,
      'x-cron-secret', cfg.cron_secret
    ),
    body := jsonb_build_object(
      'farm_id', cfg.farm_id,
      'limit', 1,
      'days_back', 10
    )
  )
  INTO request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.run_gps_satellite_batch_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_gps_satellite_batch_cron() TO postgres;

-- Reschedule safely on re-run
DO $$
DECLARE
  existing_job_id BIGINT;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'gps-satellite-weekly-batch';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  -- Every 5 minutes on Mon, Tue, Wed (UTC). ~1 tree per tick; edge fn skips cached trees.
  PERFORM cron.schedule(
    'gps-satellite-weekly-batch',
    '*/5 * * * 1,2,3',
    $cron$SELECT public.run_gps_satellite_batch_cron();$cron$
  );
END;
$$;

COMMENT ON TABLE public.gps_satellite_cron_settings IS
  'Configure pg_cron GPS satellite refresh. Set enabled=true after filling anon_key and cron_secret.';

COMMENT ON FUNCTION public.run_gps_satellite_batch_cron IS
  'Posts one batch refresh request to refresh-gps-satellite-batch edge function.';
