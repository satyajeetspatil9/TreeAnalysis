export function programMatchesController(program, devices, live) {
  if (!live?.onChannels?.length || !program) return false;
  const on = new Set(live.onChannels.map((code) => String(code).toUpperCase()));
  const codes = new Set();
  const byId = new Map((devices || []).map((device) => [Number(device.id), device]));

  (program.motor_device_ids || []).forEach((id) => {
    const code = byId.get(Number(id))?.device_code;
    if (code) codes.add(String(code).toUpperCase());
  });
  (program.irrigation_program_devices || []).forEach((row) => {
    const code = byId.get(Number(row.device_id))?.device_code;
    if (code) codes.add(String(code).toUpperCase());
  });
  (program.irrigation_program_steps || []).forEach((step) => {
    const valve = (devices || []).find((device) => (
      device.kind === 'zone_valve' && Number(device.zone_id) === Number(step.zone_id)
    ));
    if (valve?.device_code) codes.add(String(valve.device_code).toUpperCase());
  });

  return [...codes].some((code) => on.has(code));
}

export function controllerHeadline(live) {
  const raw = String(live?.heroState || '').trim();
  if (!raw) return live?.watering ? 'Watering now' : 'No watering';
  return raw.charAt(0) + raw.slice(1).toLowerCase();
}

export async function fetchControllerLiveState(supabaseClient) {
  const base = process.env.REACT_APP_SUPABASE_URL;
  const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!base || !anon) {
    return { live: null, configured: false, error: 'Supabase URL missing.' };
  }
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const token = sessionData?.session?.access_token || anon;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/functions/v1/controller-live-state`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        live: null,
        configured: body.configured !== false,
        error: body.error || `HTTP ${response.status}`,
      };
    }
    return {
      live: body.live || null,
      configured: body.configured !== false,
      error: body.error || null,
    };
  } catch (error) {
    return { live: null, configured: true, error: error.message };
  }
}
