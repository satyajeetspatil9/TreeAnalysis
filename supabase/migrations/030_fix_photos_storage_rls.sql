-- =============================================================================
-- 030: Fix tree-photos storage + photos RLS (Photos tab upload)
-- Run in Supabase SQL Editor. Safe to re-run.
-- Note: Do NOT ALTER/GRANT storage.objects — Supabase owns that table.
--       If CREATE POLICY on storage fails, use Dashboard → Storage → Policies
--       (see comments at bottom of this file).
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
  SELECT COALESCE(public.user_owns_farm(public.farm_id_for_tree(p_tree_id)), false);
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tree-photos', 'tree-photos', true, 10485760, NULL)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = NULL;

-- storage.objects RLS is enabled by default on Supabase; only add policies here.
DROP POLICY IF EXISTS tree_photos_bucket_public_read ON storage.buckets;
DROP POLICY IF EXISTS tree_photos_bucket_auth_read ON storage.buckets;
DROP POLICY IF EXISTS tree_photos_select ON storage.objects;
DROP POLICY IF EXISTS tree_photos_insert ON storage.objects;
DROP POLICY IF EXISTS tree_photos_update ON storage.objects;
DROP POLICY IF EXISTS tree_photos_delete ON storage.objects;
DROP POLICY IF EXISTS tree_photos_public_read ON storage.objects;
DROP POLICY IF EXISTS tree_photos_auth_select ON storage.objects;
DROP POLICY IF EXISTS tree_photos_auth_insert ON storage.objects;
DROP POLICY IF EXISTS tree_photos_auth_update ON storage.objects;
DROP POLICY IF EXISTS tree_photos_auth_delete ON storage.objects;
DROP POLICY IF EXISTS tree_photos_authenticated_all ON storage.objects;

CREATE POLICY tree_photos_bucket_public_read ON storage.buckets
  FOR SELECT TO public
  USING (id = 'tree-photos');

CREATE POLICY tree_photos_bucket_auth_read ON storage.buckets
  FOR SELECT TO authenticated
  USING (id = 'tree-photos');

-- Public read for image URLs in the gallery
CREATE POLICY tree_photos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'tree-photos');

-- Upload uses INSERT ... RETURNING *, so authenticated users need SELECT too (not just public).
CREATE POLICY tree_photos_authenticated_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'tree-photos')
  WITH CHECK (bucket_id = 'tree-photos');

-- Re-assert photos table policies with null-safe ownership helper
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photos TO authenticated;

ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photos_own ON public.photos;
DROP POLICY IF EXISTS photos_select ON public.photos;
DROP POLICY IF EXISTS photos_insert ON public.photos;
DROP POLICY IF EXISTS photos_update ON public.photos;
DROP POLICY IF EXISTS photos_delete ON public.photos;

CREATE POLICY photos_select ON public.photos
  FOR SELECT TO authenticated
  USING (public.user_owns_tree(tree_id));

CREATE POLICY photos_insert ON public.photos
  FOR INSERT TO authenticated
  WITH CHECK (tree_id IS NOT NULL AND public.user_owns_tree(tree_id));

CREATE POLICY photos_update ON public.photos
  FOR UPDATE TO authenticated
  USING (public.user_owns_tree(tree_id))
  WITH CHECK (tree_id IS NOT NULL AND public.user_owns_tree(tree_id));

CREATE POLICY photos_delete ON public.photos
  FOR DELETE TO authenticated
  USING (public.user_owns_tree(tree_id));

-- If CREATE POLICY on storage.* above failed with "must be owner of table objects",
-- add these in Supabase Dashboard → Storage → tree-photos → Policies:
--   1) SELECT for public:  bucket_id = 'tree-photos'
--   2) ALL for authenticated (SELECT+INSERT+UPDATE+DELETE):
--        bucket_id = 'tree-photos'  (USING and WITH CHECK)
-- Upload needs authenticated SELECT (INSERT ... RETURNING *), not INSERT alone.
