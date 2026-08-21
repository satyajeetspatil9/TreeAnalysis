-- =============================================================================
-- 001: Separate TREE POSITION from TREE INSTANCE
-- Run on existing DB that has trees.position_code UNIQUE
-- =============================================================================

CREATE TABLE IF NOT EXISTS tree_positions (
    id BIGSERIAL PRIMARY KEY,
    position_code TEXT NOT NULL UNIQUE,
    lot_id BIGINT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    elevation_m NUMERIC(10,2),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tree_positions_lot_id ON tree_positions(lot_id);
CREATE INDEX IF NOT EXISTS idx_tree_positions_code ON tree_positions(position_code);

-- Add instance columns to trees
ALTER TABLE trees ADD COLUMN IF NOT EXISTS position_id BIGINT REFERENCES tree_positions(id);
ALTER TABLE trees ADD COLUMN IF NOT EXISTS removed_date DATE;

-- Migrate existing trees → positions (when legacy columns still exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trees' AND column_name = 'position_code'
  ) THEN
    INSERT INTO tree_positions (position_code, lot_id, latitude, longitude, elevation_m, created_at)
    SELECT DISTINCT ON (t.position_code)
      t.position_code,
      t.lot_id,
      t.latitude,
      t.longitude,
      t.elevation_m,
      COALESCE(t.created_at, now())
    FROM trees t
    WHERE t.position_code IS NOT NULL
    ORDER BY t.position_code, t.created_at ASC
    ON CONFLICT (position_code) DO NOTHING;

    UPDATE trees t
    SET position_id = tp.id
    FROM tree_positions tp
    WHERE t.position_code = tp.position_code
      AND t.position_id IS NULL;
  END IF;
END $$;

-- Link tree_replacements to positions
ALTER TABLE tree_replacements ADD COLUMN IF NOT EXISTS position_id BIGINT REFERENCES tree_positions(id);

UPDATE tree_replacements tr
SET position_id = tp.id
FROM tree_positions tp
WHERE tr.position_code = tp.position_code
  AND tr.position_id IS NULL;

-- Drop legacy location columns from tree instances
ALTER TABLE trees DROP COLUMN IF EXISTS position_code;
ALTER TABLE trees DROP COLUMN IF EXISTS lot_id;
ALTER TABLE trees DROP COLUMN IF EXISTS latitude;
ALTER TABLE trees DROP COLUMN IF EXISTS longitude;
ALTER TABLE trees DROP COLUMN IF EXISTS elevation_m;

-- Enforce position_id once migrated
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trees WHERE position_id IS NULL) THEN
    ALTER TABLE trees ALTER COLUMN position_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trees_position_id ON trees(position_id);
CREATE INDEX IF NOT EXISTS idx_trees_status ON trees(status);

-- Only one Active instance per physical position
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_tree_per_position
  ON trees (position_id)
  WHERE status = 'Active';

COMMENT ON TABLE tree_positions IS 'Permanent physical tree slot (QR tag location)';
COMMENT ON TABLE trees IS 'Tree instance/generation at a position (supports replacement history)';
