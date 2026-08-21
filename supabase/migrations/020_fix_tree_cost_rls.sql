-- =============================================================================
-- 020: Fix tree cost reads (expense_allocations + expenses GRANT/RLS)
-- Run in Supabase SQL Editor if Tree Dashboard Cost tab is empty. Safe to re-run.
-- =============================================================================

GRANT SELECT ON public.expenses TO authenticated;
GRANT SELECT ON public.expense_allocations TO authenticated;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expenses_all ON public.expenses;
DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS expense_allocations_all ON public.expense_allocations;
DROP POLICY IF EXISTS expense_allocations_select ON public.expense_allocations;
CREATE POLICY expense_allocations_select ON public.expense_allocations
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS expense_allocations_insert ON public.expense_allocations;
CREATE POLICY expense_allocations_insert ON public.expense_allocations
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS expense_allocations_update ON public.expense_allocations;
CREATE POLICY expense_allocations_update ON public.expense_allocations
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS expense_allocations_delete ON public.expense_allocations;
CREATE POLICY expense_allocations_delete ON public.expense_allocations
  FOR DELETE TO authenticated
  USING (true);

CREATE OR REPLACE VIEW public.tree_cost_summary AS
SELECT
  ea.tree_id,
  e.category,
  SUM(ea.allocation_amount) AS total_amount
FROM public.expense_allocations ea
JOIN public.expenses e ON e.id = ea.expense_id
WHERE ea.tree_id IS NOT NULL
GROUP BY ea.tree_id, e.category;

GRANT SELECT ON public.tree_cost_summary TO authenticated;
