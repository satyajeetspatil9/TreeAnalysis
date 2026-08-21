-- =============================================================================
-- 024: Per-tree Sentinel-2 weekly cache (fetch once each Monday)
-- =============================================================================

CREATE TABLE IF NOT EXISTS tree_satellite_cache (
    tree_id UUID PRIMARY KEY REFERENCES trees(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    latest JSONB,
    history JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tree_satellite_cache_week
  ON tree_satellite_cache(week_start DESC);

ALTER TABLE tree_satellite_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tree_satellite_cache_own ON tree_satellite_cache;
CREATE POLICY tree_satellite_cache_own ON tree_satellite_cache FOR ALL
  USING (user_owns_tree(tree_id))
  WITH CHECK (user_owns_tree(tree_id));
