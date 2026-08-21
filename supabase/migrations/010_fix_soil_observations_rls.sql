-- =============================================================================
-- 010: Fix soil_observations RLS (sensor readings per tree)
-- Run in Supabase SQL Editor if inserts fail with row-level security errors.
-- Safe to re-run.
-- Depends on helpers from 008 (farm_id_for_tree, user_owns_tree, user_owns_farm).
-- =============================================================================

-- Ensure tree → farm resolution works for lots on lot_rows (not only lots.row_id)
CREATE OR REPLACE FUNCTION public.farm_id_for_lot(p_lot_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT ph.farm_id
      FROM public.lots l
      JOIN public.sections s ON s.id = l.section_id
      JOIN public.phases ph ON ph.id = s.phase_id
      WHERE l.id = p_lot_id
    ),
    (
      SELECT ph.farm_id
      FROM public.lot_rows lr
      JOIN public.rows r ON r.id = lr.row_id
      JOIN public.sections s ON s.id = r.section_id
      JOIN public.phases ph ON ph.id = s.phase_id
      WHERE lr.lot_id = p_lot_id
      LIMIT 1
    ),
    (
      SELECT ph.farm_id
      FROM public.lots l
      JOIN public.rows r ON r.id = l.row_id
      JOIN public.sections s ON s.id = r.section_id
      JOIN public.phases ph ON ph.id = s.phase_id
      WHERE l.id = p_lot_id
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.farm_id_for_tree_position(p_position_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.farm_id_for_lot(tp.lot_id)
  FROM public.tree_positions tp
  WHERE tp.id = p_position_id;
$$;

CREATE OR REPLACE FUNCTION public.farm_id_for_tree(p_tree_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.farm_id_for_tree_position(t.position_id)
  FROM public.trees t
  WHERE t.id = p_tree_id;
$$;

CREATE OR REPLACE FUNCTION public.user_owns_tree(p_tree_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_owns_farm(public.farm_id_for_tree(p_tree_id));
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.soil_observations TO authenticated;

ALTER TABLE public.soil_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS soil_obs_own ON public.soil_observations;
DROP POLICY IF EXISTS soil_observations_own ON public.soil_observations;
DROP POLICY IF EXISTS soil_observations_select ON public.soil_observations;
DROP POLICY IF EXISTS soil_observations_insert ON public.soil_observations;
DROP POLICY IF EXISTS soil_observations_update ON public.soil_observations;
DROP POLICY IF EXISTS soil_observations_delete ON public.soil_observations;

CREATE POLICY soil_observations_select ON public.soil_observations
  FOR SELECT TO authenticated
  USING (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (
      soil_zone_id IS NOT NULL
      AND public.user_owns_farm((
        SELECT sz.farm_id FROM public.soil_zones sz WHERE sz.id = soil_zone_id
      ))
    )
  );

CREATE POLICY soil_observations_insert ON public.soil_observations
  FOR INSERT TO authenticated
  WITH CHECK (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (
      soil_zone_id IS NOT NULL
      AND public.user_owns_farm((
        SELECT sz.farm_id FROM public.soil_zones sz WHERE sz.id = soil_zone_id
      ))
    )
  );

CREATE POLICY soil_observations_update ON public.soil_observations
  FOR UPDATE TO authenticated
  USING (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (
      soil_zone_id IS NOT NULL
      AND public.user_owns_farm((
        SELECT sz.farm_id FROM public.soil_zones sz WHERE sz.id = soil_zone_id
      ))
    )
  )
  WITH CHECK (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (
      soil_zone_id IS NOT NULL
      AND public.user_owns_farm((
        SELECT sz.farm_id FROM public.soil_zones sz WHERE sz.id = soil_zone_id
      ))
    )
  );

CREATE POLICY soil_observations_delete ON public.soil_observations
  FOR DELETE TO authenticated
  USING (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (
      soil_zone_id IS NOT NULL
      AND public.user_owns_farm((
        SELECT sz.farm_id FROM public.soil_zones sz WHERE sz.id = soil_zone_id
      ))
    )
  );
