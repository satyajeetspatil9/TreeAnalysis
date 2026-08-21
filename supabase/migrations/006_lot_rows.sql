-- =============================================================================
-- 006: Many rows per lot (e.g. L01 spans R01–R08)
-- Run after 001–005
-- =============================================================================

CREATE TABLE IF NOT EXISTS lot_rows (
    lot_id BIGINT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    row_id BIGINT NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (lot_id, row_id)
);

CREATE INDEX IF NOT EXISTS idx_lot_rows_row_id ON lot_rows(row_id);

ALTER TABLE lots ADD COLUMN IF NOT EXISTS section_id BIGINT REFERENCES sections(id) ON DELETE CASCADE;

ALTER TABLE lots ALTER COLUMN row_id DROP NOT NULL;

-- Backfill section_id and lot_rows from legacy lots.row_id
UPDATE lots l
SET section_id = r.section_id
FROM rows r
WHERE l.row_id = r.id AND l.section_id IS NULL;

INSERT INTO lot_rows (lot_id, row_id)
SELECT l.id, l.row_id
FROM lots l
WHERE l.row_id IS NOT NULL
ON CONFLICT (lot_id, row_id) DO NOTHING;

-- One lot code (L01/L02) per block (section A/B)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lots_section_name ON lots(section_id, name)
WHERE section_id IS NOT NULL;

CREATE OR REPLACE FUNCTION farm_id_for_lot(p_lot_id BIGINT)
RETURNS BIGINT AS $$
  SELECT COALESCE(
    (
      SELECT ph.farm_id
      FROM lots l
      JOIN sections s ON s.id = l.section_id
      JOIN phases ph ON ph.id = s.phase_id
      WHERE l.id = p_lot_id
    ),
    (
      SELECT ph.farm_id
      FROM lot_rows lr
      JOIN rows r ON r.id = lr.row_id
      JOIN sections s ON s.id = r.section_id
      JOIN phases ph ON ph.id = s.phase_id
      WHERE lr.lot_id = p_lot_id
      LIMIT 1
    ),
    (
      SELECT ph.farm_id
      FROM lots l
      JOIN rows r ON r.id = l.row_id
      JOIN sections s ON s.id = r.section_id
      JOIN phases ph ON ph.id = s.phase_id
      WHERE l.id = p_lot_id
    )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

ALTER TABLE lot_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lot_rows_own ON lot_rows;
CREATE POLICY lot_rows_own ON lot_rows FOR ALL
  USING (user_owns_farm(farm_id_for_lot(lot_id)))
  WITH CHECK (user_owns_farm(farm_id_for_lot(lot_id)));

DROP POLICY IF EXISTS lots_own ON lots;
CREATE POLICY lots_own ON lots FOR ALL
  USING (user_owns_farm(farm_id_for_lot(id)))
  WITH CHECK (
    user_owns_farm(COALESCE(
      farm_id_for_section(section_id),
      farm_id_for_row(row_id)
    ))
  );
