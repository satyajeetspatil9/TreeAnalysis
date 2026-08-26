# ingest-irrigation-status

POST live irrigation controller readings for a drip zone.

## Deploy

```bash
supabase functions deploy ingest-irrigation-status --no-verify-jwt
```

## Auth

Same farm ingest key as soil sensors: header `x-api-key: ta_...`

## Body

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
  "device_code": "ESP32-IRR-01"
}
```

`zone_code` must match `irrigation_zones.zone_code` for the farm tied to the API key.

## Migration

Run `037_irrigation_zone_status.sql` before first ingest.
