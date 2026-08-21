-- =============================================================================
-- 011: Soil lab reports — remove Ca/Mg, add Cu
-- Run in Supabase SQL Editor after 009.
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.farm_soil_lab_reports
  DROP COLUMN IF EXISTS calcium,
  DROP COLUMN IF EXISTS magnesium;

ALTER TABLE public.farm_soil_lab_reports
  ADD COLUMN IF NOT EXISTS copper NUMERIC(12,3);
