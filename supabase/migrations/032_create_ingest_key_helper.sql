-- =============================================================================
-- 032: Helper to create ESP32 ingest keys in SQL Editor (no frontend needed)
-- Requires 031_farm_ingest_keys.sql applied first.
-- Safe to re-run.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.create_farm_ingest_key(
  p_farm_id BIGINT,
  p_label TEXT DEFAULT 'ESP32'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_hash TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = p_farm_id) THEN
    RAISE EXCEPTION 'Farm id % not found. Run: SELECT id, name FROM farms;', p_farm_id;
  END IF;

  v_key := 'ta_' || encode(gen_random_bytes(24), 'hex');
  v_hash := encode(digest(v_key, 'sha256'), 'hex');

  INSERT INTO public.farm_ingest_keys (farm_id, label, key_prefix, key_hash)
  VALUES (p_farm_id, coalesce(nullif(trim(p_label), ''), 'ESP32'), left(v_key, 12), v_hash);

  RETURN v_key;
END;
$$;

COMMENT ON FUNCTION public.create_farm_ingest_key IS
  'Creates an ESP32 ingest API key. Returns the plain key once — copy it immediately. Example: SELECT create_farm_ingest_key(1, ''ESP32 row A'');';
