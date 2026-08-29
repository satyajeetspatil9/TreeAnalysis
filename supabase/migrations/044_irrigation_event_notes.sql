-- Idempotent notes key for auto-logged watering (irrigation_job:{id}:seq:{n})
ALTER TABLE public.irrigation_events
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_irrigation_events_notes
  ON public.irrigation_events (notes)
  WHERE notes IS NOT NULL;
