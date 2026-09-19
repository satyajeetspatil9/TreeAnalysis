-- =============================================================================
-- 063: last_poll_at on ingest keys — set only by irrigation GET
-- Now-tab liveness uses this instead of Turso updated_epoch heartbeats.
-- =============================================================================

ALTER TABLE public.farm_ingest_keys
  ADD COLUMN IF NOT EXISTS last_poll_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_farm_ingest_keys_farm_poll
  ON public.farm_ingest_keys(farm_id, last_poll_at DESC)
  WHERE revoked_at IS NULL;
