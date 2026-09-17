# controller-live-state

Reads the ESP32 Turso snapshot (`lilygo_live_state`) written by
TreeESP32Controller every 15 seconds. The web Irrigation Now / Programs tabs
use this so hardware pins match the orchard UI.

## Secrets

Same URL and token as `TreeESP32Controller/include/secrets.h` (or NVS `PROV`):

```bash
supabase secrets set TURSO_DATABASE_URL="https://YOUR-DB.turso.io"
supabase secrets set TURSO_AUTH_TOKEN="YOUR_TOKEN"
supabase functions deploy controller-live-state --no-verify-jwt
```

Do not put the Turso token in the React app.

## GET

`/functions/v1/controller-live-state`

Returns `{ ok, configured, live }` where `live.onChannels` is `Y0`–`Y7` currently on.
