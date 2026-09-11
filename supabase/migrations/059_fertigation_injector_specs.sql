-- =============================================================================
-- 059: Tank, fertilizer flow, and product on fertigation injector devices
-- Run after 058_event_start_end_times.sql
-- =============================================================================

ALTER TABLE public.irrigation_devices
  ADD COLUMN IF NOT EXISTS tank_capacity_liters NUMERIC,
  ADD COLUMN IF NOT EXISTS fertilizer_flow_lph NUMERIC,
  ADD COLUMN IF NOT EXISTS product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_irrigation_devices_product
  ON public.irrigation_devices (product_id);

COMMENT ON COLUMN public.irrigation_devices.tank_capacity_liters IS
  'Fertigation injector tank size in liters.';
COMMENT ON COLUMN public.irrigation_devices.fertilizer_flow_lph IS
  'Fertigation injector fertilizer solution flow in liters per hour.';
COMMENT ON COLUMN public.irrigation_devices.product_id IS
  'Fertilizer product loaded in this injector tank.';
