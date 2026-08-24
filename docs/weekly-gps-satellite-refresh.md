# Weekly GPS satellite cache (GitHub Actions)

Automatic refresh stores orchard-planetary API results in `tree_gps_satellite_cache` so tree Satellite tabs load instantly.

## Schedule

| Run | UTC cron | IST |
|-----|----------|-----|
| Primary (Monday) | `30 21 * * 0` | Mon 03:00 |
| Continuation (Tue–Wed) | `30 21 * * 1,2` | Tue/Wed 03:00 |

Large farms (600+ trees) may need Tue/Wed runs to finish (~1–2 min per tree). The script exits early when all trees are cached for the week.

Manual run: **Actions → Weekly GPS satellite cache refresh → Run workflow**.

## One-time setup

### 1. Supabase migration

Run `supabase/migrations/035_tree_gps_satellite_cache.sql` in SQL Editor (if not done).

### 2. Edge function secret

Supabase Dashboard → **Edge Functions** → **Secrets**:

| Secret | Value |
|--------|--------|
| `GPS_SATELLITE_CRON_SECRET` | Long random string (e.g. `openssl rand -hex 32`) |

Redeploy after adding secrets:

```powershell
supabase functions deploy refresh-gps-satellite-batch --no-verify-jwt
```

### 3. GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Example |
|--------|---------|
| `SUPABASE_URL` | `https://jzgfeqiboxrhjnvwxywh.supabase.co` |
| `SUPABASE_ANON_KEY` | Your project anon key |
| `GPS_SATELLITE_CRON_SECRET` | Same value as Supabase secret |
| `FARM_ID` | `1` (your `farms.id`) |

### 4. Enable Actions

GitHub → **Actions** tab → enable workflows for this repo.

## Local test

```powershell
$env:SUPABASE_URL="https://jzgfeqiboxrhjnvwxywh.supabase.co"
$env:SUPABASE_ANON_KEY="your-anon-key"
$env:GPS_SATELLITE_CRON_SECRET="your-cron-secret"
$env:FARM_ID="1"
$env:MAX_RUNTIME_MINUTES="5"
node scripts/run-gps-satellite-batch.mjs
```

## Manual refresh (UI)

**Settings → Satellite cache** still works for on-demand refresh from the app (uses your login, not cron secret).
