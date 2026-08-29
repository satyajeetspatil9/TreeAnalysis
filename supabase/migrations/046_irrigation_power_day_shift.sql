-- =============================================================================
-- 046: Day-level start shift when mains is late or drops mid-run.
-- Run after 045_irrigation_power_and_per_pin.sql
-- =============================================================================

ALTER TABLE public.irrigation_power_status
  ADD COLUMN IF NOT EXISTS local_date DATE,
  ADD COLUMN IF NOT EXISTS shift_minutes INT NOT NULL DEFAULT 0
    CHECK (shift_minutes >= 0),
  ADD COLUMN IF NOT EXISTS outage_started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.irrigation_power_status.local_date IS
  'Asia/Kolkata calendar day that shift_minutes applies to. Reset at local midnight.';
COMMENT ON COLUMN public.irrigation_power_status.shift_minutes IS
  'Minutes to add to remaining program start times today after a late mains restore or a mid-run outage.';
COMMENT ON COLUMN public.irrigation_power_status.outage_started_at IS
  'When the current mains outage began. Cleared by the scheduler after it applies the delay.';
