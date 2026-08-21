-- =============================================================================
-- 016: Fix labour_events RLS (Finance → Labour)
-- Run in Supabase SQL Editor if inserts fail with row-level security errors.
-- Safe to re-run.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.labour_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.labour_events_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.user_owns_labour_scope(
  p_phase_id BIGINT,
  p_section_id BIGINT,
  p_row_id BIGINT,
  p_zone_id BIGINT,
  p_tree_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_tree_id IS NOT NULL THEN public.user_owns_tree(p_tree_id)
    WHEN p_zone_id IS NOT NULL THEN public.user_owns_zone(p_zone_id)
    WHEN p_row_id IS NOT NULL THEN public.user_owns_farm(public.farm_id_for_row(p_row_id))
    WHEN p_section_id IS NOT NULL THEN public.user_owns_farm(public.farm_id_for_section(p_section_id))
    WHEN p_phase_id IS NOT NULL THEN public.user_owns_farm((
      SELECT farm_id FROM public.phases WHERE id = p_phase_id
    ))
    ELSE true
  END;
$$;

ALTER TABLE public.labour_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS labour_all ON public.labour_events;
DROP POLICY IF EXISTS labour_events_all ON public.labour_events;
DROP POLICY IF EXISTS labour_events_select ON public.labour_events;
DROP POLICY IF EXISTS labour_events_insert ON public.labour_events;
DROP POLICY IF EXISTS labour_events_update ON public.labour_events;
DROP POLICY IF EXISTS labour_events_delete ON public.labour_events;

CREATE POLICY labour_events_select ON public.labour_events
  FOR SELECT TO authenticated
  USING (
    public.user_owns_labour_scope(phase_id, section_id, row_id, zone_id, tree_id)
  );

CREATE POLICY labour_events_insert ON public.labour_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_owns_labour_scope(phase_id, section_id, row_id, zone_id, tree_id)
  );

CREATE POLICY labour_events_update ON public.labour_events
  FOR UPDATE TO authenticated
  USING (
    public.user_owns_labour_scope(phase_id, section_id, row_id, zone_id, tree_id)
  )
  WITH CHECK (
    public.user_owns_labour_scope(phase_id, section_id, row_id, zone_id, tree_id)
  );

CREATE POLICY labour_events_delete ON public.labour_events
  FOR DELETE TO authenticated
  USING (
    public.user_owns_labour_scope(phase_id, section_id, row_id, zone_id, tree_id)
  );
