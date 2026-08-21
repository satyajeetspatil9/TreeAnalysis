-- =============================================================================
-- 021: Fix harvest_events RLS
-- Run in Supabase SQL Editor if inserts fail with row-level security errors on:
--   harvest_events
-- Safe to re-run.
-- Depends on helpers from 008 (re-applied below for safety).
-- =============================================================================

-- Ensure ownership helpers resolve tree → farm correctly (lot_rows, section lots, etc.)
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.harvest_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.harvest_events_id_seq TO authenticated;

ALTER TABLE public.harvest_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS harvest_events_own ON public.harvest_events;
DROP POLICY IF EXISTS harvest_events_select ON public.harvest_events;
DROP POLICY IF EXISTS harvest_events_insert ON public.harvest_events;
DROP POLICY IF EXISTS harvest_events_update ON public.harvest_events;
DROP POLICY IF EXISTS harvest_events_delete ON public.harvest_events;

CREATE POLICY harvest_events_select ON public.harvest_events
  FOR SELECT TO authenticated
  USING (public.user_owns_tree(tree_id));

CREATE POLICY harvest_events_insert ON public.harvest_events
  FOR INSERT TO authenticated
  WITH CHECK (tree_id IS NOT NULL AND public.user_owns_tree(tree_id));

CREATE POLICY harvest_events_update ON public.harvest_events
  FOR UPDATE TO authenticated
  USING (public.user_owns_tree(tree_id))
  WITH CHECK (tree_id IS NOT NULL AND public.user_owns_tree(tree_id));

CREATE POLICY harvest_events_delete ON public.harvest_events
  FOR DELETE TO authenticated
  USING (public.user_owns_tree(tree_id));
