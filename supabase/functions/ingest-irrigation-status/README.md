# ingest-irrigation-status

POST live irrigation controller readings and mains power. GET pending commands.

The controller acts only on **device codes** (terminals `X0`–`X8` inputs, `Y0`–`Y8` outputs).
`zone_code` is display only and must never be used to pick a pin.

## Deploy

```bash
supabase functions deploy ingest-irrigation-status --no-verify-jwt
```

## Auth

Same farm ingest key as soil sensors: header `x-api-key: ta_...`

## Body (telemetry)

Identify the zone with a Devices `device_code` (preferred) and/or `zone_code` (LCD only).

```json
{
  "device_code": "Y2",
  "zone_code": "Z01",
  "is_irrigating": true,
  "started_at": "2026-08-26T09:00:00+05:30",
  "reported_at": "2026-08-26T09:15:00+05:30",
  "voltage_v": 230,
  "current_amp": 4.2,
  "start_indicator": true,
  "stop_indicator": false,
  "current_discharge_lpm": 12.5,
  "total_discharge_liters": 450,
  "power_present": true,
  "ack_command": true,
  "command_id": 12
}
```

### Mains power

`power_present` is farm-wide and accepted on **any** POST, including a bare heartbeat with
nothing else in it:

```json
{ "power_present": false }
```

`power`, `mains`, `electricity`, and `power_available` are accepted as aliases, as are the
strings `"on"` / `"off"` / `"present"` / `"absent"`.

While power is absent the scheduler stops and pauses every running job
(`status = paused_no_power`), creates no new jobs, and leaves other schedules alone. When
`power_present` turns true again the paused jobs resume with their delivered litres and
elapsed minutes intact, and scheduled devices are switched back on. Nothing needs to be
re-armed by hand.

Ack a command without zone telemetry (motors, injectors, scheduled devices):

```json
{ "ack_only": true, "command_id": 15 }
```

`{ "ack_only": true, "device_code": "Y0" }` also works when the id was lost.

## Poll start/stop commands

```bash
curl -H "x-api-key: ta_YOUR_KEY" \
  "https://YOUR_PROJECT.supabase.co/functions/v1/ingest-irrigation-status"
```

**One command per terminal**, each with its own stop rule:

```json
{
  "ok": true,
  "updated_at": "2026-08-31T00:30:02.000Z",
  "power_present": true,
  "power_reported_at": "2026-08-31T00:29:41.000Z",
  "commands": [
    {
      "id": 101,
      "device_code": "Y0",
      "device_codes": ["Y0"],
      "action": "start",
      "job_id": 12,
      "zone_code": null,
      "until": { "minutes": 90 },
      "payload": { "device_codes": ["Y0"], "until": { "minutes": 90 }, "role": "irrigation_motor" }
    },
    {
      "id": 102,
      "device_code": "Y2",
      "device_codes": ["Y2"],
      "action": "start",
      "job_id": 12,
      "zone_code": "Z01",
      "until": { "liters": 3000, "minutes": 90 }
    },
    {
      "id": 103,
      "device_code": "Y4",
      "device_codes": ["Y4"],
      "action": "start",
      "job_id": null,
      "until": { "minutes": 480 }
    }
  ],
  "pending_commands": [
    { "zone_code": "Z01", "command": "start" }
  ]
}
```

Rules for firmware:

- Switch `device_code` for `action`. One row, one pin.
- Stop that pin when **its own** `until` is met. `liters` is only sent to the metered zone
  valve; pumps, injectors, and scheduled devices get `minutes`. When both are present, stop
  at whichever comes first.
- `minutes` counts from when you actually switch the pin, not from `created_at`.
- `until` may be absent (manual Now-tab control). Then hold until a `stop` arrives.
- `device_codes` is always a single-element array, kept for older builds.
- `zone_code` is for the display only.
- An empty `commands` array means keep doing what you are doing.

After acting, POST with `"ack_command": true` and the `command_id`. Unacked rows expire
after 30 minutes and are never retried, so the pin's own `until` is the real safety net.

## Migrations

- `037_irrigation_zone_status.sql`
- `038_irrigation_zone_commands.sql`
- `039_irrigation_schedule_control.sql`
- `043_irrigation_job_duration.sql`
- `044_irrigation_event_notes.sql`
- `045_irrigation_power_and_per_pin.sql`
