-- =============================================================================
-- 008: Fix irrigation RLS (zones, events, tree ↔ zone assignments)
-- Run in Supabase SQL Editor if you see RLS errors on:
--   irrigation_zones, irrigation_events, fertigation_events, tree_irrigation_zones
-- Safe to re-run (uses DROP POLICY IF EXISTS / CREATE OR REPLACE).
-- =============================================================================

-- Supabase-recommended: pin search_path on SECURITY DEFINER helpers
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

CREATE OR REPLACE FUNCTION public.farm_id_for_zone(p_zone_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT farm_id FROM public.irrigation_zones WHERE id = p_zone_id;
$$;

CREATE OR REPLACE FUNCTION public.user_owns_zone(p_zone_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.irrigation_zones iz
    JOIN public.farms f ON f.id = iz.farm_id
    WHERE iz.id = p_zone_id AND f.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.farm_id_for_phase(p_phase_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT farm_id FROM public.phases WHERE id = p_phase_id;
$$;

CREATE OR REPLACE FUNCTION public.farm_id_for_section(p_section_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.farm_id
  FROM public.sections s
  JOIN public.phases p ON p.id = s.phase_id
  WHERE s.id = p_section_id;
$$;

CREATE OR REPLACE FUNCTION public.farm_id_for_row(p_row_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ph.farm_id
  FROM public.rows r
  JOIN public.sections s ON s.id = r.section_id
  JOIN public.phases ph ON ph.id = s.phase_id
  WHERE r.id = p_row_id;
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

CREATE OR REPLACE FUNCTION public.tree_zone_same_farm(p_tree_id UUID, p_zone_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.farm_id_for_tree(p_tree_id) = (
    SELECT iz.farm_id FROM public.irrigation_zones iz WHERE iz.id = p_zone_id
  );
$$;

-- Allow claiming farms created before auth was wired (user_id was NULL)
DROP POLICY IF EXISTS farms_modify_own ON public.farms;
CREATE POLICY farms_modify_own ON public.farms
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL)
  WITH CHECK (user_id = auth.uid());

-- Explicit irrigation_zones policies (direct farms join, not only helper fn)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_zones TO authenticated;

ALTER TABLE public.irrigation_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS irrigation_zones_own ON public.irrigation_zones;
DROP POLICY IF EXISTS irrigation_zones_select ON public.irrigation_zones;
DROP POLICY IF EXISTS irrigation_zones_insert ON public.irrigation_zones;
DROP POLICY IF EXISTS irrigation_zones_update ON public.irrigation_zones;
DROP POLICY IF EXISTS irrigation_zones_delete ON public.irrigation_zones;

CREATE POLICY irrigation_zones_select ON public.irrigation_zones
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = irrigation_zones.farm_id AND f.user_id = auth.uid()
    )
  );

CREATE POLICY irrigation_zones_insert ON public.irrigation_zones
  FOR INSERT TO authenticated
  WITH CHECK (
    farm_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_id AND f.user_id = auth.uid()
    )
  );

CREATE POLICY irrigation_zones_update ON public.irrigation_zones
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = irrigation_zones.farm_id AND f.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_id AND f.user_id = auth.uid()
    )
  );

CREATE POLICY irrigation_zones_delete ON public.irrigation_zones
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = irrigation_zones.farm_id AND f.user_id = auth.uid()
    )
  );

-- tree_irrigation_zones: must own the tree AND zone on the same farm
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tree_irrigation_zones TO authenticated;

ALTER TABLE public.tree_irrigation_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tree_irrigation_zones_own ON public.tree_irrigation_zones;
DROP POLICY IF EXISTS tree_irrigation_zones_select ON public.tree_irrigation_zones;
DROP POLICY IF EXISTS tree_irrigation_zones_insert ON public.tree_irrigation_zones;
DROP POLICY IF EXISTS tree_irrigation_zones_update ON public.tree_irrigation_zones;
DROP POLICY IF EXISTS tree_irrigation_zones_delete ON public.tree_irrigation_zones;

CREATE POLICY tree_irrigation_zones_select ON public.tree_irrigation_zones
  FOR SELECT TO authenticated
  USING (public.user_owns_tree(tree_id));

CREATE POLICY tree_irrigation_zones_insert ON public.tree_irrigation_zones
  FOR INSERT TO authenticated
  WITH CHECK (
    tree_id IS NOT NULL
    AND zone_id IS NOT NULL
    AND public.user_owns_tree(tree_id)
    AND public.user_owns_zone(zone_id)
    AND public.tree_zone_same_farm(tree_id, zone_id)
  );

