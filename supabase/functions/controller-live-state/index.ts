import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function pipelineUrl(raw: string) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (url.startsWith('libsql://')) url = `https://${url.slice(9)}`;
  else if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
  if (url.endsWith('/v2/pipeline')) return url;
  if (url.endsWith('/')) return `${url}v2/pipeline`;
  return `${url}/v2/pipeline`;
}

function cellValue(cell: unknown) {
  if (cell == null) return null;
  if (typeof cell !== 'object') return cell;
  const item = cell as { type?: string; value?: unknown };
  if (item.type === 'null') return null;
  if (item.type === 'integer' || item.type === 'float') {
    const n = Number(item.value);
    return Number.isFinite(n) ? n : null;
  }
  return item.value ?? null;
}

function executeResults(payload: Record<string, unknown>) {
  const results = (payload.results || []) as Array<Record<string, unknown>>;
  return results
    .filter((item) => (
      item.type === 'ok'
      && (item.response as Record<string, unknown> | undefined)?.type === 'execute'
    ))
    .map((item) => (item.response as Record<string, unknown>).result as Record<string, unknown>);
}

function objectsFromResult(result: Record<string, unknown> | undefined) {
  const cols = (result?.cols || []) as Array<{ name?: string }>;
  const rows = (result?.rows || []) as unknown[][];
  if (!cols.length) return [];
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    cols.forEach((col, index) => {
      if (!col?.name) return;
      out[col.name] = cellValue(row[index]);
    });
    return out;
  });
}

function historyFromRow(row: Record<string, unknown>) {
  return {
    recordedAtIst: row.recorded_at_ist || null,
    recordedEpoch: row.recorded_epoch ?? null,
    heroState: row.hero_state || null,
    heroChannel: row.hero_channel || null,
    heroZone: row.hero_zone || null,
    minutesLeft: row.hero_minutes_left ?? null,
    durationMin: row.hero_duration_min ?? null,
    startedAt: row.hero_started_at || null,
    runningValvesCount: Number(row.running_valves_count) || 0,
    lastStoppedChannel: row.last_stopped_channel || null,
    lastStopReason: row.last_stop_reason || null,
  };
}

