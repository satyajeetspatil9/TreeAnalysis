-- =============================================================================
-- 031: API keys for ESP32 / external 7-in-1 sensor ingest
-- Run in Supabase SQL Editor. Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.farm_ingest_keys (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'ESP32',
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_farm_ingest_keys_hash
  ON public.farm_ingest_keys(key_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_farm_ingest_keys_farm
  ON public.farm_ingest_keys(farm_id);

GRANT SELECT, INSERT, UPDATE ON public.farm_ingest_keys TO authenticated;

ALTER TABLE public.farm_ingest_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_ingest_keys_own ON public.farm_ingest_keys;
CREATE POLICY farm_ingest_keys_own ON public.farm_ingest_keys
  FOR ALL TO authenticated
  USING (public.user_owns_farm(farm_id))
  WITH CHECK (public.user_owns_farm(farm_id));

-- Resolve active tree UUID from position code within a farm (for edge function / RPC)
CREATE OR REPLACE FUNCTION public.resolve_active_tree_for_position(
  p_farm_id BIGINT,
  p_position_code TEXT
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id
  FROM public.trees t
  JOIN public.tree_positions tp ON tp.id = t.position_id
  WHERE upper(trim(tp.position_code)) = upper(trim(p_position_code))
    AND t.status = 'Active'
    AND public.farm_id_for_tree(t.id) = p_farm_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_active_tree_for_position(BIGINT, TEXT) TO service_role;
