-- =============================================================================
-- 051: Production loop — GDD season, phenology, climate work items RLS
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS gdd_season_start DATE;

CREATE TABLE IF NOT EXISTS public.flowering_events (
  id BIGSERIAL PRIMARY KEY,
  tree_id UUID NOT NULL REFERENCES public.trees(id) ON DELETE CASCADE,
  observed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  gdd_total NUMERIC(12,1),
  growth_stage TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fruit_set_observations (
  id BIGSERIAL PRIMARY KEY,
  tree_id UUID NOT NULL REFERENCES public.trees(id) ON DELETE CASCADE,
  observed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  fruit_count INTEGER,
  notes TEXT,
  gdd_total NUMERIC(12,1),
  growth_stage TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flowering_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fruit_set_observations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.flowering_events_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.fruit_set_observations_id_seq TO authenticated;

ALTER TABLE public.flowering_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fruit_set_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flowering_events_select ON public.flowering_events;
DROP POLICY IF EXISTS flowering_events_insert ON public.flowering_events;
DROP POLICY IF EXISTS flowering_events_update ON public.flowering_events;
DROP POLICY IF EXISTS flowering_events_delete ON public.flowering_events;

CREATE POLICY flowering_events_select ON public.flowering_events
  FOR SELECT TO authenticated
  USING (public.user_owns_tree(tree_id));
CREATE POLICY flowering_events_insert ON public.flowering_events
  FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_tree(tree_id));
CREATE POLICY flowering_events_update ON public.flowering_events
  FOR UPDATE TO authenticated
  USING (public.user_owns_tree(tree_id))
  WITH CHECK (public.user_owns_tree(tree_id));
CREATE POLICY flowering_events_delete ON public.flowering_events
  FOR DELETE TO authenticated
  USING (public.user_owns_tree(tree_id));

DROP POLICY IF EXISTS fruit_set_observations_select ON public.fruit_set_observations;
DROP POLICY IF EXISTS fruit_set_observations_insert ON public.fruit_set_observations;
DROP POLICY IF EXISTS fruit_set_observations_update ON public.fruit_set_observations;
DROP POLICY IF EXISTS fruit_set_observations_delete ON public.fruit_set_observations;

CREATE POLICY fruit_set_observations_select ON public.fruit_set_observations
  FOR SELECT TO authenticated
  USING (public.user_owns_tree(tree_id));
CREATE POLICY fruit_set_observations_insert ON public.fruit_set_observations
  FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_tree(tree_id));
CREATE POLICY fruit_set_observations_update ON public.fruit_set_observations
  FOR UPDATE TO authenticated
  USING (public.user_owns_tree(tree_id))
  WITH CHECK (public.user_owns_tree(tree_id));
CREATE POLICY fruit_set_observations_delete ON public.fruit_set_observations
  FOR DELETE TO authenticated
  USING (public.user_owns_tree(tree_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recommendations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.recommendations_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fertilizer_recommendations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.fertilizer_recommendations_id_seq TO authenticated;

ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fertilizer_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recommendations_select ON public.recommendations;
DROP POLICY IF EXISTS recommendations_insert ON public.recommendations;
DROP POLICY IF EXISTS recommendations_update ON public.recommendations;
DROP POLICY IF EXISTS recommendations_delete ON public.recommendations;

CREATE POLICY recommendations_select ON public.recommendations
  FOR SELECT TO authenticated
  USING (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (zone_id IS NOT NULL AND public.user_owns_zone(zone_id))
  );
CREATE POLICY recommendations_insert ON public.recommendations
  FOR INSERT TO authenticated
  WITH CHECK (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (zone_id IS NOT NULL AND public.user_owns_zone(zone_id))
  );
CREATE POLICY recommendations_update ON public.recommendations
  FOR UPDATE TO authenticated
  USING (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (zone_id IS NOT NULL AND public.user_owns_zone(zone_id))
  );
CREATE POLICY recommendations_delete ON public.recommendations
  FOR DELETE TO authenticated
  USING (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (zone_id IS NOT NULL AND public.user_owns_zone(zone_id))
  );

DROP POLICY IF EXISTS fertilizer_recommendations_select ON public.fertilizer_recommendations;
DROP POLICY IF EXISTS fertilizer_recommendations_insert ON public.fertilizer_recommendations;
DROP POLICY IF EXISTS fertilizer_recommendations_update ON public.fertilizer_recommendations;
DROP POLICY IF EXISTS fertilizer_recommendations_delete ON public.fertilizer_recommendations;

CREATE POLICY fertilizer_recommendations_select ON public.fertilizer_recommendations
  FOR SELECT TO authenticated
  USING (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (soil_zone_id IS NOT NULL AND public.user_owns_farm(
      (SELECT farm_id FROM public.soil_zones WHERE id = soil_zone_id)
    ))
  );
CREATE POLICY fertilizer_recommendations_insert ON public.fertilizer_recommendations
  FOR INSERT TO authenticated
  WITH CHECK (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (soil_zone_id IS NOT NULL AND public.user_owns_farm(
      (SELECT farm_id FROM public.soil_zones WHERE id = soil_zone_id)
    ))
  );
CREATE POLICY fertilizer_recommendations_update ON public.fertilizer_recommendations
  FOR UPDATE TO authenticated
  USING (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (soil_zone_id IS NOT NULL AND public.user_owns_farm(
      (SELECT farm_id FROM public.soil_zones WHERE id = soil_zone_id)
    ))
  );
CREATE POLICY fertilizer_recommendations_delete ON public.fertilizer_recommendations
  FOR DELETE TO authenticated
  USING (
    (tree_id IS NOT NULL AND public.user_owns_tree(tree_id))
    OR (soil_zone_id IS NOT NULL AND public.user_owns_farm(
      (SELECT farm_id FROM public.soil_zones WHERE id = soil_zone_id)
    ))
  );
