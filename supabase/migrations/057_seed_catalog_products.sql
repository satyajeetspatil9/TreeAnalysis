-- =============================================================================
-- 057: Seed analysed farm inputs into products (N, P2O5 as P, K2O as K, Ca, Mg, S, Zn, B).
-- Safe to re-run. Updates nutrient_composition when the product name already exists.
-- =============================================================================

INSERT INTO public.products (name, category, unit, nutrient_composition, active)
VALUES
  ('Poultry manure', 'Fertilizer', 'kg', '{"N":3.15,"P":2.77,"K":2.33,"Ca":2.5,"Mg":0.5,"S":0.3,"Zn":0.02,"B":0.003}'::jsonb, true),
  ('Neem cake', 'Fertilizer', 'kg', '{"N":5,"P":1,"K":1.5,"Ca":1.5,"Mg":0.5,"S":1,"Zn":0.005,"B":0.005}'::jsonb, true),
  ('Groundnut cake', 'Fertilizer', 'kg', '{"N":7.3,"P":1.5,"K":1.3,"Ca":1.5,"Mg":0.5,"S":0.5,"Zn":0.005,"B":0.005}'::jsonb, true),
  ('Bone meal', 'Fertilizer', 'kg', '{"N":3,"P":15,"K":0,"Ca":22,"Mg":0.5,"S":0,"Zn":0.01,"B":0}'::jsonb, true),
  ('Rock phosphate', 'Fertilizer', 'kg', '{"N":0,"P":30,"K":0,"Ca":30,"Mg":1,"S":0.5,"Zn":0.01,"B":0}'::jsonb, true),
  ('Wood ash', 'Fertilizer', 'kg', '{"N":0,"P":2,"K":6,"Ca":20,"Mg":1,"S":0.5,"Zn":0.02,"B":0.05}'::jsonb, true),
  ('Agricultural lime', 'Fertilizer', 'kg', '{"N":0,"P":0,"K":0,"Ca":38,"Mg":0,"S":0,"Zn":0,"B":0}'::jsonb, true),
  ('Gypsum', 'Fertilizer', 'kg', '{"N":0,"P":0,"K":0,"Ca":23,"Mg":0.3,"S":18,"Zn":0,"B":0}'::jsonb, true),
  ('Fish hydrolysate', 'Fertilizer', 'L', '{"N":2,"P":1.2,"K":0.2,"Ca":1,"Mg":0.1,"S":0.2,"Zn":0.01,"B":0}'::jsonb, true),
  ('Milk–Eggs–Jaggery', 'Fertilizer', 'L', '{"N":1,"P":0.5,"K":0.5,"Ca":1,"Mg":0.1,"S":0.1,"Zn":0.005,"B":0.002}'::jsonb, true),
  ('OWDC', 'Fertilizer', 'kg', '{"N":2,"P":1.5,"K":1.5,"Ca":2,"Mg":0.5,"S":0.3,"Zn":0.01,"B":0.003}'::jsonb, true),
  ('Jeevamrut', 'Fertilizer', 'L', '{"N":0.05,"P":0.02,"K":0.05,"Ca":0.02,"Mg":0.01,"S":0.01,"Zn":0.001,"B":0.001}'::jsonb, true),
  ('Vermiwash', 'Fertilizer', 'L', '{"N":0.5,"P":0.3,"K":0.4,"Ca":0.1,"Mg":0.05,"S":0.03,"Zn":0.002,"B":0.001}'::jsonb, true),
  ('Sulfur', 'Fertilizer', 'kg', '{"N":0,"P":0,"K":0,"Ca":0,"Mg":0,"S":95,"Zn":0,"B":0}'::jsonb, true),
  ('Magnesium sulfate', 'Fertilizer', 'kg', '{"N":0,"P":0,"K":0,"Ca":0,"Mg":9.8,"S":13,"Zn":0,"B":0}'::jsonb, true),
  ('Natural K minerals', 'Fertilizer', 'kg', '{"N":0,"P":0,"K":10,"Ca":2,"Mg":3,"S":0.5,"Zn":0.01,"B":0.005}'::jsonb, true),
  ('Zinc sulfate', 'Fertilizer', 'kg', '{"N":0,"P":0,"K":0,"Ca":0,"Mg":0,"S":15,"Zn":33,"B":0}'::jsonb, true),
  ('Borax', 'Fertilizer', 'kg', '{"N":0,"P":0,"K":0,"Ca":0,"Mg":0,"S":0,"Zn":0,"B":11}'::jsonb, true),
  ('VAM/AMF', 'Fertilizer', 'kg', '{"N":0,"P":0,"K":0,"Ca":0,"Mg":0,"S":0,"Zn":0,"B":0}'::jsonb, true),
  ('Rice water', 'Fertilizer', 'L', '{"N":0.1,"P":0.05,"K":0.05,"Ca":0.02,"Mg":0.01,"S":0.01,"Zn":0.001,"B":0.001}'::jsonb, true),
  ('Tender coconut water', 'Fertilizer', 'L', '{"N":0.05,"P":0.02,"K":0.2,"Ca":0.03,"Mg":0.02,"S":0.01,"Zn":0.001,"B":0.001}'::jsonb, true),
  ('Dashparni Ark', 'Plant Protection', 'L', '{"N":0.1,"P":0.05,"K":0.1,"Ca":0.05,"Mg":0.02,"S":0.02,"Zn":0.001,"B":0.001}'::jsonb, true),
  ('AgniAstra', 'Plant Protection', 'L', '{"N":0.05,"P":0.02,"K":0.05,"Ca":0.02,"Mg":0.01,"S":0.01,"Zn":0.001,"B":0.001}'::jsonb, true),
  ('OWDC + micronutrients', 'Fertilizer', 'kg', '{"N":2,"P":1.5,"K":1.5,"Ca":2,"Mg":0.5,"S":0.3,"Zn":0.5,"B":0.1}'::jsonb, true)
ON CONFLICT (name) DO UPDATE
SET
  nutrient_composition = EXCLUDED.nutrient_composition,
  active = true;
