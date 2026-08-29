import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FARM_TZ = 'Asia/Kolkata';

/** A program fires only within this many minutes of a listed start time. */
const START_GRACE_MINUTES = 15;
/** Queue rows the controller never picks up are dropped after this long. */
const COMMAND_TTL_MINUTES = 30;
/** Liter targets with no metering get a run-time cap of estimate x this. */
const LITERS_CAP_SAFETY = 1.5;

const OPEN_STATUSES = ['planned', 'running', 'paused_outside_window', 'paused_no_power'];
const TERMINAL_PATTERN = /^[XY]\d+$/;

type Supabase = ReturnType<typeof createClient>;
type Action = 'start' | 'stop';

type QueueRow = {
  id: number;
  device_code: string | null;
  action: string;
  status: string;
  job_id: number | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type Job = Record<string, any>;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function partsInTz(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    weekday: weekdayMap[map.weekday] ?? 0,
    dateKey: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${map.hour}:${map.minute}:${map.second}`,
    hhmm: `${map.hour}:${map.minute}`,
  };
}

function timeToMinutes(time: unknown) {
  const [h, m, s] = String(time ?? '').split(':').map((v) => Number(v) || 0);
  return h * 60 + m + (s || 0) / 60;
}

function minutesToClock(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeCode(code: unknown) {
  const text = String(code ?? '').trim().toUpperCase();
  return text || null;
}

/** Only real controller terminals (X0–X8 inputs, Y0–Y8 outputs) may be commanded. */
function isTerminal(code: string | null): code is string {
  return Boolean(code && TERMINAL_PATTERN.test(code));
}

function uniqueTerminals(codes: Array<unknown>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of codes) {
    const code = normalizeCode(raw);
    if (!isTerminal(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/** Older builds packed several pins into one row; read them all back. */
function codesFromQueueRow(row: QueueRow) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const packed = Array.isArray(payload.device_codes) ? payload.device_codes : [];
  return uniqueTerminals([...packed, row.device_code]);
}

// ---------------------------------------------------------------------------
// Command batching: every write is collected and flushed once per farm
// ---------------------------------------------------------------------------

type Until = { liters?: number; minutes?: number };

class CommandBatch {
  private inserts: Record<string, unknown>[] = [];
  private cancelIds = new Set<number>();
  /** `${action}|${code}` already pending in the queue or queued during this run. */
  private queued = new Set<string>();
  private pendingByCode = new Map<string, QueueRow[]>();

  constructor(
    private farmId: number,
    private now: Date,
    pending: QueueRow[],
  ) {
    for (const row of pending) {
      for (const code of codesFromQueueRow(row)) {
        this.queued.add(`${row.action}|${code}`);
        const list = this.pendingByCode.get(code) || [];
        list.push(row);
        this.pendingByCode.set(code, list);
      }
    }
  }

  hasPending(code: string, action: Action) {
    return this.queued.has(`${action}|${code}`);
  }

  add(
    code: string,
    action: Action,
    opts: {
      jobId?: number | null;
      zoneId?: number | null;
      until?: Until | null;
      reason?: string;
      role?: string;
    } = {},
  ) {
    if (!isTerminal(code)) return false;
    if (this.hasPending(code, action)) return false;

    const payload: Record<string, unknown> = { device_codes: [code] };
    if (opts.until && (opts.until.liters != null || opts.until.minutes != null)) {
      payload.until = opts.until;
    }
    if (opts.reason) payload.reason = opts.reason;
    if (opts.role) payload.role = opts.role;

    this.inserts.push({
      farm_id: this.farmId,
      device_code: code,
      action,
      job_id: opts.jobId ?? null,
      zone_id: opts.zoneId ?? null,
      payload,
      status: 'pending',
      created_at: this.now.toISOString(),
      expires_at: new Date(this.now.getTime() + COMMAND_TTL_MINUTES * 60 * 1000).toISOString(),
    });
    this.queued.add(`${action}|${code}`);
    return true;
  }

  /** Drop pending rows for these pins so a stale start cannot fight a stop. */
  cancelFor(codes: string[], action?: Action) {
    for (const code of codes) {
      for (const row of this.pendingByCode.get(code) || []) {
        if (action && row.action !== action) continue;
        this.cancelIds.add(row.id);
        this.queued.delete(`${row.action}|${code}`);
      }
    }
  }

  get writeCount() {
    return this.inserts.length + (this.cancelIds.size ? 1 : 0);
  }

  async flush(supabase: Supabase) {
    if (this.cancelIds.size) {
      await supabase
        .from('irrigation_command_queue')
        .update({ status: 'cancelled' })
        .in('id', [...this.cancelIds]);
    }
    if (this.inserts.length) {
      await supabase.from('irrigation_command_queue').insert(this.inserts);
    }
    return { inserted: this.inserts.length, cancelled: this.cancelIds.size };
  }
}

// ---------------------------------------------------------------------------
// Job helpers
// ---------------------------------------------------------------------------

function activeStepsOf(steps: Job[], programId: number) {
  return steps
    .filter((s) => Number(s.program_id) === Number(programId) && s.is_active !== false)
    .sort((a, b) => Number(a.seq) - Number(b.seq));
}

/**
 * Run-time cap in minutes. Uses the step's own duration when set, otherwise an
 * estimate from liters and zone flow with headroom. Without this a liter target
 * that never arrives keeps the job open forever.
 */
function capMinutesFor(step: Job, zone: { flow_rate_lph?: number | null } | undefined) {
  const explicit = Number(step?.on_duration_minutes);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);

  const liters = Number(step?.target_liters);
  const flow = zone?.flow_rate_lph != null ? Number(zone.flow_rate_lph) : null;
  if (liters > 0 && flow && flow > 0) {
    return Math.max(1, Math.ceil((liters / flow) * 60 * LITERS_CAP_SAFETY));
  }
  return null;
}

/** Minutes the job has actually been switched on, including the current stretch. */
function elapsedMinutes(job: Job, now: Date) {
  const banked = Number(job.duration_elapsed_minutes) || 0;
  if (job.status !== 'running' || !job.started_at) return banked;
  const since = (now.getTime() - new Date(String(job.started_at)).getTime()) / 60000;
  return banked + Math.max(0, since);
}

function stepFieldsFor(step: Job, isFertigation: boolean, zone: Job | undefined) {
  const cap = capMinutesFor(step, zone);
  const duration = Number(step?.on_duration_minutes);
  return {
    program_step_id: step.id,
    zone_id: step.zone_id,
    current_step_seq: Number(step.seq) || 0,
    target_liters: isFertigation ? null : (step.target_liters != null ? Number(step.target_liters) : null),
    on_duration_minutes: isFertigation && Number.isFinite(duration) && duration > 0
      ? Math.round(duration)
      : null,
    max_duration_minutes: cap,
  };
}

// ---------------------------------------------------------------------------
// Main per-farm pass
// ---------------------------------------------------------------------------

async function processFarm(supabase: Supabase, farmId: number, now: Date) {
  const local = partsInTz(now, FARM_TZ);
  const nowMin = timeToMinutes(local.timeStr);
  const dayStart = `${local.dateKey}T00:00:00+05:30`;
  const dayEnd = `${local.dateKey}T23:59:59+05:30`;
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const actions: string[] = [];

  // One round of reads for everything this pass can possibly need.
  const [
    { data: windows },
    { data: programs },
    { data: openJobs },
    { data: devices },
    { data: zones },
    { data: schedules },
    { data: statusRows },
    { data: powerRows },
    { data: recentQueue },
    { data: todayProgramJobs },
    { data: steps },
    { data: programDevices },
    { data: jobDevices },
  ] = await Promise.all([
    supabase.from('irrigation_allowed_windows').select('weekday, start_time, end_time, enabled')
      .eq('farm_id', farmId),
    supabase.from('irrigation_programs').select('*').eq('farm_id', farmId).eq('is_active', true),
    supabase.from('irrigation_jobs').select('*').eq('farm_id', farmId).in('status', OPEN_STATUSES),
    supabase.from('irrigation_devices').select('id, device_code, kind, zone_id, is_active')
      .eq('farm_id', farmId).eq('is_active', true),
    supabase.from('irrigation_zones').select('id, zone_code, flow_rate_lph').eq('farm_id', farmId),
    supabase.from('irrigation_device_schedules').select('*, irrigation_devices(device_code)')
      .eq('farm_id', farmId).eq('enabled', true),
    supabase.from('irrigation_zone_status')
      .select('zone_id, total_discharge_liters, is_irrigating, pending_command')
      .eq('farm_id', farmId),
    supabase.from('irrigation_power_status').select('*').eq('farm_id', farmId).limit(1),
    supabase.from('irrigation_command_queue')
      .select('id, device_code, action, status, job_id, payload, created_at')
      .eq('farm_id', farmId).in('status', ['pending', 'acked']).gte('created_at', since24h)
      .order('created_at', { ascending: false }),
    supabase.from('irrigation_jobs').select('id, program_id, status, scheduled_for')
      .eq('farm_id', farmId).not('program_id', 'is', null)
      .gte('scheduled_for', dayStart).lte('scheduled_for', dayEnd),
    supabase.from('irrigation_program_steps').select('*, irrigation_programs!inner(farm_id)')
      .eq('irrigation_programs.farm_id', farmId),
    supabase.from('irrigation_program_devices').select('*, irrigation_programs!inner(farm_id)')
      .eq('irrigation_programs.farm_id', farmId),
    supabase.from('irrigation_job_devices').select('*, irrigation_jobs!inner(farm_id)')
      .eq('irrigation_jobs.farm_id', farmId),
  ]);

  const zonesById = new Map((zones || []).map((z) => [Number(z.id), z]));
  const devicesById = new Map((devices || []).map((d) => [Number(d.id), d]));
  const statusByZone = new Map((statusRows || []).map((s) => [Number(s.zone_id), s]));

  const pendingQueue = (recentQueue || []).filter((r) => r.status === 'pending') as QueueRow[];
  const batch = new CommandBatch(farmId, now, pendingQueue);

  // Power: no row at all means the controller has never reported, so assume mains
  // is on and behave exactly as before.
  const power = powerRows?.[0] || null;
  const powerPresent = power ? power.power_present !== false : true;
  const powerChangedAt = power?.changed_at ? new Date(String(power.changed_at)) : null;

  // A pin is believed on only if its last acked command was a start that
  // survived the most recent power transition.
  const lastAckedByCode = new Map<string, QueueRow>();
  for (const row of (recentQueue || []) as QueueRow[]) {
    if (row.status !== 'acked') continue;
    for (const code of codesFromQueueRow(row)) {
      if (!lastAckedByCode.has(code)) lastAckedByCode.set(code, row);
    }
  }
  const believedOn = (code: string) => {
    const last = lastAckedByCode.get(code);
    if (!last || last.action !== 'start') return false;
    if (powerChangedAt && new Date(last.created_at) < powerChangedAt) return false;
    return true;
  };

  const windowsToday = (windows || []).filter(
    (w) => w.enabled !== false && Number(w.weekday) === local.weekday,
  );
  const inWindow = windowsToday.some(
    (w) => nowMin >= timeToMinutes(w.start_time) && nowMin < timeToMinutes(w.end_time),
  );

  const jobPatches = new Map<number, Record<string, unknown>>();
  const patchJob = (job: Job, patch: Record<string, unknown>) => {
    const merged = { ...(jobPatches.get(Number(job.id)) || {}), ...patch, updated_at: now.toISOString() };
    jobPatches.set(Number(job.id), merged);
    Object.assign(job, patch);
  };

  const zonePendingPatches = new Map<number, string>();

  // -------------------------------------------------------------------------
  // Terminals for a job: zone valve + linked devices + program motors
  // -------------------------------------------------------------------------
  const devicesForJob = (job: Job) => {
    const valve = (devices || []).find((d) => (
      job.zone_id && Number(d.zone_id) === Number(job.zone_id) && d.kind === 'zone_valve'
    ));
    const linked = (jobDevices || [])
      .filter((jd) => Number(jd.job_id) === Number(job.id))
      .map((jd) => devicesById.get(Number(jd.device_id)));

    const program = job.program_id
      ? (programs || []).find((p) => Number(p.id) === Number(job.program_id))
      : null;
    const motors = ((program?.motor_device_ids as number[]) || [])
      .map((id) => devicesById.get(Number(id)));

    // Motor first: firmware that reads only device_code must see the pump.
    const ordered = [
      ...motors,
      ...linked.filter((d) => d && d.kind !== 'zone_valve'),
      valve,
    ];
    return uniqueTerminals(ordered.map((d) => d?.device_code));
  };

  // -------------------------------------------------------------------------
  // Create jobs for programs that are due right now
  //
  // Creation no longer waits for the farm to be free. A program due at 08:00
  // gets its job at 08:00 and simply waits its turn to start, so its real
  // start time is recorded and the UI can show it queued.
  // -------------------------------------------------------------------------
  const scheduledForOf = (hhmm: string) => `${local.dateKey}T${hhmm}:00+05:30`;

  const dueStartsFor = (program: Job) => {
    const times = (program.start_times || []) as string[];
    if (times.length) return times.map((t) => timeToMinutes(t));
    // No explicit times: follow the allowed window opening.
    if (program.use_allowed_windows) {
      return windowsToday.map((w) => timeToMinutes(w.start_time));
    }
    return [];
  };

  const createdJobs: Job[] = [];

  if (powerPresent) {
    for (const program of programs || []) {
      const days = ((program.days_of_week || []) as number[]).map(Number);
      if (days.length && !days.includes(local.weekday)) continue;

      const dueMin = dueStartsFor(program).find(
        (m) => nowMin >= m && nowMin < m + START_GRACE_MINUTES,
      );
      if (dueMin == null) continue;
      if (program.use_allowed_windows && !inWindow) continue;

      const scheduledFor = scheduledForOf(minutesToClock(dueMin));
      const already = (todayProgramJobs || []).some((j) => (
        Number(j.program_id) === Number(program.id)
        && j.scheduled_for
        && new Date(String(j.scheduled_for)).getTime() === new Date(scheduledFor).getTime()
      ));
      if (already) continue;

      const programSteps = activeStepsOf(steps || [], Number(program.id));
      if (!programSteps.length) {
        actions.push(`program_no_steps:${program.id}`);
        continue;
      }

      const isFertigation = program.program_type === 'fertigation';
      const first = programSteps[0];
      const zone = first.zone_id ? zonesById.get(Number(first.zone_id)) : undefined;

      const { data: job, error } = await supabase
        .from('irrigation_jobs')
        .insert({
          farm_id: farmId,
          program_id: program.id,
          job_type: isFertigation ? 'fertigation' : 'water',
          status: 'planned',
          liters_delivered: 0,
          duration_elapsed_minutes: 0,
          window_mode: program.use_allowed_windows !== false,
          scheduled_for: scheduledFor,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          ...stepFieldsFor(first, isFertigation, zone),
        })
        .select('*')
        .single();

      if (error || !job) {
        actions.push(`create_failed:${program.id}:${error?.message || 'unknown'}`);
        continue;
      }

      const deviceRows = uniqueTerminals([
        ...((program.motor_device_ids as number[]) || []).map((id) => devicesById.get(Number(id))?.device_code),
        ...(programDevices || [])
          .filter((d) => Number(d.program_id) === Number(program.id))
          .map((d) => devicesById.get(Number(d.device_id))?.device_code),
      ]);

      const links = (devices || [])
        .filter((d) => deviceRows.includes(normalizeCode(d.device_code) as string))
        .map((d) => ({
          job_id: job.id,
          device_id: d.id,
          role: d.kind === 'fertigation' ? 'injector' : (d.kind.includes('motor') ? 'motor' : 'other'),
        }));

      if (links.length) {
        await supabase.from('irrigation_job_devices').insert(links);
        (jobDevices || []).push(...links.map((l) => ({ ...l })));
      }

      createdJobs.push(job);
      actions.push(`created_job:${job.id}:program:${program.id}:due:${minutesToClock(dueMin)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Decide which job may hold the pump, then drive it
  // -------------------------------------------------------------------------
  const allOpen: Job[] = [...(openJobs || []), ...createdJobs];

  const programOrder = new Map(
    [...(programs || [])]
      .sort((a, b) => (Number(a.run_order) || 0) - (Number(b.run_order) || 0) || Number(a.id) - Number(b.id))
      .map((p, idx) => [Number(p.id), Number(p.run_order) || idx]),
  );

  const sortedOpen = allOpen.sort((a, b) => {
    const manualA = a.job_type === 'manual' ? 0 : 1;
    const manualB = b.job_type === 'manual' ? 0 : 1;
    if (manualA !== manualB) return manualA - manualB;
    const oa = programOrder.get(Number(a.program_id)) ?? 9999;
    const ob = programOrder.get(Number(b.program_id)) ?? 9999;
    if (oa !== ob) return oa - ob;
    return Number(a.id) - Number(b.id);
  });

  const primary = sortedOpen.find((j) => j.job_type === 'manual')
    || sortedOpen.find((j) => j.status === 'running')
    || sortedOpen[0]
    || null;

  for (const job of sortedOpen) {
    const codes = devicesForJob(job);
    const zone = job.zone_id ? zonesById.get(Number(job.zone_id)) : undefined;
    const status = job.zone_id ? statusByZone.get(Number(job.zone_id)) : undefined;

    const stopJob = (reason: string, nextStatus: string | null) => {
      batch.cancelFor(codes, 'start');
      for (const code of codes) batch.add(code, 'stop', { jobId: job.id, zoneId: job.zone_id, reason });
      if (job.zone_id) zonePendingPatches.set(Number(job.zone_id), 'stop');
      const patch: Record<string, unknown> = {
        duration_elapsed_minutes: Number(elapsedMinutes(job, now).toFixed(2)),
      };
      if (nextStatus) {
        patch.status = nextStatus;
        patch.liters_baseline = null;
        if (nextStatus === 'completed' || nextStatus === 'cancelled') {
          patch.completed_at = now.toISOString();
        }
      }
      patchJob(job, patch);
    };

    // Mains gone: stop everything and remember to resume later.
    if (!powerPresent) {
      if (job.status === 'running') {
        stopJob('no_power', 'paused_no_power');
        actions.push(`paused_no_power:${job.id}`);
      }
      continue;
    }

    // Not this job's turn.
    if (!primary || Number(job.id) !== Number(primary.id)) {
      if (job.status === 'running') {
        stopJob('queued_behind_primary', 'planned');
        actions.push(`queued_behind:${job.id}`);
      }
      continue;
    }

    // Liters come from telemetry via the ingest function; recompute here only as
    // a fallback so a missed POST does not stall progress.
    if (status?.total_discharge_liters != null && job.liters_baseline != null) {
      const delivered = Math.max(0, Number(status.total_discharge_liters) - Number(job.liters_baseline));
      if (Math.abs(delivered - (Number(job.liters_delivered) || 0)) > 0.5) {
        patchJob(job, { liters_delivered: delivered });
      }
    }

    const target = job.target_liters != null ? Number(job.target_liters) : null;
    const duration = job.on_duration_minutes != null ? Number(job.on_duration_minutes) : null;
    const cap = job.max_duration_minutes != null ? Number(job.max_duration_minutes) : null;
    const delivered = Number(job.liters_delivered) || 0;
    const elapsed = elapsedMinutes(job, now);

    const hitLiters = target != null && delivered >= target;
    const hitDuration = duration != null && elapsed >= duration;
    const hitCap = cap != null && elapsed >= cap;
    // A job resuming after a pause may already be finished, so completion is
    // checked before the start path rather than only while running.
    const hasRun = Boolean(job.started_at) || elapsed > 0 || delivered > 0;

    if (hasRun && (hitLiters || hitDuration || hitCap)) {
      const reason = hitLiters ? 'target_liters' : (hitDuration ? 'duration_done' : 'max_duration');
      if (job.job_type !== 'fertigation') {
        await recordWaterIrrigationEvent(supabase, job, zone, now, elapsed);
      }

      const programSteps = job.program_id ? activeStepsOf(steps || [], Number(job.program_id)) : [];
      const idx = programSteps.findIndex((s) => Number(s.seq) === Number(job.current_step_seq));
      const next = idx >= 0 ? programSteps[idx + 1] : null;

      if (next) {
        stopJob(reason, null);
        const nextZone = next.zone_id ? zonesById.get(Number(next.zone_id)) : undefined;
        patchJob(job, {
          status: 'planned',
          started_at: null,
          liters_delivered: 0,
          liters_baseline: null,
          duration_elapsed_minutes: 0,
          ...stepFieldsFor(next, job.job_type === 'fertigation', nextZone),
        });
        actions.push(`advanced_job:${job.id}:seq:${next.seq}:${reason}`);
      } else {
        stopJob(reason, 'completed');
        actions.push(`completed_job:${job.id}:${reason}`);
      }
      continue;
    }

    // Outside allowed hours: hold, keep progress.
    if (job.window_mode && !inWindow && job.job_type !== 'manual') {
      if (job.status === 'running') {
        stopJob('outside_window', 'paused_outside_window');
        actions.push(`paused_outside_window:${job.id}`);
      }
      continue;
    }

    if (job.status === 'running') continue;

    // Start or resume. Every terminal gets its own row with its own stop rule.
    if (!codes.length) {
      actions.push(`skip_no_terminals:${job.id}`);
      continue;
    }

    const remainingLiters = target != null ? Math.max(0, target - delivered) : null;
    const remainingMinutes = (() => {
      const limits = [duration, cap].filter((v): v is number => v != null);
      if (!limits.length) return null;
      return Math.max(1, Math.ceil(Math.min(...limits) - elapsed));
    })();

    const baseline = status?.total_discharge_liters != null
      ? Number(status.total_discharge_liters) - delivered
      : 0;

    patchJob(job, {
      status: 'running',
      started_at: now.toISOString(),
      liters_baseline: baseline,
    });

    // Litres belong to the metered zone valve only; pumps and injectors stop on
    // time. Remaining, not the original target, so a resumed job does not ask
    // again for water it already delivered.
    for (const code of codes) {
      const device = (devices || []).find((d) => normalizeCode(d.device_code) === code);
      const until: Until = {};
      if (device?.kind === 'zone_valve' && remainingLiters != null) until.liters = remainingLiters;
      if (remainingMinutes != null) until.minutes = remainingMinutes;

      batch.add(code, 'start', {
        jobId: job.id,
        zoneId: job.zone_id,
        until,
        role: device?.kind,
      });
    }
    if (job.zone_id) zonePendingPatches.set(Number(job.zone_id), 'start');
    actions.push(
      `started_job:${job.id}:${codes.join(',')}`
      + (remainingLiters != null ? `:liters:${remainingLiters}` : '')
      + (remainingMinutes != null ? `:minutes:${remainingMinutes}` : ''),
    );
  }

  // -------------------------------------------------------------------------
  // Other schedules (weekly device on/off), driven by desired state
  //
  // No longer tied to the exact start minute: any tick can recover a missed
  // start or stop, and every start carries an until.minutes fail-safe.
  // -------------------------------------------------------------------------
  if (powerPresent) {
    for (const sched of schedules || []) {
      if (Number(sched.weekday) !== local.weekday) continue;
      const code = normalizeCode((sched.irrigation_devices as { device_code?: string } | null)?.device_code);
      if (!isTerminal(code)) continue;

      const start = timeToMinutes(sched.start_time);
      const end = timeToMinutes(sched.end_time);
      const inside = nowMin >= start && nowMin < end;

      let desiredOn = inside;
      let untilMinutes = Math.max(1, Math.ceil(end - nowMin));

      const onMin = Number(sched.cyclic_on_minutes);
      const offMin = Number(sched.cyclic_off_minutes);
      if (inside && onMin > 0 && offMin > 0) {
        const cycle = onMin + offMin;
        const phase = ((Math.floor(nowMin - start) % cycle) + cycle) % cycle;
        desiredOn = phase < onMin;
        untilMinutes = desiredOn
          ? Math.max(1, Math.min(onMin - phase, Math.ceil(end - nowMin)))
          : untilMinutes;
      }

      const on = believedOn(code);

      if (desiredOn && !on && !batch.hasPending(code, 'start')) {
        batch.cancelFor([code], 'stop');
        batch.add(code, 'start', { until: { minutes: untilMinutes }, reason: 'device_schedule' });
        actions.push(`sched_start:${code}:${untilMinutes}m`);
      } else if (!desiredOn && (on || batch.hasPending(code, 'start'))) {
        batch.cancelFor([code], 'start');
        batch.add(code, 'stop', { reason: 'device_schedule' });
        actions.push(`sched_stop:${code}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Flush: batched writes only, nothing per-iteration
  // -------------------------------------------------------------------------
  const queueWrite = await batch.flush(supabase);

  for (const [jobId, patch] of jobPatches) {
    await supabase.from('irrigation_jobs').update(patch).eq('id', jobId);
  }

  for (const [zoneId, command] of zonePendingPatches) {
    await supabase.from('irrigation_zone_status').upsert({
      zone_id: zoneId,
      farm_id: farmId,
      pending_command: command,
      pending_command_at: now.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: 'zone_id' });
  }

  return {
    farmId,
    time: local.hhmm,
    weekday: local.weekday,
    in_window: inWindow,
    power_present: powerPresent,
    open_jobs: sortedOpen.length,
    primary_job: primary?.id ?? null,
    commands_queued: queueWrite.inserted,
    commands_cancelled: queueWrite.cancelled,
    actions,
  };
}

async function recordWaterIrrigationEvent(
  supabase: Supabase,
  job: Job,
  zone: { flow_rate_lph?: number | null } | undefined,
  now: Date,
  elapsed: number,
) {
  if (!job.zone_id) return;

  const liters = Number(job.liters_delivered) || 0;
  const flow = zone?.flow_rate_lph != null ? Number(zone.flow_rate_lph) : null;
  let duration = elapsed;
  if (!(duration > 0) && liters > 0 && flow && flow > 0) duration = (liters / flow) * 60;
  if (!(duration > 0) && !(liters > 0)) return;

  const local = partsInTz(now, FARM_TZ);
  const notes = `irrigation_job:${job.id}:seq:${job.current_step_seq ?? 0}`;

  const { data: existing } = await supabase
    .from('irrigation_events')
    .select('id')
    .eq('zone_id', job.zone_id)
    .eq('notes', notes)
    .maybeSingle();
  if (existing) return;

  await supabase.from('irrigation_events').insert({
    zone_id: job.zone_id,
    event_date: local.dateKey,
    duration_minutes: Math.max(1, Math.round(duration)),
    water_liters: liters > 0 ? liters : null,
    flow_rate_lph: flow,
    notes,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('IRRIGATION_SCHEDULER_CRON_SECRET')
    || Deno.env.get('GPS_SATELLITE_CRON_SECRET')
    || '';

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const provided = req.headers.get('x-cron-secret') || '';
  if (cronSecret && provided !== cronSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date();
  const farmIdFilter = body.farm_id != null ? Number(body.farm_id) : null;

  let farmIds: number[] = [];
  if (farmIdFilter) {
    farmIds = [farmIdFilter];
  } else {
    const { data: farms } = await supabase.from('farms').select('id');
    farmIds = (farms || []).map((f) => f.id);
  }

  const results = [];
  for (const farmId of farmIds) {
    try {
      results.push(await processFarm(supabase, farmId, now));
    } catch (err) {
      results.push({ farmId, error: String(err) });
    }
  }

  return jsonResponse({
    ok: true,
    ran_at: now.toISOString(),
    farms: results.length,
    results,
  });
});
