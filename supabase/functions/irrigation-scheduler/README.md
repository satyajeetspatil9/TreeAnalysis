# irrigation-scheduler

Expands irrigation programs/jobs into the command queue every minute.

## Deploy

```bash
supabase functions deploy irrigation-scheduler --no-verify-jwt
```

Set secret `IRRIGATION_SCHEDULER_CRON_SECRET` (same value as in `irrigation_scheduler_cron_settings.cron_secret`).

## Auth

Header `x-cron-secret: <secret>`

## Body (optional)

```json
{ "farm_id": 1 }
```

Omit `farm_id` to process all farms.

## Migration

1. `039_irrigation_schedule_control.sql`
2. `040_irrigation_scheduler_cron.sql`
3. Insert/update cron settings:

```sql
INSERT INTO irrigation_scheduler_cron_settings (singleton_id, anon_key, cron_secret, enabled)
VALUES (1, 'YOUR_ANON_KEY', 'YOUR_CRON_SECRET', true)
ON CONFLICT (singleton_id) DO UPDATE
SET anon_key = EXCLUDED.anon_key,
    cron_secret = EXCLUDED.cron_secret,
    enabled = true,
    updated_at = now();
```

## Logic

- Creates jobs from active programs at start times (Asia/Kolkata).
- Runs volume jobs only inside `irrigation_allowed_windows`.
- Stops at `target_liters`; pauses outside windows and resumes next day.
- Enqueues **one** start/stop command per job with `device_codes` so motor, injector, and zone valve terminals switch together.
- Logs completed water / Water now jobs into `irrigation_events`.
- Applies weekly `irrigation_device_schedules` (optional cyclic bore on/off).
