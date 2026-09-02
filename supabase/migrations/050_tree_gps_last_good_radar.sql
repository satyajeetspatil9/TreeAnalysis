-- =============================================================================
-- 050: Keep last usable Sentinel-1 radar when a week has radar "No data"
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.tree_gps_satellite_cache
  ADD COLUMN IF NOT EXISTS last_good_radar JSONB,
  ADD COLUMN IF NOT EXISTS last_good_radar_week DATE;
