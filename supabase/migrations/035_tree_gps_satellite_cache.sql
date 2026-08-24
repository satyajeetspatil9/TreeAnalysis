-- =============================================================================
-- 035: Weekly GPS satellite analysis cache (orchard-planetary-api per tree position)
-- Run in Supabase SQL Editor. Satellite tab reads this table; batch job fills it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tree_gps_satellite_cache (
  position_id BIGINT PRIMARY KEY REFERENCES public.tree_positions(id) ON DELETE CASCADE,
  position_code TEXT NOT NULL,
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  analysis JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tree_gps_satellite_cache_farm_week
  ON public.tree_gps_satellite_cache (farm_id, week_start DESC);

CREATE INDEX IF NOT EXISTS idx_tree_gps_satellite_cache_week
  ON public.tree_gps_satellite_cache (week_start DESC);

ALTER TABLE public.tree_gps_satellite_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tree_gps_satellite_cache_own ON public.tree_gps_satellite_cache;
CREATE POLICY tree_gps_satellite_cache_own ON public.tree_gps_satellite_cache
  FOR ALL
  USING (public.user_owns_farm(farm_id))
  WITH CHECK (public.user_owns_farm(farm_id));

-- Stats helper for Settings / batch progress
CREATE OR REPLACE FUNCTION public.gps_satellite_cache_stats(p_farm_id BIGINT)
RETURNS TABLE (
  total_with_gps BIGINT,
  cached_this_week BIGINT,
  week_start DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH week AS (
    SELECT (
      CURRENT_DATE
      - ((EXTRACT(DOW FROM CURRENT_DATE)::INT + 6) % 7) * INTERVAL '1 day'
    )::DATE AS monday
  ),
  positions AS (
    SELECT tp.id
    FROM public.tree_positions tp
    WHERE public.farm_id_for_tree_position(tp.id) = p_farm_id
      AND tp.latitude IS NOT NULL
      AND tp.longitude IS NOT NULL
  )
  SELECT
    (SELECT COUNT(*) FROM positions)::BIGINT,
    (
      SELECT COUNT(*)
      FROM public.tree_gps_satellite_cache c
      JOIN positions p ON p.id = c.position_id
      CROSS JOIN week w
      WHERE c.week_start = w.monday
        AND c.analysis IS NOT NULL
    )::BIGINT,
    (SELECT monday FROM week);
$$;

GRANT EXECUTE ON FUNCTION public.gps_satellite_cache_stats(BIGINT) TO authenticated;

-- Positions needing refresh this week (for batch edge function)
CREATE OR REPLACE FUNCTION public.gps_satellite_positions_to_refresh(
  p_farm_id BIGINT,
  p_after_position_id BIGINT DEFAULT 0,
  p_limit INT DEFAULT 1,
  p_force BOOLEAN DEFAULT false
)
RETURNS TABLE (
  position_id BIGINT,
  position_code TEXT,
  latitude NUMERIC,
  longitude NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH week AS (
    SELECT (
      CURRENT_DATE
      - ((EXTRACT(DOW FROM CURRENT_DATE)::INT + 6) % 7) * INTERVAL '1 day'
    )::DATE AS monday
  )
  SELECT
    tp.id,
    tp.position_code,
    tp.latitude,
    tp.longitude
  FROM public.tree_positions tp
  CROSS JOIN week w
  LEFT JOIN public.tree_gps_satellite_cache c ON c.position_id = tp.id
  WHERE public.farm_id_for_tree_position(tp.id) = p_farm_id
    AND tp.latitude IS NOT NULL
    AND tp.longitude IS NOT NULL
    AND tp.id > p_after_position_id
    AND (
      p_force
      OR c.position_id IS NULL
      OR c.week_start < w.monday
      OR c.analysis IS NULL
    )
  ORDER BY tp.id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 5));
$$;

GRANT EXECUTE ON FUNCTION public.gps_satellite_positions_to_refresh(BIGINT, BIGINT, INT, BOOLEAN) TO authenticated;
