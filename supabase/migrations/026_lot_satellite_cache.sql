-- =============================================================================
-- 026: Per-lot Sentinel-2 weekly cache (plot fetch + per-tree values)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_owns_lot(p_lot_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM lots l
    JOIN sections s ON s.id = l.section_id
    JOIN phases p ON p.id = s.phase_id
    JOIN farms f ON f.id = p.farm_id
    WHERE l.id = p_lot_id
      AND f.user_id = auth.uid()
  );
$$;

CREATE TABLE IF NOT EXISTS lot_satellite_cache (
    lot_id BIGINT PRIMARY KEY REFERENCES lots(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    boundary JSONB,
    plot_latest JSONB,
    plot_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    trees JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lot_satellite_cache_week
  ON lot_satellite_cache(week_start DESC);

ALTER TABLE lot_satellite_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lot_satellite_cache_own ON lot_satellite_cache;
CREATE POLICY lot_satellite_cache_own ON lot_satellite_cache FOR ALL
  USING (public.user_owns_lot(lot_id))
  WITH CHECK (public.user_owns_lot(lot_id));
