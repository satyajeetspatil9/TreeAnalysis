import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const TERMINAL_PATTERN = /^[XY]\d+$/;

type Supabase = ReturnType<typeof createClient>;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hashKey(key: string) {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBoolean(value: unknown) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'on', 'yes', 'start', 'present', 'available'].includes(normalized)) return true;
    if (['false', 'off', 'no', 'stop', 'absent', 'unavailable'].includes(normalized)) return false;
  }
  return null;
}

function normalizeZoneCode(raw: unknown) {
  if (raw == null) return null;
  const text = String(raw).trim().toUpperCase();
  return text || null;
}

function normalizeCode(raw: unknown) {
  const text = String(raw ?? '').trim().toUpperCase();
  return text || null;
}

function extractApiKey(req: Request) {
  const headerKey = req.headers.get('x-api-key')?.trim();
  if (headerKey) return headerKey;

  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ta_')) {
    return authHeader.slice(7).trim();
  }

  return '';
}

function parseTimestamp(raw: unknown) {
  if (raw == null || raw === '') return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function readTimestamp(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (body[key] === undefined || body[key] === null || body[key] === '') continue;
    const parsed = parseTimestamp(body[key]);
    if (parsed) return parsed;
  }
  return null;
}

/** Mains presence, accepted under any of the names firmware tends to use. */
function readPowerFlag(body: Record<string, unknown>) {
  const candidates = [
    body.power_present, body.power, body.mains, body.mains_present,
    body.electricity, body.electricity_present, body.power_available,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const parsed = parseBoolean(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

type QueueRow = {
  id: number;
  device_code: string;
  action: string;
  job_id: number | null;
  zone_id: number | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  expires_at: string | null;
};

/** Older rows packed several pins into one row; read them all back. */
function codesFromQueueRow(row: { device_code?: string | null; payload?: Record<string, unknown> | null }) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const packed = Array.isArray(payload.device_codes) ? payload.device_codes as unknown[] : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...packed, row.device_code]) {
    const code = normalizeCode(raw);
    if (!code || !TERMINAL_PATTERN.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/**
 * One command per terminal, each carrying its own stop rule. A pin stops when
 * its own `until` is met; pins in the same job no longer share a condition.
 */
function expandQueueRow(row: QueueRow, zoneCodeById: Map<number, string>) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const until = payload.until ?? undefined;
  const zoneCode = row.zone_id ? (zoneCodeById.get(Number(row.zone_id)) || null) : null;

  return codesFromQueueRow(row).map((code) => ({
    id: row.id,
    device_code: code,
    device_codes: [code],
    action: row.action,
    job_id: row.job_id,
    zone_id: row.zone_id,
    zone_code: zoneCode,
    until,
    payload,
    created_at: row.created_at,
    expires_at: row.expires_at,
  }));
}

async function readPowerStatus(supabase: Supabase, farmId: number) {
  const { data } = await supabase
    .from('irrigation_power_status')
    .select('power_present, changed_at, reported_at, outage_started_at, outage_ended_at, shift_minutes, local_date')
    .eq('farm_id', farmId)
    .maybeSingle();
  return data || null;
}

async function writePowerStatus(
  supabase: Supabase,
  farmId: number,
  opts: {
    powerPresent: boolean | null;
    reportedAt: string;
    outageStartedAt: string | null;
    outageEndedAt: string | null;
  },
) {
  const previous = await readPowerStatus(supabase, farmId);
  const powerPresent = opts.powerPresent != null
    ? opts.powerPresent
    : (previous ? previous.power_present !== false : true);
  const changed = !previous || previous.power_present !== powerPresent;
  const now = new Date().toISOString();

  // Start/end come from the controller. Never invent them from the POST arrival time.
  let outageStartedAt = previous?.outage_started_at ?? null;
  let outageEndedAt = previous?.outage_ended_at ?? null;

  if (opts.outageStartedAt) outageStartedAt = opts.outageStartedAt;
  if (opts.outageEndedAt) outageEndedAt = opts.outageEndedAt;

  if (!powerPresent) {
    outageEndedAt = opts.outageEndedAt || null;
  }

  await supabase.from('irrigation_power_status').upsert({
    farm_id: farmId,
    power_present: powerPresent,
    changed_at: changed ? opts.reportedAt : (previous?.changed_at ?? opts.reportedAt),
    reported_at: opts.reportedAt,
    outage_started_at: outageStartedAt,
    outage_ended_at: outageEndedAt,
    shift_minutes: previous?.shift_minutes ?? 0,
    local_date: previous?.local_date ?? null,
    updated_at: now,
  }, { onConflict: 'farm_id' });

  return { changed, powerPresent };
}

/**
 * Pending commands for the farm plus the mains flag. Expired rows are filtered
 * locally and only written back when there is something to retire, so a quiet
 * minute costs reads and no writes.
 */
async function fetchControllerWork(supabase: Supabase, farmId: number) {
  const nowMs = Date.now();

  const [queueRes, powerRes, legacyRes] = await Promise.all([
    supabase
      .from('irrigation_command_queue')
      .select('id, device_code, action, job_id, zone_id, payload, created_at, expires_at')
      .eq('farm_id', farmId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50),
    supabase
      .from('irrigation_power_status')
      .select('power_present, changed_at, reported_at, outage_started_at, outage_ended_at')
      .eq('farm_id', farmId)
      .maybeSingle(),
    supabase
      .from('irrigation_zone_status')
      .select('zone_id, pending_command, pending_command_at, is_irrigating')
      .eq('farm_id', farmId)
      .not('pending_command', 'is', null),
  ]);

  if (queueRes.error) {
    const missing = String(queueRes.error.message || '').includes('irrigation_command_queue');
    if (missing) return { commands: [], pending: [], power: null, missingQueue: true, error: null };
    return { commands: [], pending: [], power: null, missingQueue: false, error: queueRes.error };
  }

  const rows = (queueRes.data || []) as QueueRow[];
  const expiredIds: number[] = [];
  const liveRows: QueueRow[] = [];
  for (const row of rows) {
    if (row.expires_at && new Date(row.expires_at).getTime() < nowMs) expiredIds.push(row.id);
    else liveRows.push(row);
  }

  const legacyRows = legacyRes.data || [];
  const needsZoneCodes = liveRows.some((r) => r.zone_id != null) || legacyRows.length > 0;

  const [zonesRes] = await Promise.all([
    needsZoneCodes
      ? supabase.from('irrigation_zones').select('id, zone_code').eq('farm_id', farmId)
      : Promise.resolve({ data: [] as Array<{ id: number; zone_code: string }> }),
    expiredIds.length
      ? supabase.from('irrigation_command_queue').update({ status: 'expired' }).in('id', expiredIds)
      : Promise.resolve(null),
  ]);

  const zoneCodeById = new Map(
    ((zonesRes.data || []) as Array<{ id: number; zone_code: string }>)
      .map((z) => [Number(z.id), z.zone_code]),
  );

  return {
    commands: liveRows.flatMap((row) => expandQueueRow(row, zoneCodeById)),
    pending: legacyRows.map((row) => ({
      zone_code: zoneCodeById.get(Number(row.zone_id)) || null,
      command: row.pending_command,
      command_at: row.pending_command_at,
      is_irrigating: row.is_irrigating,
    })),
    power: powerRes.data || null,
    missingQueue: false,
    error: null,
  };
}

/**
 * Keep litres in step with the meter. Completion is deliberately not decided
 * here: the scheduler owns state changes so that finishing a job always also
 * queues the stop commands for its terminals.
 */
async function updateRunningJobLiters(
  supabase: Supabase,
  farmId: number,
  zoneId: number,
  totalDischargeLiters: number | null,
) {
  if (totalDischargeLiters == null) return;

  const { data: jobs } = await supabase
    .from('irrigation_jobs')
    .select('id, liters_baseline, liters_delivered')
    .eq('farm_id', farmId)
    .eq('zone_id', zoneId)
    .eq('status', 'running')
    .order('updated_at', { ascending: false })
    .limit(1);

  const job = jobs?.[0];
  if (!job) return;

  if (job.liters_baseline == null) {
    await supabase.from('irrigation_jobs').update({
      liters_baseline: totalDischargeLiters,
      liters_delivered: 0,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    return;
  }

  const delivered = Math.max(0, Number(totalDischargeLiters) - Number(job.liters_baseline));
  if (Math.abs(delivered - (Number(job.liters_delivered) || 0)) < 0.5) return;

  await supabase.from('irrigation_jobs').update({
    liters_delivered: delivered,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
}

async function ackQueueCommands(
  supabase: Supabase,
  farmId: number,
  body: Record<string, unknown>,
  zoneId: number | null,
) {
  const now = new Date().toISOString();
  const commandId = parseNumber(body.command_id ?? body.ack_command_id);

  if (commandId != null) {
    await supabase
      .from('irrigation_command_queue')
      .update({ status: 'acked', acked_at: now })
      .eq('id', commandId)
      .eq('farm_id', farmId);
    return;
  }

  // No id: ack by terminal, and by zone only when no terminal was given.
  const deviceCode = normalizeCode(body.device_code);
  const action = body.acked_action ? String(body.acked_action).trim().toLowerCase() : null;

  const { data: pending } = await supabase
    .from('irrigation_command_queue')
    .select('id, device_code, payload, zone_id, action')
    .eq('farm_id', farmId)
    .eq('status', 'pending');

  const ids = (pending || [])
    .filter((row) => {
      if ((action === 'start' || action === 'stop') && row.action !== action) return false;
      if (deviceCode) return codesFromQueueRow(row).includes(deviceCode);
      return zoneId != null && Number(row.zone_id) === Number(zoneId);
    })
    .map((row) => row.id);

  if (ids.length) {
    await supabase
      .from('irrigation_command_queue')
      .update({ status: 'acked', acked_at: now })
      .in('id', ids);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return jsonResponse({
      error: 'Missing ingest API key. Send header: x-api-key: ta_...',
    }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const keyHash = await hashKey(apiKey);

  const { data: keyRow, error: keyError } = await supabase
    .from('farm_ingest_keys')
    .select('id, farm_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (keyError) {
    return jsonResponse({ error: keyError.message }, 500);
  }
  if (!keyRow) {
    return jsonResponse({ error: 'Invalid or revoked API key' }, 401);
  }

  if (req.method === 'GET') {
    const work = await fetchControllerWork(supabase, keyRow.farm_id);
    if (work.error) {
      return jsonResponse({ error: work.error.message }, 500);
    }

    return jsonResponse({
      ok: true,
      updated_at: new Date().toISOString(),
      power_present: work.power ? work.power.power_present !== false : true,
      power_reported_at: work.power?.reported_at ?? null,
      outage_started_at: work.power?.outage_started_at ?? null,
      outage_ended_at: work.power?.outage_ended_at ?? null,
      commands: work.commands,
      pending_commands: work.pending,
      queue_available: !work.missingQueue,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const now = new Date().toISOString();
  const reportedAt = parseTimestamp(body.reported_at) ?? now;

  const powerFlag = readPowerFlag(body);
  const outageStartedAt = readTimestamp(body, [
    'outage_started_at', 'outage_start', 'outage_start_time',
    'power_lost_at', 'electricity_off_at',
  ]);
  const outageEndedAt = readTimestamp(body, [
    'outage_ended_at', 'outage_end', 'outage_end_time',
    'power_restored_at', 'electricity_on_at',
  ]);

  let powerResult: { changed: boolean; powerPresent: boolean } | null = null;
  if (powerFlag !== null || outageStartedAt || outageEndedAt) {
    powerResult = await writePowerStatus(supabase, keyRow.farm_id, {
      powerPresent: powerFlag,
      reportedAt,
      outageStartedAt,
      outageEndedAt,
    });
  }

  await supabase
    .from('farm_ingest_keys')
    .update({ last_used_at: now })
    .eq('id', keyRow.id);

  // Ack-only for non-zone terminals (motors, injectors, scheduled devices)
  const ackOnly = parseBoolean(body.ack_only) === true;
  if (ackOnly) {
    const commandId = parseNumber(body.command_id ?? body.ack_command_id);
    const deviceCode = normalizeCode(body.device_code);
    if (commandId == null && !deviceCode) {
      return jsonResponse({ error: 'ack_only requires command_id or device_code' }, 400);
    }
    await ackQueueCommands(supabase, keyRow.farm_id, body, null);
    return jsonResponse({
      ok: true,
      acked_command_id: commandId,
      acked_device_code: deviceCode,
      // Omitted rather than null when this POST carried no mains reading.
      power_present: powerResult?.powerPresent,
    });
  }

  const postedDeviceCode = normalizeCode(body.device_code);
  const zoneCode = normalizeZoneCode(body.zone_code ?? body.zone);

  let zoneRow: { id: number; farm_id: number; zone_code: string } | null = null;

  if (postedDeviceCode) {
    const { data: device, error: deviceError } = await supabase
      .from('irrigation_devices')
      .select('zone_id')
      .eq('farm_id', keyRow.farm_id)
      .eq('device_code', postedDeviceCode)
      .maybeSingle();
    if (deviceError) {
      return jsonResponse({ error: deviceError.message }, 500);
    }
    if (device?.zone_id) {
      const { data: byDevice, error: zoneByDeviceError } = await supabase
        .from('irrigation_zones')
        .select('id, farm_id, zone_code')
        .eq('id', device.zone_id)
        .maybeSingle();
      if (zoneByDeviceError) {
        return jsonResponse({ error: zoneByDeviceError.message }, 500);
      }
      zoneRow = byDevice;
    }
  }

  if (!zoneRow && zoneCode) {
    const { data, error: zoneError } = await supabase
      .from('irrigation_zones')
      .select('id, farm_id, zone_code')
      .eq('farm_id', keyRow.farm_id)
      .eq('zone_code', zoneCode)
      .maybeSingle();
    if (zoneError) {
      return jsonResponse({ error: zoneError.message }, 500);
    }
    zoneRow = data;
  }

  // A power-only heartbeat, or an ack from a terminal that has no zone, is a
  // valid report and must not be rejected for lacking zone telemetry.
  if (!zoneRow) {
    const ackCommand = parseBoolean(body.ack_command ?? body.command_ack) === true;
    if (ackCommand) {
      await ackQueueCommands(supabase, keyRow.farm_id, body, null);
    }
    if (powerFlag !== null || ackCommand || outageStartedAt || outageEndedAt) {
      const work = await fetchControllerWork(supabase, keyRow.farm_id);
      return jsonResponse({
        ok: true,
        power_present: work.power ? work.power.power_present !== false : true,
        power_changed: powerResult?.changed ?? false,
        outage_started_at: work.power?.outage_started_at ?? null,
        outage_ended_at: work.power?.outage_ended_at ?? null,
        commands: work.commands,
      });
    }
    return jsonResponse({
      error: 'Missing device_code linked to a zone, or zone_code matching irrigation_zones.zone_code',
      device_code: postedDeviceCode,
      zone_code: zoneCode,
    }, 400);
  }

  const startIndicator = parseBoolean(body.start_indicator) ?? false;
  const stopIndicator = parseBoolean(body.stop_indicator) ?? false;
  const explicitIrrigating = parseBoolean(body.is_irrigating);
  const isIrrigating = explicitIrrigating ?? (startIndicator && !stopIndicator);

  const startedAtRaw = body.started_at ?? body.start_time;
  const startedAt = isIrrigating
    ? (parseTimestamp(startedAtRaw) ?? reportedAt)
    : null;

  const ackCommand = parseBoolean(body.ack_command ?? body.command_ack) === true;
  const totalLiters = parseNumber(body.total_discharge_liters ?? body.total_discharge);

  const payload: Record<string, unknown> = {
    zone_id: zoneRow.id,
    farm_id: zoneRow.farm_id,
    is_irrigating: isIrrigating,
    started_at: startedAt,
    voltage_v: parseNumber(body.voltage_v ?? body.voltage),
    current_amp: parseNumber(body.current_amp ?? body.amp ?? body.amperage),
    start_indicator: startIndicator,
    stop_indicator: stopIndicator,
    current_discharge_lpm: parseNumber(body.current_discharge_lpm ?? body.current_discharge),
    total_discharge_liters: totalLiters,
    device_code: postedDeviceCode,
    reported_at: reportedAt,
    updated_at: now,
  };

  if (ackCommand) {
    payload.pending_command = null;
    payload.pending_command_at = null;
    await ackQueueCommands(supabase, keyRow.farm_id, body, zoneRow.id);
  }

  const { error: upsertError } = await supabase
    .from('irrigation_zone_status')
    .upsert(payload, { onConflict: 'zone_id' });

  if (upsertError) {
    return jsonResponse({ error: upsertError.message }, 500);
  }

  await updateRunningJobLiters(supabase, keyRow.farm_id, zoneRow.id, totalLiters);

  const work = await fetchControllerWork(supabase, keyRow.farm_id);

  return jsonResponse({
    ok: true,
    zone_id: zoneRow.id,
    zone_code: zoneRow.zone_code,
    is_irrigating: isIrrigating,
    power_present: work.power ? work.power.power_present !== false : true,
    power_changed: powerResult?.changed ?? false,
    outage_started_at: work.power?.outage_started_at ?? null,
    outage_ended_at: work.power?.outage_ended_at ?? null,
    commands: work.commands,
    pending_commands: work.pending,
  });
});
