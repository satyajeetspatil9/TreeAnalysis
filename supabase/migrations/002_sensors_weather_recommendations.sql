-- =============================================================================
-- 002: Sensors, weather, recommendations, spray, satellite extras, audit
-- =============================================================================

-- Sensor infrastructure (ESP32 / field devices)
CREATE TABLE IF NOT EXISTS sensors (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    soil_zone_id BIGINT REFERENCES soil_zones(id) ON DELETE SET NULL,
    tree_id UUID REFERENCES trees(id) ON DELETE SET NULL,
    device_code TEXT NOT NULL,
    sensor_type TEXT NOT NULL,
    manufacturer TEXT,
    model TEXT,
    installation_date DATE,
    status TEXT DEFAULT 'Active',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (farm_id, device_code)
);

CREATE TABLE IF NOT EXISTS sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    sensor_id BIGINT NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    temperature_c NUMERIC(8,2),
    moisture_percent NUMERIC(8,2),
    ec NUMERIC(10,4),
    ph NUMERIC(8,3),
    battery_voltage NUMERIC(6,3),
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_sensor_time
  ON sensor_readings(sensor_id, recorded_at DESC);

-- Weather
CREATE TABLE IF NOT EXISTS weather_observations (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    temperature_c NUMERIC(8,2),
    humidity_percent NUMERIC(8,2),
    rainfall_mm NUMERIC(10,2),
    wind_speed_kph NUMERIC(8,2),
    wind_direction_deg NUMERIC(8,2),
    solar_radiation_wm2 NUMERIC(10,2),
    pressure_hpa NUMERIC(10,2),
    source TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weather_farm_time
  ON weather_observations(farm_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS weather_forecasts (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    forecast_for TIMESTAMPTZ NOT NULL,
    temperature_c NUMERIC(8,2),
    humidity_percent NUMERIC(8,2),
    rainfall_mm NUMERIC(10,2),
    wind_speed_kph NUMERIC(8,2),
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fertilizer optimizer output
CREATE TABLE IF NOT EXISTS fertilizer_recommendations (
    id BIGSERIAL PRIMARY KEY,
    tree_id UUID REFERENCES trees(id) ON DELETE CASCADE,
    soil_zone_id BIGINT REFERENCES soil_zones(id) ON DELETE CASCADE,
    recommended_date DATE NOT NULL DEFAULT CURRENT_DATE,
    growth_stage TEXT,
    target_n NUMERIC(12,3),
    target_p NUMERIC(12,3),
    target_k NUMERIC(12,3),
    target_s NUMERIC(12,3),
    recommended_products JSONB,
    estimated_cost NUMERIC(14,2),
    status TEXT DEFAULT 'Draft',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    CHECK (tree_id IS NOT NULL OR soil_zone_id IS NOT NULL)
);

-- Spray / plant protection
CREATE TABLE IF NOT EXISTS spray_events (
    id BIGSERIAL PRIMARY KEY,
    event_date DATE NOT NULL DEFAULT CURRENT_DATE,
    zone_id BIGINT REFERENCES irrigation_zones(id),
    phase_id BIGINT REFERENCES phases(id),
    purpose TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spray_products (
    id BIGSERIAL PRIMARY KEY,
    spray_event_id BIGINT NOT NULL REFERENCES spray_events(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id),
    quantity NUMERIC(14,3) NOT NULL,
    unit TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Disease category
ALTER TABLE disease_observations
  ADD COLUMN IF NOT EXISTS problem_category TEXT
  CHECK (problem_category IS NULL OR problem_category IN (
    'DISEASE', 'PEST', 'NUTRIENT_DEFICIENCY', 'WATER_STRESS', 'PHYSICAL_DAMAGE', 'OTHER'
  ));

-- Satellite geometry / image reference
ALTER TABLE satellite_observations
  ADD COLUMN IF NOT EXISTS geometry JSONB,
  ADD COLUMN IF NOT EXISTS image_id TEXT,
  ADD COLUMN IF NOT EXISTS cloud_percentage NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS resolution_m NUMERIC(8,3);

-- Recommendations / action engine
CREATE TABLE IF NOT EXISTS recommendations (
    id BIGSERIAL PRIMARY KEY,
    tree_id UUID REFERENCES trees(id) ON DELETE CASCADE,
    zone_id BIGINT REFERENCES irrigation_zones(id) ON DELETE CASCADE,
    recommended_date DATE NOT NULL DEFAULT CURRENT_DATE,
    recommendation_type TEXT NOT NULL,
    priority TEXT DEFAULT 'Medium',
    reason TEXT,
    recommendation TEXT NOT NULL,
    status TEXT DEFAULT 'Open',
    completed_at TIMESTAMPTZ,
    result TEXT,
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_status
  ON recommendations(status, recommended_date DESC);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record
  ON audit_log(table_name, record_id, created_at DESC);
