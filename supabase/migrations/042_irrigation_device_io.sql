-- Controller wiring for irrigation devices: which terminal the device sits on.
-- Inputs are read-only sense lines (X0–X8); outputs are driven relays (Y0–Y8).

ALTER TABLE public.irrigation_devices
  ADD COLUMN IF NOT EXISTS io_type TEXT
    CHECK (io_type IS NULL OR io_type IN ('input', 'output'));

-- Existing rows were all driven equipment (motors, valves, injectors).
UPDATE public.irrigation_devices
SET io_type = 'output'
WHERE io_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_irrigation_devices_io
  ON public.irrigation_devices (farm_id, io_type);

COMMENT ON COLUMN public.irrigation_devices.io_type IS
  'Controller terminal direction: input (X0–X8 sense lines) or output (Y0–Y8 driven relays).';
