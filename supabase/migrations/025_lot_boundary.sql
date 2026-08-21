-- =============================================================================
-- 025: Lot plot boundary (GeoJSON polygon for Sentinel-2 plot fetch)
-- =============================================================================

ALTER TABLE lots ADD COLUMN IF NOT EXISTS boundary JSONB;

COMMENT ON COLUMN lots.boundary IS
  'GeoJSON Polygon (WGS84) for the lot/plot area used for Sentinel-2 fetch';
