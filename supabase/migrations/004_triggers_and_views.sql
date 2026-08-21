-- =============================================================================
-- 004: Inventory triggers, fertigation/spray → expense chains, cost views
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_inventory_from_transaction()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inventory (product_id, current_stock, last_updated)
  VALUES (NEW.product_id, 0, now())
  ON CONFLICT (product_id) DO NOTHING;

  IF NEW.transaction_type = 'PURCHASE' OR NEW.transaction_type = 'RETURN' THEN
    UPDATE inventory
    SET current_stock = current_stock + ABS(NEW.quantity), last_updated = now()
    WHERE product_id = NEW.product_id;
  ELSIF NEW.transaction_type IN ('FERTIGATION_USE', 'SPRAY_USE', 'ADJUSTMENT') THEN
    UPDATE inventory
    SET current_stock = current_stock - ABS(NEW.quantity), last_updated = now()
    WHERE product_id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_inventory ON inventory_transactions;
CREATE TRIGGER trg_sync_inventory
  AFTER INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION sync_inventory_from_transaction();

CREATE OR REPLACE FUNCTION allocate_expense_to_trees()
RETURNS TRIGGER AS $$
DECLARE
  v_tree_count INT;
  v_per_tree NUMERIC(14,2);
  rec RECORD;
BEGIN
  IF NEW.notes LIKE 'fertigation_event:%' OR NEW.notes LIKE 'spray_event:%' THEN
    RETURN NEW;
  END IF;

  IF NEW.notes LIKE 'zone:%' THEN
    DECLARE v_zone_id BIGINT := split_part(NEW.notes, ':', 2)::BIGINT;
    BEGIN
      SELECT COUNT(*) INTO v_tree_count
      FROM tree_irrigation_zones tiz
      JOIN trees t ON t.id = tiz.tree_id
      WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active';

      IF v_tree_count > 0 THEN
        v_per_tree := NEW.amount / v_tree_count;
        FOR rec IN
          SELECT tiz.tree_id FROM tree_irrigation_zones tiz
          JOIN trees t ON t.id = tiz.tree_id
          WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active'
        LOOP
          INSERT INTO expense_allocations (expense_id, tree_id, zone_id, allocation_method, allocation_amount)
          VALUES (NEW.id, rec.tree_id, v_zone_id, 'BY_TREE_COUNT', v_per_tree);
        END LOOP;
      END IF;
    END;
  ELSIF NEW.notes LIKE 'tree:%' THEN
    INSERT INTO expense_allocations (expense_id, tree_id, allocation_method, allocation_amount)
    VALUES (NEW.id, split_part(NEW.notes, ':', 2)::UUID, 'DIRECT', NEW.amount);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocate_expense ON expenses;
CREATE TRIGGER trg_allocate_expense
  AFTER INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION allocate_expense_to_trees();

CREATE OR REPLACE FUNCTION process_fertigation_product()
RETURNS TRIGGER AS $$
DECLARE
  v_zone_id BIGINT;
  v_event_date DATE;
  v_total NUMERIC(14,2);
  v_expense_id BIGINT;
  v_tree_count INT;
  v_per_tree NUMERIC(14,2);
  v_unit_cost NUMERIC(12,2);
  rec RECORD;
BEGIN
  SELECT p.default_unit_cost INTO v_unit_cost FROM products p WHERE p.id = NEW.product_id;

  INSERT INTO inventory_transactions (
    product_id, transaction_type, quantity, unit_cost, total_cost, reference, notes
  ) VALUES (
    NEW.product_id, 'FERTIGATION_USE', NEW.quantity, v_unit_cost,
    NEW.quantity * COALESCE(v_unit_cost, 0),
    'fertigation:' || NEW.fertigation_event_id,
    'Auto-deducted from fertigation'
  );

  SELECT fe.zone_id, fe.event_date INTO v_zone_id, v_event_date
  FROM fertigation_events fe WHERE fe.id = NEW.fertigation_event_id;

  SELECT COALESCE(SUM(fp.quantity * COALESCE(p.default_unit_cost, 0)), 0) INTO v_total
  FROM fertigation_products fp
  JOIN products p ON p.id = fp.product_id
  WHERE fp.fertigation_event_id = NEW.fertigation_event_id;

  SELECT id INTO v_expense_id FROM expenses
  WHERE notes = 'fertigation_event:' || NEW.fertigation_event_id::TEXT LIMIT 1;

  IF v_expense_id IS NULL THEN
    INSERT INTO expenses (expense_date, category, description, amount, expense_type, notes)
    VALUES (
      v_event_date, 'Fertilizer',
      'Fertigation - Zone ' || (SELECT zone_code FROM irrigation_zones WHERE id = v_zone_id),
      v_total, 'OPEX', 'fertigation_event:' || NEW.fertigation_event_id
    ) RETURNING id INTO v_expense_id;
  ELSE
    UPDATE expenses SET amount = v_total, expense_date = v_event_date WHERE id = v_expense_id;
    DELETE FROM expense_allocations WHERE expense_id = v_expense_id;
  END IF;

  SELECT COUNT(*) INTO v_tree_count
  FROM tree_irrigation_zones tiz
  JOIN trees t ON t.id = tiz.tree_id
  WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active';

  IF v_tree_count > 0 THEN
    v_per_tree := v_total / v_tree_count;
    FOR rec IN
      SELECT tiz.tree_id FROM tree_irrigation_zones tiz
      JOIN trees t ON t.id = tiz.tree_id
      WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active'
    LOOP
      INSERT INTO expense_allocations (expense_id, tree_id, zone_id, allocation_method, allocation_amount)
      VALUES (v_expense_id, rec.tree_id, v_zone_id, 'BY_TREE_COUNT', v_per_tree);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fertigation_product ON fertigation_products;
