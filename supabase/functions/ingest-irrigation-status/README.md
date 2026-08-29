# ingest-irrigation-status

POST live irrigation controller readings. GET pending commands.

The controller acts only on **device codes** (terminals such as `Y0`–`Y8`). `zone_code` is optional display.

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
  "device_code": "Y0",
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
  "ack_command": true,
  "command_id": 12
}
```

Ack a command without zone telemetry:

```json
{ "ack_only": true, "command_id": 15 }
```

## Poll start/stop commands

```bash
curl -H "x-api-key: ta_YOUR_KEY" \
  "https://YOUR_PROJECT.supabase.co/functions/v1/ingest-irrigation-status"
```

Returns one command per job so selected terminals start and stop together:

```json
{
  "ok": true,
  "updated_at": "...",
  "commands": [
    {
      "id": 1,
      "device_code": "Y0",
      "device_codes": ["Y0", "Y1", "Y2"],
      "action": "start",
      "job_id": 12,
      "zone_code": "Z01",
      "until": { "minutes": 20 }
    }
  ],
  "pending_commands": [
    { "zone_code": "Z01", "command": "start" }
  ]
}
```

Turn **all** `device_codes` on or off at the same time. `device_code` is the first terminal (compat). `zone_code` is visualization only.

After acting, POST with `"ack_command": true` and the `command_id`.

## Migrations

- `037_irrigation_zone_status.sql`
- `038_irrigation_zone_commands.sql`
- `039_irrigation_schedule_control.sql`
