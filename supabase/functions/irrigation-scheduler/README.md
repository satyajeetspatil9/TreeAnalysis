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
3. `045_irrigation_power_and_per_pin.sql`
4. Insert/update cron settings:

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

Every pass makes **one round of reads** for the farm, decides everything in memory, then
flushes batched writes. A minute with nothing to do performs no writes at all.

- Creates a job when a program's `start_times` is reached in Asia/Kolkata, within a
  15-minute grace for a missed tick. It never starts hours late on a later tick.
- Creation no longer waits for the farm to be free. A program due at 08:00 gets its job at
  08:00 and waits its turn, so `scheduled_for` records the real program time and the
  Programs tab shows it as "Waiting its turn" instead of silently skipping the day.
- Only one job holds the pump: manual first, then the running job, then `run_order`.
- Enqueues **one command per terminal**, each with its own `until`. The metered zone valve
  gets `liters`; motors and injectors get `minutes`. Motors are queued first so firmware
  that reads only `device_code` still starts the pump.
- A job finishes on whichever comes first: `target_liters`, `on_duration_minutes`, or
  `max_duration_minutes`. That cap is what stops a liter target with no flow telemetry from
  keeping the job — and therefore every later program — open forever.
- Elapsed time is derived from `started_at` plus banked `duration_elapsed_minutes`, so it
  needs no per-minute write and does not drift when the ingest function touches the job.
- Pauses outside `irrigation_allowed_windows` and resumes with progress intact.
- Pauses on mains loss (`irrigation_power_status.power_present = false`) as
  `paused_no_power` and resumes automatically when power returns.
- Weekly `irrigation_device_schedules` run on desired state, not the exact minute: any tick
  recovers a missed start or stop, and every start carries an `until.minutes` fail-safe
  sized to the remaining window (or to `cyclic_on_minutes`). A pin is treated as off if its
  last acked start predates the latest power transition.
- Logs completed water / Water now jobs into `irrigation_events`, keyed by
  `notes = irrigation_job:<id>:seq:<n>` so a retry cannot double-count.
- Refuses to command anything that is not a real terminal (`X0`–`X8`, `Y0`–`Y8`).
