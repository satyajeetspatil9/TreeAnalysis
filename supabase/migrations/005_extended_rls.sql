-- =============================================================================
-- 005: Extended RLS for all operational tables
-- =============================================================================

CREATE OR REPLACE FUNCTION farm_id_for_zone(p_zone_id BIGINT)
RETURNS BIGINT AS $$
  SELECT farm_id FROM irrigation_zones WHERE id = p_zone_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION user_owns_zone(p_zone_id BIGINT)
RETURNS BOOLEAN AS $$
  SELECT user_owns_farm(farm_id_for_zone(p_zone_id));
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION user_owns_tree(p_tree_id UUID)
RETURNS BOOLEAN AS $$
  SELECT user_owns_farm(farm_id_for_tree(p_tree_id));
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Macro: enable RLS + policy for tree-scoped tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tree_irrigation_zones', 'tree_replacements', 'tree_growth',
    'disease_observations', 'photos', 'flowering_events',
    'fruit_set_observations', 'harvest_events', 'tree_alerts',
    'soil_observations', 'fertilizer_recommendations', 'recommendations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_own ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_own ON %I FOR ALL USING (user_owns_tree(tree_id)) WITH CHECK (user_owns_tree(tree_id))',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Irrigation zones
ALTER TABLE irrigation_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS irrigation_zones_own ON irrigation_zones;
CREATE POLICY irrigation_zones_own ON irrigation_zones FOR ALL
  USING (user_owns_farm(farm_id)) WITH CHECK (user_owns_farm(farm_id));

-- Irrigation events
ALTER TABLE irrigation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS irrigation_events_own ON irrigation_events;
CREATE POLICY irrigation_events_own ON irrigation_events FOR ALL
  USING (user_owns_zone(zone_id)) WITH CHECK (user_owns_zone(zone_id));

-- Fertigation
ALTER TABLE fertigation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fertigation_events_own ON fertigation_events;
CREATE POLICY fertigation_events_own ON fertigation_events FOR ALL
  USING (user_owns_zone(zone_id)) WITH CHECK (user_owns_zone(zone_id));

ALTER TABLE fertigation_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fertigation_products_own ON fertigation_products;
CREATE POLICY fertigation_products_own ON fertigation_products FOR ALL
  USING (EXISTS (
    SELECT 1 FROM fertigation_events fe WHERE fe.id = fertigation_event_id AND user_owns_zone(fe.zone_id)
  ));

-- Products & inventory (shared catalog — readable by authenticated users)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_read ON products;
CREATE POLICY products_read ON products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS products_write ON products;
CREATE POLICY products_write ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_all ON inventory;
CREATE POLICY inventory_all ON inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_tx_all ON inventory_transactions;
CREATE POLICY inventory_tx_all ON inventory_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expenses_all ON expenses;
CREATE POLICY expenses_all ON expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE expense_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_allocations_all ON expense_allocations;
CREATE POLICY expense_allocations_all ON expense_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Labour
ALTER TABLE labour_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labour_all ON labour_events;
CREATE POLICY labour_all ON labour_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Soil zones
ALTER TABLE soil_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS soil_zones_own ON soil_zones;
CREATE POLICY soil_zones_own ON soil_zones FOR ALL
  USING (user_owns_farm(farm_id)) WITH CHECK (user_owns_farm(farm_id));

-- Soil observations (tree or zone scoped)
ALTER TABLE soil_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS soil_obs_own ON soil_observations;
CREATE POLICY soil_obs_own ON soil_observations FOR ALL USING (
  (tree_id IS NOT NULL AND user_owns_tree(tree_id))
  OR (soil_zone_id IS NOT NULL AND user_owns_farm((SELECT farm_id FROM soil_zones WHERE id = soil_zone_id)))
);

-- Satellite
ALTER TABLE satellite_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS satellite_own ON satellite_observations;
CREATE POLICY satellite_own ON satellite_observations FOR ALL
  USING (user_owns_farm(farm_id)) WITH CHECK (user_owns_farm(farm_id));

-- Sensors & weather
ALTER TABLE sensors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sensors_own ON sensors;
CREATE POLICY sensors_own ON sensors FOR ALL
  USING (user_owns_farm(farm_id)) WITH CHECK (user_owns_farm(farm_id));

ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sensor_readings_own ON sensor_readings;
CREATE POLICY sensor_readings_own ON sensor_readings FOR ALL USING (
  EXISTS (SELECT 1 FROM sensors s WHERE s.id = sensor_id AND user_owns_farm(s.farm_id))
);

ALTER TABLE weather_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS weather_own ON weather_observations;
CREATE POLICY weather_own ON weather_observations FOR ALL
  USING (user_owns_farm(farm_id)) WITH CHECK (user_owns_farm(farm_id));

ALTER TABLE weather_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS weather_forecast_own ON weather_forecasts;
CREATE POLICY weather_forecast_own ON weather_forecasts FOR ALL
  USING (user_owns_farm(farm_id)) WITH CHECK (user_owns_farm(farm_id));

-- Spray
ALTER TABLE spray_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spray_events_own ON spray_events;
CREATE POLICY spray_events_own ON spray_events FOR ALL USING (
  (zone_id IS NULL) OR user_owns_zone(zone_id)
);

ALTER TABLE spray_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spray_products_own ON spray_products;
CREATE POLICY spray_products_own ON spray_products FOR ALL USING (
  EXISTS (SELECT 1 FROM spray_events se WHERE se.id = spray_event_id)
);

-- Assets
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assets_own ON assets;
CREATE POLICY assets_own ON assets FOR ALL
  USING (user_owns_farm(farm_id)) WITH CHECK (user_owns_farm(farm_id));

-- tree_irrigation_zones uses tree_id
ALTER TABLE tree_irrigation_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tree_irrigation_zones_own ON tree_irrigation_zones;
CREATE POLICY tree_irrigation_zones_own ON tree_irrigation_zones FOR ALL
  USING (user_owns_tree(tree_id)) WITH CHECK (user_owns_tree(tree_id));
