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

function liveFromRow(row: Record<string, unknown> | null) {
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
  return {
    watering,
    stale: Number.isFinite(ageSec) && ageSec > 90,
    onChannels,
    heroState: row.hero_state || null,
    heroChannel: row.hero_channel || null,
    heroZone: row.hero_zone || null,
    minutesLeft: row.hero_minutes_left ?? null,
    durationMin: row.hero_duration_min ?? null,
    progressPct: row.hero_progress_pct ?? null,
    startedAt: row.hero_started_at || null,
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
    const live = liveFromRow(objectsFromResult(execs[0])[0] || null);
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
