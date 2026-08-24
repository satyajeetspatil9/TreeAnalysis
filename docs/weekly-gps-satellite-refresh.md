# Weekly GPS satellite cache (Supabase pg_cron)

Automatic refresh stores orchard-planetary API results in `tree_gps_satellite_cache` so tree Satellite tabs load instantly.

## Schedule

**pg_cron** job `gps-satellite-weekly-batch`:

| Cron | Meaning |
|------|---------|
| `*/5 * * * 1,2,3` | Every **5 minutes** on **Mon, Tue, Wed** (UTC) |

Each tick processes **one tree** (~1–2 min upstream). Trees already cached this week are skipped. Large farms (600 trees) finish over Mon–Wed; when all are done, calls return quickly with nothing to do.

Times are **UTC** (Supabase pg_cron). Mon–Wed UTC covers the weekly refresh window; adjust in migration `036` if needed.

## One-time setup

### 1. Migrations

Run in Supabase SQL Editor:

1. `035_tree_gps_satellite_cache.sql`
2. `036_pg_cron_gps_satellite.sql`

### 2. Enable extensions

Dashboard → **Database → Extensions** → enable:

- **pg_cron**
- **pg_net**

(Re-running migration 036 also runs `CREATE EXTENSION IF NOT EXISTS`.)

### 3. Edge function secret

Dashboard → **Edge Functions → Secrets**:

| Secret | Value |
|--------|--------|
| `GPS_SATELLITE_CRON_SECRET` | Long random string |

```powershell
supabase functions deploy refresh-gps-satellite-batch --no-verify-jwt
```

### 4. Cron settings row

**Settings → Satellite cache → Automatic refresh (pg_cron)** in the app, or SQL:

```sql
INSERT INTO public.gps_satellite_cron_settings (
  farm_id,
  supabase_project_url,
  anon_key,
  cron_secret,
  enabled
) VALUES (
  1,
  'https://jzgfeqiboxrhjnvwxywh.supabase.co',
  'your-supabase-anon-key',
  'same-value-as-GPS_SATELLITE_CRON_SECRET',
  TRUE
)
ON CONFLICT (singleton_id) DO UPDATE SET
  farm_id = EXCLUDED.farm_id,
  anon_key = EXCLUDED.anon_key,
  cron_secret = EXCLUDED.cron_secret,
  enabled = EXCLUDED.enabled,
  updated_at = now();
```

### 5. Verify cron job

SQL Editor:

```sql
SELECT jobid, jobname, schedule, command FROM cron.job
WHERE jobname = 'gps-satellite-weekly-batch';
```

Optional — run once manually:

```sql
SELECT public.run_gps_satellite_batch_cron();
```

Check **Database → Cron → Job runs** (or `cron.job_run_details`) for history.

## Manual refresh (UI)

**Settings → Satellite cache → Refresh missing trees this week** uses your login (not pg_cron).

## Local test (optional)

```powershell
node scripts/run-gps-satellite-batch.mjs
```

Requires env vars documented in the script header.

## Disable automatic refresh

```sql
UPDATE public.gps_satellite_cron_settings SET enabled = FALSE WHERE singleton_id = 1;
```

Or toggle off in **Settings → Satellite cache**.
