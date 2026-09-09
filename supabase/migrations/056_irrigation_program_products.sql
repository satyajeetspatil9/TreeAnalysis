-- Fertilizer mix on a fertigation program. Copied onto fertigation_events when a job completes.

CREATE TABLE IF NOT EXISTS public.irrigation_program_products (
  id BIGSERIAL PRIMARY KEY,
  program_id BIGINT NOT NULL REFERENCES public.irrigation_programs(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
  unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT irrigation_program_products_unique UNIQUE (program_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_irrigation_program_products_program
  ON public.irrigation_program_products (program_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_program_products TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER TABLE public.irrigation_program_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS irrigation_program_products_select ON public.irrigation_program_products;
CREATE POLICY irrigation_program_products_select ON public.irrigation_program_products
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );

DROP POLICY IF EXISTS irrigation_program_products_insert ON public.irrigation_program_products;
CREATE POLICY irrigation_program_products_insert ON public.irrigation_program_products
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );

DROP POLICY IF EXISTS irrigation_program_products_update ON public.irrigation_program_products;
CREATE POLICY irrigation_program_products_update ON public.irrigation_program_products
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );

DROP POLICY IF EXISTS irrigation_program_products_delete ON public.irrigation_program_products;
CREATE POLICY irrigation_program_products_delete ON public.irrigation_program_products
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );

COMMENT ON TABLE public.irrigation_program_products IS
  'Fertilizer products mixed for a fertigation program. Applied to inventory when a completed job is recorded as a fertigation event.';
