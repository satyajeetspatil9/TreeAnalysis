-- App-issued start/stop commands for the irrigation controller to poll

ALTER TABLE public.irrigation_zone_status
  ADD COLUMN IF NOT EXISTS pending_command TEXT
    CHECK (pending_command IS NULL OR pending_command IN ('start', 'stop')),
  ADD COLUMN IF NOT EXISTS pending_command_at TIMESTAMPTZ;

COMMENT ON COLUMN public.irrigation_zone_status.pending_command IS
  'start or stop requested from the app; controller polls GET ingest-irrigation-status and acks on POST.';
