import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

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
    if (['true', 'on', 'yes', 'start'].includes(normalized)) return true;
    if (['false', 'off', 'no', 'stop'].includes(normalized)) return false;
  }
  return null;
}

function normalizeZoneCode(raw: unknown) {
  if (raw == null) return null;
  const text = String(raw).trim().toUpperCase();
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

function uniqueDeviceCodes(codes: Array<string | null | undefined>) {
  return [...new Set(
    codes
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean),
  )];
}

function deviceCodesFromQueueRow(row: {
  device_code?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const fromPayload = Array.isArray(payload.device_codes) ? payload.device_codes as string[] : [];
  return uniqueDeviceCodes([...fromPayload, row.device_code]);
}

function mapQueueCommand(
  row: {
    id: number;
    device_code: string;
    action: string;
    job_id: number | null;
    zone_id: number | null;
    payload: Record<string, unknown> | null;
    created_at: string;
    expires_at: string | null;
  },
  zoneCodeById: Map<number, string>,
) {
  const until = (row.payload as Record<string, unknown> | null)?.until ?? undefined;
  const deviceCodes = deviceCodesFromQueueRow(row);
  return {
    id: row.id,
    device_code: deviceCodes[0] || row.device_code,
    device_codes: deviceCodes,
    action: row.action,
    job_id: row.job_id,
    zone_id: row.zone_id,
    zone_code: row.zone_id ? (zoneCodeById.get(row.zone_id) || null) : null,
    until,
    payload: row.payload || {},
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

function coalesceQueuedCommands(commands: Array<ReturnType<typeof mapQueueCommand>>) {
  const groups = new Map<string, ReturnType<typeof mapQueueCommand>>();
  const order: string[] = [];
  for (const command of commands) {
    const untilKey = JSON.stringify(command.until ?? null);
    const key = command.job_id != null
      ? `job:${command.job_id}|${command.action}|${untilKey}`
      : `id:${command.id}`;
    if (!groups.has(key)) {
      groups.set(key, { ...command, device_codes: uniqueDeviceCodes(command.device_codes) });
      order.push(key);
      continue;
    }
    const grouped = groups.get(key)!;
    grouped.device_codes = uniqueDeviceCodes([
      ...grouped.device_codes,
      ...command.device_codes,
      command.device_code,
    ]);
    grouped.device_code = grouped.device_codes[0] || grouped.device_code;
    if (command.id < grouped.id) grouped.id = command.id;
  }
  return order.map((key) => groups.get(key)!);
}

async function expireStaleCommands(supabase: ReturnType<typeof createClient>, farmId: number) {
  const now = new Date().toISOString();
  await supabase
    .from('irrigation_command_queue')
    .update({ status: 'expired' })
    .eq('farm_id', farmId)
    .eq('status', 'pending')
    .lt('expires_at', now);
}

async function fetchQueueCommands(supabase: ReturnType<typeof createClient>, farmId: number) {
  await expireStaleCommands(supabase, farmId);

  const { data: queueRows, error: queueError } = await supabase
    .from('irrigation_command_queue')
    .select('id, device_code, action, job_id, zone_id, payload, created_at, expires_at')
    .eq('farm_id', farmId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(50);

  if (queueError) {
    // Table may not exist yet — return empty queue and fall back to legacy
    if (String(queueError.message || '').includes('irrigation_command_queue')) {
      return { commands: [], queueError: null, missingQueue: true };
    }
    return { commands: [], queueError, missingQueue: false };
  }

  const { data: zones } = await supabase
    .from('irrigation_zones')
    .select('id, zone_code')
    .eq('farm_id', farmId);

  const zoneCodeById = new Map((zones || []).map((zone) => [zone.id, zone.zone_code]));

  const mapped = (queueRows || []).map((row) => mapQueueCommand(row, zoneCodeById));
  const commands = coalesceQueuedCommands(mapped);

  return { commands, queueError: null, missingQueue: false };
}

async function fetchLegacyPending(
  supabase: ReturnType<typeof createClient>,
  farmId: number,
) {
  const { data: commands, error: commandError } = await supabase
    .from('irrigation_zone_status')
    .select('zone_id, pending_command, pending_command_at, is_irrigating')
    .eq('farm_id', farmId)
    .not('pending_command', 'is', null);

  if (commandError) {
    return { pending: [], error: commandError };
  }

  const { data: zones } = await supabase
    .from('irrigation_zones')
    .select('id, zone_code')
    .eq('farm_id', farmId);

  const zoneCodeById = new Map((zones || []).map((zone) => [zone.id, zone.zone_code]));
  const pending = (commands || []).map((row) => ({
    zone_code: zoneCodeById.get(row.zone_id) || null,
    command: row.pending_command,
    command_at: row.pending_command_at,
    is_irrigating: row.is_irrigating,
  }));

  return { pending, error: null };
}

async function updateRunningJobLiters(
  supabase: ReturnType<typeof createClient>,
  farmId: number,
  zoneId: number,
  totalDischargeLiters: number | null,
) {
  if (totalDischargeLiters == null) return;

  const { data: jobs } = await supabase
    .from('irrigation_jobs')
    .select('id, liters_baseline, liters_delivered, target_liters, status')
    .eq('farm_id', farmId)
    .eq('zone_id', zoneId)
    .in('status', ['running', 'paused_outside_window'])
    .order('updated_at', { ascending: false })
    .limit(1);

  const job = jobs?.[0];
  if (!job) return;

  const baseline = job.liters_baseline != null
    ? Number(job.liters_baseline)
    : Number(totalDischargeLiters);

  const delivered = Math.max(0, Number(totalDischargeLiters) - baseline);
  const patch: Record<string, unknown> = {
    liters_delivered: delivered,
    updated_at: new Date().toISOString(),
  };

  if (job.liters_baseline == null) {
    patch.liters_baseline = totalDischargeLiters;
    patch.liters_delivered = 0;
  }

  const target = job.target_liters != null ? Number(job.target_liters) : null;
  if (target != null && delivered >= target && job.liters_baseline != null) {
    patch.status = 'completed';
    patch.completed_at = new Date().toISOString();
  }

  await supabase.from('irrigation_jobs').update(patch).eq('id', job.id);
}

async function ackQueueCommands(
  supabase: ReturnType<typeof createClient>,
  farmId: number,
  body: Record<string, unknown>,
  zoneId: number,
) {
  const now = new Date().toISOString();
  const commandId = parseNumber(body.command_id ?? body.ack_command_id);

  if (commandId != null) {
    const { data: row } = await supabase
      .from('irrigation_command_queue')
      .select('id, job_id, action')
      .eq('id', commandId)
      .eq('farm_id', farmId)
      .maybeSingle();

    await supabase
      .from('irrigation_command_queue')
      .update({ status: 'acked', acked_at: now })
      .eq('id', commandId)
      .eq('farm_id', farmId);

    if (row?.job_id) {
      await supabase
        .from('irrigation_command_queue')
        .update({ status: 'acked', acked_at: now })
        .eq('farm_id', farmId)
        .eq('job_id', row.job_id)
        .eq('action', row.action)
        .eq('status', 'pending');
    }
    return;
  }

  const deviceCode = body.device_code ? String(body.device_code).trim().toUpperCase() : null;
  const action = body.acked_action ? String(body.acked_action).trim().toLowerCase() : null;

  const { data: pending } = await supabase
    .from('irrigation_command_queue')
    .select('id, device_code, payload, zone_id, action')
    .eq('farm_id', farmId)
    .eq('status', 'pending');

  const ids = (pending || [])
    .filter((row) => {
      if (action === 'start' || action === 'stop') {
        if (row.action !== action) return false;
      }
      if (Number(row.zone_id) === Number(zoneId)) return true;
      if (deviceCode && deviceCodesFromQueueRow(row).includes(deviceCode)) return true;
      return false;
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
    const { commands, queueError, missingQueue } = await fetchQueueCommands(supabase, keyRow.farm_id);
    if (queueError) {
      return jsonResponse({ error: queueError.message }, 500);
    }

    const { pending, error: legacyError } = await fetchLegacyPending(supabase, keyRow.farm_id);
    if (legacyError) {
      return jsonResponse({ error: legacyError.message }, 500);
    }

    return jsonResponse({
      ok: true,
      updated_at: new Date().toISOString(),
      commands,
      pending_commands: pending,
      queue_available: !missingQueue,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // Ack-only for non-zone devices (motors / fertigation)
  const ackOnly = parseBoolean(body.ack_only) === true;
  if (ackOnly) {
    const commandId = parseNumber(body.command_id ?? body.ack_command_id);
    if (commandId == null) {
      return jsonResponse({ error: 'ack_only requires command_id' }, 400);
    }
    const now = new Date().toISOString();
    const { error: ackError } = await supabase
      .from('irrigation_command_queue')
      .update({ status: 'acked', acked_at: now })
      .eq('id', commandId)
      .eq('farm_id', keyRow.farm_id);

    if (ackError) {
      return jsonResponse({ error: ackError.message }, 500);
    }

    await supabase
      .from('farm_ingest_keys')
      .update({ last_used_at: now })
      .eq('id', keyRow.id);

    return jsonResponse({ ok: true, acked_command_id: commandId });
  }

  const postedDeviceCode = body.device_code ? String(body.device_code).trim().toUpperCase() : null;
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

  if (!zoneRow) {
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
    ? (parseTimestamp(startedAtRaw) ?? parseTimestamp(body.reported_at) ?? new Date().toISOString())
    : null;

  const reportedAt = parseTimestamp(body.reported_at) ?? new Date().toISOString();
  const now = new Date().toISOString();
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

  await supabase
    .from('farm_ingest_keys')
    .update({ last_used_at: now })
    .eq('id', keyRow.id);

  const { data: latest, error: latestError } = await supabase
    .from('irrigation_zone_status')
    .select('pending_command, pending_command_at')
    .eq('zone_id', zoneRow.id)
    .maybeSingle();

  if (latestError) {
    return jsonResponse({ error: latestError.message }, 500);
  }

  const { commands } = await fetchQueueCommands(supabase, keyRow.farm_id);

  return jsonResponse({
    ok: true,
    zone_id: zoneRow.id,
    zone_code: zoneRow.zone_code,
    is_irrigating: isIrrigating,
    pending_command: latest?.pending_command ?? null,
    pending_command_at: latest?.pending_command_at ?? null,
    commands,
  });
});
