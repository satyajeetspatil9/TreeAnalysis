-- =============================================================================
-- 009: Farm-wide soil lab reports (micronutrients shared across all trees)
-- Run in Supabase SQL Editor after 008.
-- Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.farm_soil_lab_reports (
  id BIGSERIAL PRIMARY KEY,
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  sample_date DATE NOT NULL DEFAULT CURRENT_DATE,
  lab_name TEXT,
  notes TEXT,
  sulphur NUMERIC(12,3),
  zinc NUMERIC(12,3),
  iron NUMERIC(12,3),
  manganese NUMERIC(12,3),
  boron NUMERIC(12,3),
  copper NUMERIC(12,3),
  organic_carbon NUMERIC(12,3),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_soil_lab_reports_farm_date
  ON public.farm_soil_lab_reports(farm_id, sample_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_soil_lab_reports TO authenticated;

ALTER TABLE public.farm_soil_lab_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_soil_lab_reports_select ON public.farm_soil_lab_reports;
DROP POLICY IF EXISTS farm_soil_lab_reports_insert ON public.farm_soil_lab_reports;
DROP POLICY IF EXISTS farm_soil_lab_reports_update ON public.farm_soil_lab_reports;
DROP POLICY IF EXISTS farm_soil_lab_reports_delete ON public.farm_soil_lab_reports;

CREATE POLICY farm_soil_lab_reports_select ON public.farm_soil_lab_reports
  FOR SELECT TO authenticated
  USING (public.user_owns_farm(farm_id));

CREATE POLICY farm_soil_lab_reports_insert ON public.farm_soil_lab_reports
  FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_farm(farm_id));

CREATE POLICY farm_soil_lab_reports_update ON public.farm_soil_lab_reports
  FOR UPDATE TO authenticated
  USING (public.user_owns_farm(farm_id))
  WITH CHECK (public.user_owns_farm(farm_id));

CREATE POLICY farm_soil_lab_reports_delete ON public.farm_soil_lab_reports
  FOR DELETE TO authenticated
  USING (public.user_owns_farm(farm_id));
