-- =============================================================================
-- 034: Lot ids for a farm (public add-tree bootstrap)
-- Requires farm_id_for_lot from migration 010.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lot_ids_for_farm(p_farm_id BIGINT)
RETURNS BIGINT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(l.id), '{}')
  FROM public.lots l
  WHERE public.farm_id_for_lot(l.id) = p_farm_id;
$$;

GRANT EXECUTE ON FUNCTION public.lot_ids_for_farm(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.farm_id_for_lot(BIGINT) TO service_role;
