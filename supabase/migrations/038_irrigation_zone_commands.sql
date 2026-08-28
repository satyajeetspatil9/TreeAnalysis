-- App-issued start/stop commands for the irrigation controller to poll
-- Safe to run even if 037 was skipped: creates irrigation_zone_status if missing.

CREATE TABLE IF NOT EXISTS public.irrigation_zone_status (
  zone_id BIGINT PRIMARY KEY REFERENCES public.irrigation_zones(id) ON DELETE CASCADE,
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  is_irrigating BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  voltage_v NUMERIC(8, 2),
  current_amp NUMERIC(8, 2),
  start_indicator BOOLEAN NOT NULL DEFAULT false,
  stop_indicator BOOLEAN NOT NULL DEFAULT false,
  current_discharge_lpm NUMERIC(10, 3),
  total_discharge_liters NUMERIC(12, 3),
  device_code TEXT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_irrigation_zone_status_farm
  ON public.irrigation_zone_status (farm_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_zone_status_irrigating
  ON public.irrigation_zone_status (farm_id, is_irrigating)
  WHERE is_irrigating = true;

ALTER TABLE public.irrigation_zone_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS irrigation_zone_status_select ON public.irrigation_zone_status;
CREATE POLICY irrigation_zone_status_select ON public.irrigation_zone_status
  FOR SELECT
  USING (public.user_owns_farm(farm_id));

DROP POLICY IF EXISTS irrigation_zone_status_insert ON public.irrigation_zone_status;
CREATE POLICY irrigation_zone_status_insert ON public.irrigation_zone_status
  FOR INSERT
  WITH CHECK (public.user_owns_farm(farm_id));

DROP POLICY IF EXISTS irrigation_zone_status_update ON public.irrigation_zone_status;
CREATE POLICY irrigation_zone_status_update ON public.irrigation_zone_status
  FOR UPDATE
  USING (public.user_owns_farm(farm_id))
  WITH CHECK (public.user_owns_farm(farm_id));

DROP POLICY IF EXISTS irrigation_zone_status_delete ON public.irrigation_zone_status;
CREATE POLICY irrigation_zone_status_delete ON public.irrigation_zone_status
  FOR DELETE
  USING (public.user_owns_farm(farm_id));

ALTER TABLE public.irrigation_zone_status
  ADD COLUMN IF NOT EXISTS pending_command TEXT
    CHECK (pending_command IS NULL OR pending_command IN ('start', 'stop')),
  ADD COLUMN IF NOT EXISTS pending_command_at TIMESTAMPTZ;

COMMENT ON TABLE public.irrigation_zone_status IS
  'Latest live status from irrigation controller per zone. Updated via ingest-irrigation-status edge function.';

COMMENT ON COLUMN public.irrigation_zone_status.pending_command IS
  'start or stop requested from the app; controller polls GET ingest-irrigation-status and acks on POST.';