CREATE TRIGGER trg_fertigation_product
  AFTER INSERT ON fertigation_products
  FOR EACH ROW EXECUTE FUNCTION process_fertigation_product();

CREATE OR REPLACE FUNCTION process_spray_product()
RETURNS TRIGGER AS $$
DECLARE
  v_zone_id BIGINT;
  v_event_date DATE;
  v_total NUMERIC(14,2);
  v_expense_id BIGINT;
  v_tree_count INT;
  v_per_tree NUMERIC(14,2);
  v_unit_cost NUMERIC(12,2);
  rec RECORD;
BEGIN
  SELECT p.default_unit_cost INTO v_unit_cost FROM products p WHERE p.id = NEW.product_id;

  INSERT INTO inventory_transactions (
    product_id, transaction_type, quantity, unit_cost, total_cost, reference, notes
  ) VALUES (
    NEW.product_id, 'SPRAY_USE', NEW.quantity, v_unit_cost,
    NEW.quantity * COALESCE(v_unit_cost, 0),
    'spray:' || NEW.spray_event_id,
    'Auto-deducted from spray event'
  );

  SELECT se.zone_id, se.event_date INTO v_zone_id, v_event_date
  FROM spray_events se WHERE se.id = NEW.spray_event_id;

  SELECT COALESCE(SUM(sp.quantity * COALESCE(p.default_unit_cost, 0)), 0) INTO v_total
  FROM spray_products sp
  JOIN products p ON p.id = sp.product_id
  WHERE sp.spray_event_id = NEW.spray_event_id;

  SELECT id INTO v_expense_id FROM expenses
  WHERE notes = 'spray_event:' || NEW.spray_event_id::TEXT LIMIT 1;

  IF v_expense_id IS NULL THEN
    INSERT INTO expenses (expense_date, category, description, amount, expense_type, notes)
    VALUES (
      v_event_date, 'Plant protection',
      'Spray - ' || COALESCE((SELECT purpose FROM spray_events WHERE id = NEW.spray_event_id), 'Application'),
      v_total, 'OPEX', 'spray_event:' || NEW.spray_event_id
    ) RETURNING id INTO v_expense_id;
  ELSE
    UPDATE expenses SET amount = v_total WHERE id = v_expense_id;
    DELETE FROM expense_allocations WHERE expense_id = v_expense_id;
  END IF;

  IF v_zone_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_tree_count
    FROM tree_irrigation_zones tiz
    JOIN trees t ON t.id = tiz.tree_id
    WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active';

    IF v_tree_count > 0 THEN
      v_per_tree := v_total / v_tree_count;
      FOR rec IN
        SELECT tiz.tree_id FROM tree_irrigation_zones tiz
        JOIN trees t ON t.id = tiz.tree_id
        WHERE tiz.zone_id = v_zone_id AND tiz.end_date IS NULL AND t.status = 'Active'
      LOOP
        INSERT INTO expense_allocations (expense_id, tree_id, zone_id, allocation_method, allocation_amount)
        VALUES (v_expense_id, rec.tree_id, v_zone_id, 'BY_TREE_COUNT', v_per_tree);
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_spray_product ON spray_products;
CREATE TRIGGER trg_spray_product
  AFTER INSERT ON spray_products
  FOR EACH ROW EXECUTE FUNCTION process_spray_product();

CREATE OR REPLACE VIEW tree_cost_summary AS
SELECT
  ea.tree_id,
  e.category,
  SUM(ea.allocation_amount) AS total_amount
FROM expense_allocations ea
JOIN expenses e ON e.id = ea.expense_id
WHERE ea.tree_id IS NOT NULL
GROUP BY ea.tree_id, e.category;

CREATE OR REPLACE VIEW farm_cost_summary AS
SELECT
  farm_id_for_tree(ea.tree_id) AS farm_id,
  e.category,
  e.expense_type,
  SUM(ea.allocation_amount) AS total_amount
FROM expense_allocations ea
JOIN expenses e ON e.id = ea.expense_id
WHERE ea.tree_id IS NOT NULL
GROUP BY farm_id_for_tree(ea.tree_id), e.category, e.expense_type;
