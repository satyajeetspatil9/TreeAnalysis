#!/usr/bin/env node
/**
 * Calls refresh-gps-satellite-batch until done or max runtime.
 * Used by GitHub Actions weekly cron and local runs.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   GPS_SATELLITE_CRON_SECRET
 *   FARM_ID
 *
 * Optional:
 *   MAX_RUNTIME_MINUTES (default 330)
 *   BATCH_LIMIT (default 1)
 *   FORCE_REFRESH (default false)
 */

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CRON_SECRET = process.env.GPS_SATELLITE_CRON_SECRET;
const FARM_ID = Number(process.env.FARM_ID);
const MAX_RUNTIME_MS = Number(process.env.MAX_RUNTIME_MINUTES ?? 330) * 60 * 1000;
const BATCH_LIMIT = Number(process.env.BATCH_LIMIT ?? 1);
const FORCE = process.env.FORCE_REFRESH === 'true';

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
}

requireEnv('SUPABASE_URL', SUPABASE_URL);
requireEnv('SUPABASE_ANON_KEY', ANON_KEY);
requireEnv('GPS_SATELLITE_CRON_SECRET', CRON_SECRET);
if (!Number.isFinite(FARM_ID) || FARM_ID <= 0) {
  console.error('FARM_ID must be a positive integer');
  process.exit(1);
}

const endpoint = `${SUPABASE_URL}/functions/v1/refresh-gps-satellite-batch`;

async function callBatch(afterPositionId) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      'x-cron-secret': CRON_SECRET,
    },
    body: JSON.stringify({
      farm_id: FARM_ID,
      after_position_id: afterPositionId,
      limit: BATCH_LIMIT,
      force: FORCE,
      days_back: 10,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON (${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok || data.error) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function main() {
  const started = Date.now();
  let afterPositionId = 0;
  let iterations = 0;

  console.log(`Farm ${FARM_ID} · max runtime ${MAX_RUNTIME_MS / 60000} min`);

  while (Date.now() - started < MAX_RUNTIME_MS) {
    iterations += 1;
    const result = await callBatch(afterPositionId);

    const last = result.processed?.[result.processed.length - 1];
    console.log(
      `[${iterations}] week ${result.week_start} · `
      + `${result.cached_this_week}/${result.total_with_gps} cached · `
      + `${result.remaining} remaining`
      + (last?.position_code ? ` · last ${last.position_code}` : ''),
    );

    if (result.done || !result.processed_count) {
      console.log('Batch complete for this week.');
      return;
    }

    afterPositionId = result.next_after_position_id ?? afterPositionId;
  }

  console.log('Stopped at max runtime. Remaining trees will run on the next scheduled job.');
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
