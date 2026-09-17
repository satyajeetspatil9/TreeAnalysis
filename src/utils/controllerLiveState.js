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

function parseTime(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowTime(row) {
  return parseTime(row?.recordedAtIst) || parseTime(row?.recordedEpoch);
}

function parseIstClockOnDate(clock, isoDate) {
  const hhmm = String(clock || '').trim();
  const day = String(isoDate || '').slice(0, 10);
  if (!/^\d{1,2}:\d{2}$/.test(hhmm) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [hh, mm] = hhmm.split(':').map(Number);
  const date = new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWateringState(state) {
  const text = String(state || '').toUpperCase();
  return text.includes('WATERING') || text.includes('ENDING');
}

/** Newest-first history: pin-off is the oldest ALL QUIET in the current quiet streak, not the latest poll. */
function lastRunFromHistory(history) {
  const rows = history || [];
  if (!rows.length) {
    return { startRow: null, stopRow: null, wateringNow: false };
  }
  const wateringNow = isWateringState(rows[0].heroState);
  let i = 0;
  if (!wateringNow) {
    while (i < rows.length && !isWateringState(rows[i].heroState)) i += 1;
  }
  const stopRow = wateringNow || i === 0 ? null : rows[i - 1];
  const run = [];
  while (i < rows.length && isWateringState(rows[i].heroState)) {
    run.push(rows[i]);
    i += 1;
  }
  const startRow = run.length ? run[run.length - 1] : null;
  return { startRow, stopRow, wateringNow };
}

function addMinutes(date, minutes) {
  if (!date || !Number.isFinite(Number(minutes))) return null;
  return new Date(date.getTime() + Number(minutes) * 60000);
}

export function formatLagLabel(programTime, controllerTime) {
  if (!programTime || !controllerTime) return '—';
  const minutes = Math.round((controllerTime.getTime() - programTime.getTime()) / 60000);
  if (Math.abs(minutes) < 1) return 'Same minute';
  if (minutes > 0) return `${minutes} min later on controller`;
  return `${-minutes} min earlier on controller`;
}

/** Controller pin on/off from Turso vs program job scheduled/start/complete. */
export function compareProgramAndControllerTimes({
  job,
  live,
  runLimitMinutes = null,
  now = new Date(),
} = {}) {
  const history = live?.history || [];
  const watering = Boolean(live?.watering);
  const { startRow, stopRow } = lastRunFromHistory(history);

  let controllerStart = parseIstClockOnDate(
    live?.startedAt,
    startRow?.recordedAtIst || live?.updatedAtIst,
  );
  controllerStart = rowTime(startRow) || controllerStart;

  let controllerEnd = null;
  let controllerEnded = !watering;
  const runMinutes = Number(startRow?.durationMin);
  if (watering) {
    controllerEnd = live?.minutesLeft != null
      ? addMinutes(now, live.minutesLeft)
      : addMinutes(controllerStart, live?.durationMin || runMinutes);
  } else {
    controllerEnd = rowTime(stopRow);
    if (!controllerEnd && runMinutes > 0) {
      controllerEnd = addMinutes(controllerStart, runMinutes);
    }
    if (!controllerEnd && Number(live?.durationMin) > 0) {
      controllerEnd = addMinutes(controllerStart, live.durationMin);
    }
  }

  const programStartPlanned = parseTime(job?.scheduled_for);
  const programStartActual = parseTime(job?.started_at);
  const programEndActual = parseTime(job?.completed_at);
  const programEndPlanned = programEndActual
    || addMinutes(programStartActual || programStartPlanned, runLimitMinutes);

  return {
    programStartPlanned,
    programStartActual,
    programEndPlanned,
    programEndActual,
    controllerStart,
    controllerEnd,
    controllerEnded,
    startLagVsPlanned: formatLagLabel(programStartPlanned, controllerStart),
    startLagVsJob: formatLagLabel(programStartActual, controllerStart),
    endLagVsPlanned: formatLagLabel(programEndPlanned, controllerEnd),
    endLagVsJob: formatLagLabel(programEndActual, controllerEnd),
  };
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
