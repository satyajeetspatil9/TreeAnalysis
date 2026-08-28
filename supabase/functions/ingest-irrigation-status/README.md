# ingest-irrigation-status

POST live irrigation controller readings for a drip zone. GET pending commands (legacy + queue).

## Deploy

```bash
supabase functions deploy ingest-irrigation-status --no-verify-jwt
```

## Auth

Same farm ingest key as soil sensors: header `x-api-key: ta_...`

## Body (telemetry)

```json
{
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
  "device_code": "ESP32-IRR-01",
  "ack_command": true,
  "command_id": 12
}
```

`zone_code` must match `irrigation_zones.zone_code` for the farm tied to the API key.

Ack a non-zone device command:

```json
{ "ack_only": true, "command_id": 15 }
```

## Poll start/stop commands

```bash
curl -H "x-api-key: ta_YOUR_KEY" \
  "https://YOUR_PROJECT.supabase.co/functions/v1/ingest-irrigation-status"
```

Returns:

```json
{
  "ok": true,
  "updated_at": "...",
  "commands": [
    {
      "id": 1,
      "device_code": "ZONE-Z01",
      "action": "start",
      "job_id": 12,
      "zone_code": "Z01",
      "until": { "liters": 6000 }
    }
  ],
  "pending_commands": [
    { "zone_code": "Z01", "command": "start" }
  ]
}
```

Prefer `commands` (farm-wide queue from migration 039). `pending_commands` remains for older controllers.

After acting, POST telemetry with `"ack_command": true` (and optional `command_id`).

## Migrations

- `037_irrigation_zone_status.sql`
- `038_irrigation_zone_commands.sql`
- `039_irrigation_schedule_control.sql`
