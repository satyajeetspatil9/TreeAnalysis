-- =============================================================================
-- 003: Row Level Security — farm data isolated by farms.user_id
-- Apply after auth is wired in the app
-- =============================================================================

ALTER TABLE farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tree_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trees ENABLE ROW LEVEL SECURITY;

-- Helper: farms owned by current user
CREATE OR REPLACE FUNCTION user_owns_farm(p_farm_id BIGINT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM farms f
    WHERE f.id = p_farm_id AND f.user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION farm_id_for_phase(p_phase_id BIGINT)
RETURNS BIGINT AS $$
  SELECT farm_id FROM phases WHERE id = p_phase_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION farm_id_for_section(p_section_id BIGINT)
RETURNS BIGINT AS $$
  SELECT p.farm_id FROM sections s JOIN phases p ON p.id = s.phase_id WHERE s.id = p_section_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION farm_id_for_row(p_row_id BIGINT)
RETURNS BIGINT AS $$
  SELECT ph.farm_id
  FROM rows r
  JOIN sections s ON s.id = r.section_id
  JOIN phases ph ON ph.id = s.phase_id
  WHERE r.id = p_row_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION farm_id_for_lot(p_lot_id BIGINT)
RETURNS BIGINT AS $$
  SELECT ph.farm_id
  FROM lots l
  JOIN rows r ON r.id = l.row_id
  JOIN sections s ON s.id = r.section_id
  JOIN phases ph ON ph.id = s.phase_id
  WHERE l.id = p_lot_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION farm_id_for_tree_position(p_position_id BIGINT)
RETURNS BIGINT AS $$
  SELECT farm_id_for_lot(tp.lot_id) FROM tree_positions tp WHERE tp.id = p_position_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION farm_id_for_tree(p_tree_id UUID)
RETURNS BIGINT AS $$
  SELECT farm_id_for_tree_position(t.position_id) FROM trees t WHERE t.id = p_tree_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Farms
DROP POLICY IF EXISTS farms_select_own ON farms;
CREATE POLICY farms_select_own ON farms FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS farms_modify_own ON farms;
CREATE POLICY farms_modify_own ON farms FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Phases
DROP POLICY IF EXISTS phases_own ON phases;
CREATE POLICY phases_own ON phases FOR ALL
  USING (user_owns_farm(farm_id)) WITH CHECK (user_owns_farm(farm_id));

-- Sections
DROP POLICY IF EXISTS sections_own ON sections;
CREATE POLICY sections_own ON sections FOR ALL
  USING (user_owns_farm(farm_id_for_section(id)))
  WITH CHECK (user_owns_farm(farm_id_for_section(phase_id)));

-- Rows
DROP POLICY IF EXISTS rows_own ON rows;
CREATE POLICY rows_own ON rows FOR ALL
  USING (user_owns_farm(farm_id_for_row(id)))
  WITH CHECK (user_owns_farm(farm_id_for_row(section_id)));

-- Lots
DROP POLICY IF EXISTS lots_own ON lots;
CREATE POLICY lots_own ON lots FOR ALL
  USING (user_owns_farm(farm_id_for_lot(id)))
  WITH CHECK (user_owns_farm(farm_id_for_lot(row_id)));

-- Tree positions
DROP POLICY IF EXISTS tree_positions_own ON tree_positions;
CREATE POLICY tree_positions_own ON tree_positions FOR ALL
  USING (user_owns_farm(farm_id_for_lot(lot_id)))
  WITH CHECK (user_owns_farm(farm_id_for_lot(lot_id)));

-- Trees (instances)
DROP POLICY IF EXISTS trees_own ON trees;
CREATE POLICY trees_own ON trees FOR ALL
  USING (user_owns_farm(farm_id_for_tree_position(position_id)))
  WITH CHECK (user_owns_farm(farm_id_for_tree_position(position_id)));

-- NOTE: Enable RLS on operational tables (irrigation, expenses, etc.) using the same
-- farm_id_for_tree / zone patterns before production deployment.
