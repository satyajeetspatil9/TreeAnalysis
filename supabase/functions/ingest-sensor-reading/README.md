# ESP32 sensor ingest — deploy & test

## 1. Apply SQL migrations

Run in Supabase SQL Editor:

- `031_farm_ingest_keys.sql`
- `032_create_ingest_key_helper.sql`

Create a key:

```sql
SELECT public.create_farm_ingest_key(1, 'ESP32');
```

Copy the returned `ta_...` value.

## 2. Disable JWT check (required)

Supabase validates `Authorization` **before** your function runs. Ingest keys are **not** JWTs.

This repo sets `verify_jwt = false` in `supabase/config.toml`.

Deploy:

```powershell
cd f:\tryouts\TreeAnalysis
supabase login
supabase link --project-ref jzgfeqiboxrhjnvwxywh
supabase functions deploy ingest-sensor-reading
```

### If you still get `Invalid JWT`

The platform flag may not have updated. Disable manually:

1. Supabase Dashboard → **Edge Functions** → `ingest-sensor-reading`
2. Turn off **Enforce JWT Verification** / **Verify JWT** (wording varies)
3. Save

Or redeploy with explicit flag:

```powershell
supabase functions deploy ingest-sensor-reading --no-verify-jwt
```

## 3. Test (Windows CMD — one line, no Authorization header)

```cmd
curl -X POST "https://jzgfeqiboxrhjnvwxywh.supabase.co/functions/v1/ingest-sensor-reading" -H "Content-Type: application/json" -H "x-api-key: ta_YOUR_KEY_HERE" -d "{\"position_code\":\"A-R01-L01-T01\",\"moisture_percent\":45,\"ph\":6.8,\"ec\":0.52,\"temperature_c\":28.5,\"nitrogen\":350,\"phosphorus\":18,\"potassium\":200}"
```

**Do not** put the ingest key in `Authorization: Bearer ...` — Supabase treats that as a JWT and returns `Invalid JWT`.

## 4. ESP32 headers

```text
Content-Type: application/json
x-api-key: ta_YOUR_KEY_HERE
```

## Expected responses

| Response | Meaning |
|----------|---------|
| `{"ok":true,...}` | Success |
| `Invalid JWT` | JWT verification still ON in Dashboard — disable it |
| `Missing authorization header` | Old curl without headers; use one-line command |
| `Invalid or revoked API key` | Key not in DB — run `create_farm_ingest_key` |
| `No active tree found` | No Active tree at that position code |
