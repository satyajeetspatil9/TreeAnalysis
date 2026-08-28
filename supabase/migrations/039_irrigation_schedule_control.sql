-- =============================================================================
-- 039: Irrigation schedule control (devices, programs, jobs, command queue)
-- Run after 038_irrigation_zone_commands.sql
-- =============================================================================

-- Devices: valves, motors, fertigation injectors, other timed equipment
CREATE TABLE IF NOT EXISTS public.irrigation_devices (
  id BIGSERIAL PRIMARY KEY,
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  device_code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'zone_valve', 'irrigation_motor', 'bore_motor', 'fertigation', 'other'
  )),
  zone_id BIGINT REFERENCES public.irrigation_zones(id) ON DELETE SET NULL,
  pin_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT irrigation_devices_farm_code_unique UNIQUE (farm_id, device_code)
);

CREATE INDEX IF NOT EXISTS idx_irrigation_devices_farm
  ON public.irrigation_devices (farm_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_devices_kind
  ON public.irrigation_devices (farm_id, kind);

-- Allowed watering hours (weekday 0=Sunday … 6=Saturday, matches JS getDay())
CREATE TABLE IF NOT EXISTS public.irrigation_allowed_windows (
  id BIGSERIAL PRIMARY KEY,
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT irrigation_allowed_windows_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_irrigation_allowed_windows_farm
  ON public.irrigation_allowed_windows (farm_id, weekday);

-- Programs (GrIno programGroup) — water or fertigation
CREATE TABLE IF NOT EXISTS public.irrigation_programs (
  id BIGSERIAL PRIMARY KEY,
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  program_type TEXT NOT NULL DEFAULT 'water'
    CHECK (program_type IN ('water', 'fertigation')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  days_of_week SMALLINT[] NOT NULL DEFAULT '{}'::smallint[],
  start_times TIME[] NOT NULL DEFAULT '{}'::time[],
  use_allowed_windows BOOLEAN NOT NULL DEFAULT true,
  motor_device_ids BIGINT[] NOT NULL DEFAULT '{}'::bigint[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_irrigation_programs_farm
  ON public.irrigation_programs (farm_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_programs_active
  ON public.irrigation_programs (farm_id, is_active)
  WHERE is_active = true;

-- Sequenced zone steps (GrIno valveInstance)
CREATE TABLE IF NOT EXISTS public.irrigation_program_steps (
  id BIGSERIAL PRIMARY KEY,
  program_id BIGINT NOT NULL REFERENCES public.irrigation_programs(id) ON DELETE CASCADE,
  seq INT NOT NULL DEFAULT 0,
  zone_id BIGINT REFERENCES public.irrigation_zones(id) ON DELETE SET NULL,
  device_id BIGINT REFERENCES public.irrigation_devices(id) ON DELETE SET NULL,
  target_liters NUMERIC(12, 3),
  on_duration_minutes INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT irrigation_program_steps_program_seq UNIQUE (program_id, seq),
  CONSTRAINT irrigation_program_steps_has_target CHECK (
    target_liters IS NOT NULL OR on_duration_minutes IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_irrigation_program_steps_program
  ON public.irrigation_program_steps (program_id, seq);

-- Extra devices on a program (fertigation injectors, etc.)
CREATE TABLE IF NOT EXISTS public.irrigation_program_devices (
  id BIGSERIAL PRIMARY KEY,
  program_id BIGINT NOT NULL REFERENCES public.irrigation_programs(id) ON DELETE CASCADE,
  device_id BIGINT NOT NULL REFERENCES public.irrigation_devices(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'injector',
  target_liters NUMERIC(12, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT irrigation_program_devices_unique UNIQUE (program_id, device_id)
);

-- Runtime jobs (volume progress across days)
CREATE TABLE IF NOT EXISTS public.irrigation_jobs (
  id BIGSERIAL PRIMARY KEY,
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  program_id BIGINT REFERENCES public.irrigation_programs(id) ON DELETE SET NULL,
  program_step_id BIGINT REFERENCES public.irrigation_program_steps(id) ON DELETE SET NULL,
  zone_id BIGINT REFERENCES public.irrigation_zones(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL DEFAULT 'water'
    CHECK (job_type IN ('water', 'fertigation', 'manual', 'device_schedule')),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN (
      'planned', 'running', 'paused_outside_window', 'completed', 'cancelled'
    )),
  target_liters NUMERIC(12, 3),
  liters_delivered NUMERIC(12, 3) NOT NULL DEFAULT 0,
  liters_baseline NUMERIC(12, 3),
  current_step_seq INT NOT NULL DEFAULT 0,
  window_mode BOOLEAN NOT NULL DEFAULT true,
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_irrigation_jobs_farm_status
  ON public.irrigation_jobs (farm_id, status);
CREATE INDEX IF NOT EXISTS idx_irrigation_jobs_program
  ON public.irrigation_jobs (program_id)
  WHERE program_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.irrigation_job_devices (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES public.irrigation_jobs(id) ON DELETE CASCADE,
  device_id BIGINT NOT NULL REFERENCES public.irrigation_devices(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'injector',
  CONSTRAINT irrigation_job_devices_unique UNIQUE (job_id, device_id)
);

-- Pollable command queue for controller
CREATE TABLE IF NOT EXISTS public.irrigation_command_queue (
  id BIGSERIAL PRIMARY KEY,
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  device_code TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('start', 'stop')),
  job_id BIGINT REFERENCES public.irrigation_jobs(id) ON DELETE SET NULL,
  zone_id BIGINT REFERENCES public.irrigation_zones(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'acked', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_irrigation_command_queue_pending
  ON public.irrigation_command_queue (farm_id, status, created_at)
  WHERE status = 'pending';

-- Weekly start/stop for non-volume devices
CREATE TABLE IF NOT EXISTS public.irrigation_device_schedules (
  id BIGSERIAL PRIMARY KEY,
  farm_id BIGINT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  device_id BIGINT NOT NULL REFERENCES public.irrigation_devices(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  cyclic_on_minutes INT,
  cyclic_off_minutes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT irrigation_device_schedules_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_irrigation_device_schedules_farm
  ON public.irrigation_device_schedules (farm_id, weekday);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_allowed_windows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_programs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_program_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_program_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_job_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_command_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.irrigation_device_schedules TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER TABLE public.irrigation_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_allowed_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_program_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_program_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_job_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_command_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_device_schedules ENABLE ROW LEVEL SECURITY;

-- devices
DROP POLICY IF EXISTS irrigation_devices_select ON public.irrigation_devices;
CREATE POLICY irrigation_devices_select ON public.irrigation_devices
  FOR SELECT USING (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_devices_insert ON public.irrigation_devices;
CREATE POLICY irrigation_devices_insert ON public.irrigation_devices
  FOR INSERT WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_devices_update ON public.irrigation_devices;
CREATE POLICY irrigation_devices_update ON public.irrigation_devices
  FOR UPDATE USING (public.user_owns_farm(farm_id)) WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_devices_delete ON public.irrigation_devices;
CREATE POLICY irrigation_devices_delete ON public.irrigation_devices
  FOR DELETE USING (public.user_owns_farm(farm_id));

-- allowed windows
DROP POLICY IF EXISTS irrigation_allowed_windows_select ON public.irrigation_allowed_windows;
CREATE POLICY irrigation_allowed_windows_select ON public.irrigation_allowed_windows
  FOR SELECT USING (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_allowed_windows_insert ON public.irrigation_allowed_windows;
CREATE POLICY irrigation_allowed_windows_insert ON public.irrigation_allowed_windows
  FOR INSERT WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_allowed_windows_update ON public.irrigation_allowed_windows;
CREATE POLICY irrigation_allowed_windows_update ON public.irrigation_allowed_windows
  FOR UPDATE USING (public.user_owns_farm(farm_id)) WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_allowed_windows_delete ON public.irrigation_allowed_windows;
CREATE POLICY irrigation_allowed_windows_delete ON public.irrigation_allowed_windows
  FOR DELETE USING (public.user_owns_farm(farm_id));

-- programs
DROP POLICY IF EXISTS irrigation_programs_select ON public.irrigation_programs;
CREATE POLICY irrigation_programs_select ON public.irrigation_programs
  FOR SELECT USING (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_programs_insert ON public.irrigation_programs;
CREATE POLICY irrigation_programs_insert ON public.irrigation_programs
  FOR INSERT WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_programs_update ON public.irrigation_programs;
CREATE POLICY irrigation_programs_update ON public.irrigation_programs
  FOR UPDATE USING (public.user_owns_farm(farm_id)) WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_programs_delete ON public.irrigation_programs;
CREATE POLICY irrigation_programs_delete ON public.irrigation_programs
  FOR DELETE USING (public.user_owns_farm(farm_id));

-- program steps (via program ownership)
DROP POLICY IF EXISTS irrigation_program_steps_select ON public.irrigation_program_steps;
CREATE POLICY irrigation_program_steps_select ON public.irrigation_program_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );
DROP POLICY IF EXISTS irrigation_program_steps_insert ON public.irrigation_program_steps;
CREATE POLICY irrigation_program_steps_insert ON public.irrigation_program_steps
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );
DROP POLICY IF EXISTS irrigation_program_steps_update ON public.irrigation_program_steps;
CREATE POLICY irrigation_program_steps_update ON public.irrigation_program_steps
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
DROP POLICY IF EXISTS irrigation_program_steps_delete ON public.irrigation_program_steps;
CREATE POLICY irrigation_program_steps_delete ON public.irrigation_program_steps
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );

-- program devices
DROP POLICY IF EXISTS irrigation_program_devices_select ON public.irrigation_program_devices;
CREATE POLICY irrigation_program_devices_select ON public.irrigation_program_devices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );
DROP POLICY IF EXISTS irrigation_program_devices_insert ON public.irrigation_program_devices;
CREATE POLICY irrigation_program_devices_insert ON public.irrigation_program_devices
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );
DROP POLICY IF EXISTS irrigation_program_devices_update ON public.irrigation_program_devices;
CREATE POLICY irrigation_program_devices_update ON public.irrigation_program_devices
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
DROP POLICY IF EXISTS irrigation_program_devices_delete ON public.irrigation_program_devices;
CREATE POLICY irrigation_program_devices_delete ON public.irrigation_program_devices
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_programs p
      WHERE p.id = program_id AND public.user_owns_farm(p.farm_id)
    )
  );

-- jobs
DROP POLICY IF EXISTS irrigation_jobs_select ON public.irrigation_jobs;
CREATE POLICY irrigation_jobs_select ON public.irrigation_jobs
  FOR SELECT USING (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_jobs_insert ON public.irrigation_jobs;
CREATE POLICY irrigation_jobs_insert ON public.irrigation_jobs
  FOR INSERT WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_jobs_update ON public.irrigation_jobs;
CREATE POLICY irrigation_jobs_update ON public.irrigation_jobs
  FOR UPDATE USING (public.user_owns_farm(farm_id)) WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_jobs_delete ON public.irrigation_jobs;
CREATE POLICY irrigation_jobs_delete ON public.irrigation_jobs
  FOR DELETE USING (public.user_owns_farm(farm_id));

-- job devices
DROP POLICY IF EXISTS irrigation_job_devices_select ON public.irrigation_job_devices;
CREATE POLICY irrigation_job_devices_select ON public.irrigation_job_devices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_jobs j
      WHERE j.id = job_id AND public.user_owns_farm(j.farm_id)
    )
  );
DROP POLICY IF EXISTS irrigation_job_devices_insert ON public.irrigation_job_devices;
CREATE POLICY irrigation_job_devices_insert ON public.irrigation_job_devices
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.irrigation_jobs j
      WHERE j.id = job_id AND public.user_owns_farm(j.farm_id)
    )
  );
DROP POLICY IF EXISTS irrigation_job_devices_update ON public.irrigation_job_devices;
CREATE POLICY irrigation_job_devices_update ON public.irrigation_job_devices
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_jobs j
      WHERE j.id = job_id AND public.user_owns_farm(j.farm_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.irrigation_jobs j
      WHERE j.id = job_id AND public.user_owns_farm(j.farm_id)
    )
  );
DROP POLICY IF EXISTS irrigation_job_devices_delete ON public.irrigation_job_devices;
CREATE POLICY irrigation_job_devices_delete ON public.irrigation_job_devices
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.irrigation_jobs j
      WHERE j.id = job_id AND public.user_owns_farm(j.farm_id)
    )
  );

-- command queue
DROP POLICY IF EXISTS irrigation_command_queue_select ON public.irrigation_command_queue;
CREATE POLICY irrigation_command_queue_select ON public.irrigation_command_queue
  FOR SELECT USING (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_command_queue_insert ON public.irrigation_command_queue;
CREATE POLICY irrigation_command_queue_insert ON public.irrigation_command_queue
  FOR INSERT WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_command_queue_update ON public.irrigation_command_queue;
CREATE POLICY irrigation_command_queue_update ON public.irrigation_command_queue
  FOR UPDATE USING (public.user_owns_farm(farm_id)) WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_command_queue_delete ON public.irrigation_command_queue;
CREATE POLICY irrigation_command_queue_delete ON public.irrigation_command_queue
  FOR DELETE USING (public.user_owns_farm(farm_id));

-- device schedules
DROP POLICY IF EXISTS irrigation_device_schedules_select ON public.irrigation_device_schedules;
CREATE POLICY irrigation_device_schedules_select ON public.irrigation_device_schedules
  FOR SELECT USING (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_device_schedules_insert ON public.irrigation_device_schedules;
CREATE POLICY irrigation_device_schedules_insert ON public.irrigation_device_schedules
  FOR INSERT WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_device_schedules_update ON public.irrigation_device_schedules;
CREATE POLICY irrigation_device_schedules_update ON public.irrigation_device_schedules
  FOR UPDATE USING (public.user_owns_farm(farm_id)) WITH CHECK (public.user_owns_farm(farm_id));
DROP POLICY IF EXISTS irrigation_device_schedules_delete ON public.irrigation_device_schedules;
CREATE POLICY irrigation_device_schedules_delete ON public.irrigation_device_schedules
  FOR DELETE USING (public.user_owns_farm(farm_id));

COMMENT ON TABLE public.irrigation_devices IS
  'Physical irrigation devices (zone valves, motors, fertigation injectors, other).';
COMMENT ON TABLE public.irrigation_allowed_windows IS
  'Weekday hours when watering is allowed (e.g. Mon–Thu 06:00–14:00).';
COMMENT ON TABLE public.irrigation_programs IS
  'GrIno-style programs: days, start times, sequenced zone steps.';
COMMENT ON TABLE public.irrigation_jobs IS
  'Runtime volume jobs; may pause outside allowed windows and resume next day.';
COMMENT ON TABLE public.irrigation_command_queue IS
  'Pending start/stop commands polled by the irrigation controller.';
COMMENT ON TABLE public.irrigation_device_schedules IS
  'Weekly timed start/stop for non-volume devices (motors, other equipment).';