CREATE POLICY tree_irrigation_zones_update ON public.tree_irrigation_zones
  FOR UPDATE TO authenticated
  USING (public.user_owns_tree(tree_id))
  WITH CHECK (
    public.user_owns_tree(tree_id)
    AND public.user_owns_zone(zone_id)
    AND public.tree_zone_same_farm(tree_id, zone_id)
  );

CREATE POLICY tree_irrigation_zones_delete ON public.tree_irrigation_zones
  FOR DELETE TO authenticated
  USING (public.user_owns_tree(tree_id));

-- irrigation_events & fertigation (zone-scoped operational records)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fertigation_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fertigation_products TO authenticated;

ALTER TABLE public.irrigation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS irrigation_events_own ON public.irrigation_events;
DROP POLICY IF EXISTS irrigation_events_select ON public.irrigation_events;
DROP POLICY IF EXISTS irrigation_events_insert ON public.irrigation_events;
DROP POLICY IF EXISTS irrigation_events_update ON public.irrigation_events;
DROP POLICY IF EXISTS irrigation_events_delete ON public.irrigation_events;

CREATE POLICY irrigation_events_select ON public.irrigation_events
  FOR SELECT TO authenticated
  USING (public.user_owns_zone(zone_id));

CREATE POLICY irrigation_events_insert ON public.irrigation_events
  FOR INSERT TO authenticated
  WITH CHECK (
    zone_id IS NOT NULL
    AND public.user_owns_zone(zone_id)
  );

CREATE POLICY irrigation_events_update ON public.irrigation_events
  FOR UPDATE TO authenticated
  USING (public.user_owns_zone(zone_id))
  WITH CHECK (zone_id IS NOT NULL AND public.user_owns_zone(zone_id));

CREATE POLICY irrigation_events_delete ON public.irrigation_events
  FOR DELETE TO authenticated
  USING (public.user_owns_zone(zone_id));

ALTER TABLE public.fertigation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fertigation_events_own ON public.fertigation_events;
DROP POLICY IF EXISTS fertigation_events_select ON public.fertigation_events;
DROP POLICY IF EXISTS fertigation_events_insert ON public.fertigation_events;
DROP POLICY IF EXISTS fertigation_events_update ON public.fertigation_events;
DROP POLICY IF EXISTS fertigation_events_delete ON public.fertigation_events;

CREATE POLICY fertigation_events_select ON public.fertigation_events
  FOR SELECT TO authenticated
  USING (public.user_owns_zone(zone_id));

CREATE POLICY fertigation_events_insert ON public.fertigation_events
  FOR INSERT TO authenticated
  WITH CHECK (
    zone_id IS NOT NULL
    AND public.user_owns_zone(zone_id)
  );

CREATE POLICY fertigation_events_update ON public.fertigation_events
  FOR UPDATE TO authenticated
  USING (public.user_owns_zone(zone_id))
  WITH CHECK (zone_id IS NOT NULL AND public.user_owns_zone(zone_id));

CREATE POLICY fertigation_events_delete ON public.fertigation_events
  FOR DELETE TO authenticated
  USING (public.user_owns_zone(zone_id));

ALTER TABLE public.fertigation_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fertigation_products_own ON public.fertigation_products;
DROP POLICY IF EXISTS fertigation_products_select ON public.fertigation_products;
DROP POLICY IF EXISTS fertigation_products_insert ON public.fertigation_products;
DROP POLICY IF EXISTS fertigation_products_update ON public.fertigation_products;
DROP POLICY IF EXISTS fertigation_products_delete ON public.fertigation_products;

CREATE POLICY fertigation_products_select ON public.fertigation_products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.fertigation_events fe
      WHERE fe.id = fertigation_event_id AND public.user_owns_zone(fe.zone_id)
    )
  );

CREATE POLICY fertigation_products_insert ON public.fertigation_products
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.fertigation_events fe
      WHERE fe.id = fertigation_event_id AND public.user_owns_zone(fe.zone_id)
    )
  );

CREATE POLICY fertigation_products_update ON public.fertigation_products
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.fertigation_events fe
      WHERE fe.id = fertigation_event_id AND public.user_owns_zone(fe.zone_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.fertigation_events fe
      WHERE fe.id = fertigation_event_id AND public.user_owns_zone(fe.zone_id)
    )
  );

CREATE POLICY fertigation_products_delete ON public.fertigation_products
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.fertigation_events fe
      WHERE fe.id = fertigation_event_id AND public.user_owns_zone(fe.zone_id)
    )
  );
