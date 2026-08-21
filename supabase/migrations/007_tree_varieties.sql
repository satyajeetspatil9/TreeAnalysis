-- =============================================================================
-- 007: Configurable tree varieties per farm
-- Run after 001–006
-- =============================================================================

CREATE TABLE IF NOT EXISTS tree_varieties (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (farm_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tree_varieties_farm_id ON tree_varieties(farm_id);

ALTER TABLE tree_varieties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tree_varieties_own ON tree_varieties;
CREATE POLICY tree_varieties_own ON tree_varieties FOR ALL
  USING (user_owns_farm(farm_id))
  WITH CHECK (user_owns_farm(farm_id));
