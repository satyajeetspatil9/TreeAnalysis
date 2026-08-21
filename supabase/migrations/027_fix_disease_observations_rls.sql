-- =============================================================================
-- 027: Fix disease_observations RLS (Tree Dashboard → Disease tab)
-- Run in Supabase SQL Editor if Save Observation fails with row-level security errors.
-- Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_owns_farm(p_farm_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.farms f
    WHERE f.id = p_farm_id AND f.user_id = auth.uid()
  );
$$;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.disease_observations TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S'
      AND n.nspname = 'public'
      AND c.relname = 'disease_observations_id_seq'
  ) THEN
    GRANT USAGE, SELECT ON SEQUENCE public.disease_observations_id_seq TO authenticated;
  END IF;
END $$;

ALTER TABLE public.disease_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS disease_observations_own ON public.disease_observations;
DROP POLICY IF EXISTS disease_observations_select ON public.disease_observations;
DROP POLICY IF EXISTS disease_observations_insert ON public.disease_observations;
DROP POLICY IF EXISTS disease_observations_update ON public.disease_observations;
DROP POLICY IF EXISTS disease_observations_delete ON public.disease_observations;

CREATE POLICY disease_observations_select ON public.disease_observations
  FOR SELECT TO authenticated
  USING (public.user_owns_tree(tree_id));

CREATE POLICY disease_observations_insert ON public.disease_observations
  FOR INSERT TO authenticated
  WITH CHECK (tree_id IS NOT NULL AND public.user_owns_tree(tree_id));

CREATE POLICY disease_observations_update ON public.disease_observations
  FOR UPDATE TO authenticated
  USING (public.user_owns_tree(tree_id))
  WITH CHECK (tree_id IS NOT NULL AND public.user_owns_tree(tree_id));

CREATE POLICY disease_observations_delete ON public.disease_observations
  FOR DELETE TO authenticated
  USING (public.user_owns_tree(tree_id));