function remainingMinutes(
  durationMin: unknown,
  startedAt: unknown,
  updatedAtIst: unknown,
  updatedEpoch: number,
  nowMs = Date.now(),
) {
  const duration = Number(durationMin);
  if (!(duration > 0)) return null;
  const clock = String(startedAt || '').trim();
  const day = String(updatedAtIst || '').slice(0, 10);
  let startMs: number | null = null;
  if (/^\d{1,2}:\d{2}$/.test(clock) && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [hh, mm] = clock.split(':').map(Number);
    const date = new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`);
    if (!Number.isNaN(date.getTime())) startMs = date.getTime();
  }
  if (startMs == null && updatedEpoch > 1_600_000_000) {
    startMs = updatedEpoch * 1000;
  }
  if (startMs == null) return null;
  return Math.max(0, duration - (nowMs - startMs) / 60000);
}

function isControllerStale(watering: boolean, lastPollAt: string | null, tursoAgeSec: number | null) {
  if (lastPollAt) {
    const pollAgeSec = (Date.now() - new Date(lastPollAt).getTime()) / 1000;
    if (Number.isFinite(pollAgeSec)) {
      return watering ? pollAgeSec > 45 : pollAgeSec > 180;
    }
  }
  if (watering) return Number.isFinite(tursoAgeSec) && Number(tursoAgeSec) > 90;
  return false;
}

function liveFromRow(row: Record<string, unknown> | null, lastPollAt: string | null = null) {
  if (!row) return null;
  const onChannels: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    if (Number(row[`y${i}_on`]) === 1) onChannels.push(`Y${i}`);
  }
  const hero = String(row.hero_state || '').toUpperCase();
  const watering = hero.includes('WATERING') || hero.includes('ENDING') || onChannels.length > 0;
  const updatedEpoch = Number(row.updated_epoch) || 0;
  const ageSec = updatedEpoch > 1_600_000_000
    ? Math.max(0, Math.floor(Date.now() / 1000) - updatedEpoch)
    : Number(row.last_poll_age_sec);
  const durationMin = row.hero_duration_min ?? null;
  const startedAt = row.hero_started_at || null;
  const computedLeft = watering
    ? remainingMinutes(durationMin, startedAt, row.updated_at_ist, updatedEpoch)
    : null;
  const duration = Number(durationMin);
  const progressPct = computedLeft != null && duration > 0
    ? Math.max(0, Math.min(100, (1 - computedLeft / duration) * 100))
    : row.hero_progress_pct ?? null;
  return {
    watering,
    stale: isControllerStale(watering, lastPollAt, Number.isFinite(ageSec) ? ageSec : null),
    onChannels,
    heroState: row.hero_state || null,
    heroChannel: row.hero_channel || null,
    heroZone: row.hero_zone || null,
    minutesLeft: computedLeft ?? row.hero_minutes_left ?? null,
    durationMin,
    progressPct,
    startedAt,
    runningValvesCount: Number(row.running_valves_count) || onChannels.length,
    lastStoppedChannel: row.last_stopped_channel || null,
    lastStopReason: row.last_stop_reason || null,
    powerPresent: Number(row.power_present) === 1,
    wifiOnline: Number(row.wifi_online) === 1,
    wifiIp: row.wifi_ip || null,
    wifiRssi: row.wifi_rssi ?? null,
    totalLiters: row.total_liters ?? null,
    footerStatus: row.footer_status || null,
    updatedAtIst: row.updated_at_ist || null,
    clockTime: row.clock_time || null,
    lastPollAgeSec: row.last_poll_age_sec ?? null,
    lastPollAt,
    updatedEpoch: updatedEpoch > 0 ? updatedEpoch : null,
    ageSec: Number.isFinite(ageSec) ? ageSec : null,
    history: [] as ReturnType<typeof historyFromRow>[],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Use GET.' }, 405);
  }

  const tursoUrl = Deno.env.get('TURSO_DATABASE_URL') || '';
  const tursoToken = Deno.env.get('TURSO_AUTH_TOKEN') || '';
  if (!tursoUrl || !tursoToken || tursoUrl.includes('YOUR_ORG') || tursoToken.includes('YOUR_TURSO')) {
    return jsonResponse({
      ok: false,
      configured: false,
      error: 'Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN on the Edge Function (same values as TreeESP32Controller).',
    });
  }

  let lastPollAt: string | null = null;
  const farmId = Number(new URL(req.url).searchParams.get('farm_id'));
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (Number.isFinite(farmId) && farmId > 0 && supabaseUrl && serviceKey) {
    try {
      const authHeader = req.headers.get('Authorization') ?? '';
      if (anonKey && authHeader) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: farmRow } = await userClient
          .from('farms')
          .select('id')
          .eq('id', farmId)
          .maybeSingle();
        if (farmRow) {
          const admin = createClient(supabaseUrl, serviceKey);
          let { data: keyRows, error: keyError } = await admin
            .from('farm_ingest_keys')
            .select('last_poll_at, last_used_at')
            .eq('farm_id', farmId)
            .is('revoked_at', null);
          if (keyError) {
            const fallback = await admin
              .from('farm_ingest_keys')
              .select('last_used_at')
              .eq('farm_id', farmId)
              .is('revoked_at', null);
            keyRows = fallback.data;
            keyError = fallback.error;
          }
          if (!keyError && keyRows?.length) {
            const pollAt = keyRows
              .map((row) => row.last_poll_at)
              .filter(Boolean)
              .map((value) => new Date(String(value)).getTime())
              .filter((ms) => Number.isFinite(ms));
            const usedAt = keyRows
              .map((row) => row.last_used_at)
              .filter(Boolean)
              .map((value) => new Date(String(value)).getTime())
              .filter((ms) => Number.isFinite(ms));
            const times = pollAt.length ? pollAt : usedAt;
            if (times.length) {
              lastPollAt = new Date(Math.max(...times)).toISOString();
            }
          }
        }
      }
    } catch {
      lastPollAt = null;
    }
  }

  const url = pipelineUrl(tursoUrl);
  const body = {
    requests: [
      {
        type: 'execute',
        stmt: { sql: 'SELECT * FROM lilygo_live_state WHERE id = 1 LIMIT 1' },
      },
      {
        type: 'execute',
        stmt: {
          sql: 'SELECT recorded_at_ist, recorded_epoch, hero_state, hero_channel, hero_zone, hero_minutes_left, hero_duration_min, hero_started_at, running_valves_count, last_stopped_channel, last_stop_reason FROM lilygo_telemetry_history ORDER BY id DESC LIMIT 50',
        },
      },
      { type: 'close' },
    ],
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tursoToken}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      return jsonResponse({
        ok: false,
        configured: true,
        error: `Turso HTTP ${response.status}`,
      }, 502);
    }
    const execs = executeResults(payload);
    const live = liveFromRow(objectsFromResult(execs[0])[0] || null, lastPollAt);
    if (live) {
      live.history = objectsFromResult(execs[1]).map(historyFromRow);
    }
    return jsonResponse({ ok: true, configured: true, live });
  } catch (error) {
    return jsonResponse({
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : String(error),
    }, 502);
  }
});
