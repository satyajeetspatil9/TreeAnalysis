import { getIrrigationZoneCode, getIrrigationZoneId } from './schema';
import { evaluateSoilStandard, getLatestObservationByTree, getLowNutrientsFromObservation, getSoilStandard } from './soil';
import { getRadarDisplayModel } from './satelliteMonsoon';
import { loadCachedGpsAnalysis, parseCachedAnalysis } from './treeGpsSatelliteCache';
import { formatFertilizerProductLines, kolkataDateKey } from './fertilizerEventMaintenance';
import { resolveEventWaterLiters } from './irrigation';
import { loadFarmTrees, loadFarmZoneIds } from './farmScope';
import { getTreeDisplayId } from './formatters';
import { MOISTURE_PERCENT_ADEQUATE_MIN, MOISTURE_PERCENT_ADEQUATE_MAX } from './soilSensorMoisture';

export const BRIEFING_DAYS = 14;

export function briefingWindow(now = new Date(), days = BRIEFING_DAYS) {
  const end = new Date(now);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    days,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startDate: start.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    endDate: end.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
  };
}

function inWindow(dateValue, window) {
  const key = kolkataDateKey(dateValue);
  if (!key) return false;
  return key >= window.startDate && key <= window.endDate;
}

function moistureBand(percent) {
  return evaluateSoilStandard(getSoilStandard('moisture_percent'), percent);
}

function radarFlags(model) {
  const anomaly = String(model?.anomalyStatus || '').toLowerCase();
  const wetness = String(model?.wetnessStatus || '').toLowerCase();
  return {
    drierThanUsual: anomaly.includes('drier'),
    wetterThanUsual: anomaly.includes('wetter'),
    veryHigh: wetness.includes('very high'),
    veryDry: wetness.includes('very dry') || wetness === 'dry',
    wetnessLabel: model?.wetnessStatus || null,
    anomalyLabel: model?.anomalyStatus || null,
    fromPriorWeek: Boolean(model?.fromPriorWeek),
  };
}

function ndviLooksLow(analysis) {
  const status = String(analysis?.index_status?.NDVI || analysis?.index_status?.ndvi || '').toLowerCase();
  return status.includes('very low') || status === 'low';
}

export function buildTreeVerdicts(treeSnap, { neighborLowShare = null } = {}) {
  const verdicts = [];
  const moist = treeSnap.moistureStatus?.status;
  const radar = treeSnap.radar || {};
  const irrigated = Boolean(treeSnap.irrigationThisWeek);
  const rain = Number(treeSnap.climate?.rainMm) || 0;

  if (irrigated && moist === 'low' && neighborLowShare != null && neighborLowShare < 0.4) {
    verdicts.push({
      severity: 'warning',
      work: 'walk',
      text: `Zone ${treeSnap.zoneCode} was watered this week but this tree’s probe is still low while neighbours look OK. Check the dripper or pressure at this plant — not more zone liters.`,
    });
  } else if (irrigated && moist === 'low') {
    verdicts.push({
      severity: 'warning',
      work: 'walk',
      text: `Zone ${treeSnap.zoneCode} was watered this week but the probe is still low. Confirm the emitter is open before lengthening the program.`,
    });
  }

  if (!irrigated && moist === 'low' && (radar.drierThanUsual || radar.veryDry)) {
    verdicts.push({
      severity: 'warning',
      work: 'irrigate',
      text: 'No irrigation event this week, probe is low, and radar looks drier than usual. Check that the zone program ran.',
    });
  }

  if (irrigated && (moist === 'high' || radar.veryHigh) && rain > 0) {
    verdicts.push({
      severity: 'info',
      work: 'skip',
      text: 'Watered, probe/radar still wet, and rain fell. Skip the next run. Wet soil plus rain raises disease risk — do not add irrigation.',
    });
  } else if (moist === 'high' || radar.veryHigh) {
    verdicts.push({
      severity: 'info',
      work: 'skip',
      text: 'Ground is already wet. Hold extra irrigation until the probe is back in the adequate band.',
    });
  }

  if (treeSnap.fertigationThisWeek && (treeSnap.nutrientLows || []).length && moist !== 'low') {
    verdicts.push({
      severity: 'info',
      work: 'fertilizer',
      text: `Fertigation ran this week but ${treeSnap.nutrientLows.map((n) => n.label).join(', ')} still read low on the last soil test. Give 2–4 weeks, or review rate — not only water.`,
    });
  }

  if (treeSnap.growthFlat && moist !== 'low' && treeSnap.ndviLow) {
    verdicts.push({
      severity: 'info',
      work: 'inspect',
      text: 'Growth is flat, moisture is not low, and canopy greenness is weak. Look at soil nutrients and disease, not only irrigation.',
    });
  }

  if (treeSnap.diseaseThisWeek && (moist === 'high' || radar.veryHigh || rain > 0)) {
    verdicts.push({
      severity: 'warning',
      work: 'disease',
      text: 'Disease logged in a wet week. Follow the Climate spray window; do not add irrigation.',
    });
  }

  if (!verdicts.length) {
    verdicts.push({
      severity: 'success',
      work: null,
      text: 'No strong conflict this week among water, moisture, radar, soil, growth, and disease. Use the cards below; radar is a patch signal, not proof this emitter opened.',
    });
  }

  return verdicts;
}

function summarizeClimate(weatherRows, window) {
  let rainMm = 0;
  let last = null;
  (weatherRows || []).forEach((row) => {
    if (!inWindow(row.observed_at, window)) return;
    const rain = Number(row.rainfall_mm);
    if (Number.isFinite(rain) && rain > 0) rainMm += rain;
    if (!last || String(row.observed_at) > String(last.observed_at)) last = row;
  });
  return {
    rainMm: Math.round(rainMm * 10) / 10,
    temperatureC: last?.temperature_c != null ? Number(last.temperature_c) : null,
    humidityPercent: last?.humidity_percent != null ? Number(last.humidity_percent) : null,
    lastAt: last?.observed_at || null,
  };
}

async function loadZoneEvents(supabase, zoneIds, window) {
  if (!zoneIds.length) {
    return { irrigation: [], fertigation: [] };
  }
  const [{ data: irrigation }, fertResult] = await Promise.all([
    supabase
      .from('irrigation_events')
      .select('id, zone_id, event_date, duration_minutes, water_liters, flow_rate_lph, started_at, ended_at, irrigation_zones(zone_code, flow_rate_lph)')
      .in('zone_id', zoneIds)
      .gte('event_date', window.startDate)
      .order('event_date', { ascending: false })
      .limit(200),
    supabase
      .from('fertigation_events')
      .select('id, zone_id, event_date, duration_minutes, notes, fertigation_products(quantity, unit, products(name))')
      .in('zone_id', zoneIds)
      .gte('event_date', window.startDate)
      .order('event_date', { ascending: false })
      .limit(100),
  ]);

  let fertigation = fertResult.data;
  if (fertResult.error && /fertigation_products/.test(fertResult.error.message || '')) {
    const fallback = await supabase
      .from('fertigation_events')
      .select('id, zone_id, event_date, duration_minutes, notes')
      .in('zone_id', zoneIds)
      .gte('event_date', window.startDate)
      .order('event_date', { ascending: false })
      .limit(100);
    fertigation = fallback.data;
  }

  return { irrigation: irrigation || [], fertigation: fertigation || [] };
}

function satelliteFromCacheRow(row) {
  if (!row) return { radar: {}, ndviLow: false, analysis: null };
  const analysis = parseCachedAnalysis(row.analysis);
  const model = getRadarDisplayModel(
    analysis,
    parseCachedAnalysis(row.last_good_radar),
    row.last_good_radar_week,
  );
  return {
    analysis,
    radar: radarFlags(model),
    ndviLow: ndviLooksLow(analysis),
    weekStart: row.week_start || null,
  };
}

function buildTreeSnap({
  tree,
  zoneCode,
  zoneId,
  soil,
  irrigationEvents,
  fertigationEvents,
  satellite,
  climate,
  growthRows,
  diseaseRows,
  window,
}) {
  const moisture = soil?.moisture_percent != null ? Number(soil.moisture_percent) : null;
  const moistureStatus = moistureBand(moisture);
  const weekIrrigation = (irrigationEvents || []).filter((e) => inWindow(e.event_date, window));
  const weekFertigation = (fertigationEvents || []).filter((e) => inWindow(e.event_date, window));
  const latestIrrigation = weekIrrigation[0] || irrigationEvents?.[0] || null;
  const latestFertigation = weekFertigation[0] || fertigationEvents?.[0] || null;
  const sortedGrowth = [...(growthRows || [])].sort(
    (a, b) => String(b.measurement_date).localeCompare(String(a.measurement_date)),
  );
  const latestGrowth = sortedGrowth[0] || null;
  const priorGrowth = sortedGrowth[1] || null;
  let growthFlat = false;
  if (latestGrowth?.height_cm != null && priorGrowth?.height_cm != null) {
    growthFlat = Math.abs(Number(latestGrowth.height_cm) - Number(priorGrowth.height_cm)) < 2;
  }
  const diseaseThisWeek = (diseaseRows || []).some((row) => inWindow(row.observed_at, window));

  return {
    treeId: tree.id,
    positionCode: tree.tree_positions?.position_code || getTreeDisplayId(tree),
    variety: tree.variety,
    zoneId,
    zoneCode: zoneCode || '—',
    window,
    climate,
    soil,
    moisture,
    moistureStatus,
    moistureAdequate: `${Math.round(MOISTURE_PERCENT_ADEQUATE_MIN)}–${Math.round(MOISTURE_PERCENT_ADEQUATE_MAX)}%`,
    irrigationThisWeek: weekIrrigation.length > 0,
    fertigationThisWeek: weekFertigation.length > 0,
    latestIrrigation,
    irrigationLiters: resolveEventWaterLiters(latestIrrigation),
    latestFertigation,
    fertigationProducts: formatFertilizerProductLines(latestFertigation?.fertigation_products),
    radar: satellite.radar,
    ndviLow: satellite.ndviLow,
    satelliteWeek: satellite.weekStart,
    nutrientLows: getLowNutrientsFromObservation(soil),
    growth: latestGrowth,
    priorGrowth,
    growthFlat,
    diseaseThisWeek,
    diseases: diseaseRows || [],
  };
}

export async function loadTreeWeekBriefing(supabase, { farmId, tree }) {
  const window = briefingWindow();
  const zoneId = getIrrigationZoneId(tree);
  const zoneCode = getIrrigationZoneCode(tree);
  const positionId = tree.tree_positions?.id;

  const [
    { data: soil },
    zoneEvents,
    satelliteCache,
    { data: weather },
    { data: growthRows },
    { data: diseaseRows },
  ] = await Promise.all([
    supabase
      .from('soil_observations')
      .select('*')
      .eq('tree_id', tree.id)
      .order('observed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    zoneId
      ? loadZoneEvents(supabase, [zoneId], window)
      : Promise.resolve({ irrigation: [], fertigation: [] }),
    positionId
      ? loadCachedGpsAnalysis(supabase, positionId)
      : Promise.resolve({ analysis: null, cache: null }),
    farmId
      ? supabase
        .from('weather_observations')
        .select('observed_at, rainfall_mm, temperature_c, humidity_percent')
        .eq('farm_id', farmId)
        .gte('observed_at', window.startIso)
        .order('observed_at', { ascending: false })
        .limit(40)
      : Promise.resolve({ data: [] }),
    supabase
      .from('tree_growth')
      .select('height_cm, girth_cm, measurement_date')
      .eq('tree_id', tree.id)
      .order('measurement_date', { ascending: false })
      .limit(2),
    supabase
      .from('disease_observations')
      .select('id, problem_type, problem_category, severity, observed_at')
      .eq('tree_id', tree.id)
      .order('observed_at', { ascending: false })
      .limit(10),
  ]);

  const satellite = satelliteFromCacheRow(satelliteCache.cache || {
    analysis: satelliteCache.analysis,
    last_good_radar: satelliteCache.lastGoodRadar,
    last_good_radar_week: satelliteCache.lastGoodRadarWeek,
    week_start: satelliteCache.weekStart,
  });
  const climate = summarizeClimate(weather, window);
  const snap = buildTreeSnap({
    tree,
    zoneCode,
    zoneId,
    soil,
    irrigationEvents: zoneEvents.irrigation,
    fertigationEvents: zoneEvents.fertigation,
    satellite,
    climate,
    growthRows,
    diseaseRows,
    window,
  });

  let neighborLowShare = null;
  if (farmId && zoneId) {
    const { data: links } = await supabase
      .from('tree_irrigation_zones')
      .select('tree_id')
      .eq('zone_id', zoneId)
      .is('end_date', null)
      .limit(80);
    const neighborIds = (links || []).map((row) => row.tree_id).filter((id) => Number(id) !== Number(tree.id));
    if (neighborIds.length) {
      const { data: neighborSoil } = await supabase
        .from('soil_observations')
        .select('tree_id, moisture_percent, observed_at')
        .in('tree_id', neighborIds)
        .order('observed_at', { ascending: false })
        .limit(200);
      const latest = getLatestObservationByTree(neighborSoil);
      const statuses = Object.values(latest)
        .map((obs) => moistureBand(obs.moisture_percent).status)
        .filter((status) => status && status !== 'unknown');
      if (statuses.length) {
        neighborLowShare = statuses.filter((status) => status === 'low').length / statuses.length;
      }
    }
  }

  snap.verdicts = buildTreeVerdicts(snap, { neighborLowShare });
  snap.satelliteError = satelliteCache.error || null;
  return snap;
}

export async function loadFarmWeekBriefing(supabase, farmId) {
  const window = briefingWindow();
  if (!farmId) {
    return { window, climate: summarizeClimate([], window), counts: {}, zones: [], exceptions: [], workList: [], trees: 0 };
  }

  const TREE_SELECT = `
    id, variety, status,
    tree_positions ( id, position_code ),
    tree_irrigation_zones ( zone_id, end_date, irrigation_zones ( id, zone_code ) )
  `;

  const trees = await loadFarmTrees(supabase, farmId, { select: TREE_SELECT });
  const treeIds = trees.map((t) => t.id);
  const zoneIds = await loadFarmZoneIds(supabase, farmId);
  const positionIds = trees.map((t) => t.tree_positions?.id).filter(Boolean);

  const [
    { data: zones },
    zoneEvents,
    { data: weather },
    { data: soilRows },
    { data: diseaseRows },
    { data: growthRows },
    cacheResult,
  ] = await Promise.all([
    supabase.from('irrigation_zones').select('id, zone_code, flow_rate_lph').eq('farm_id', farmId).order('zone_code'),
    loadZoneEvents(supabase, zoneIds, window),
    supabase
      .from('weather_observations')
      .select('observed_at, rainfall_mm, temperature_c, humidity_percent')
      .eq('farm_id', farmId)
      .gte('observed_at', window.startIso)
      .order('observed_at', { ascending: false })
      .limit(40),
    treeIds.length
      ? supabase
        .from('soil_observations')
        .select('tree_id, moisture_percent, ph, ec, nitrogen, phosphorus, potassium, observed_at')
        .in('tree_id', treeIds)
        .order('observed_at', { ascending: false })
        .limit(800)
      : Promise.resolve({ data: [] }),
    treeIds.length
      ? supabase
        .from('disease_observations')
        .select('id, tree_id, problem_type, severity, observed_at, trees(tree_positions(position_code))')
        .in('tree_id', treeIds)
        .gte('observed_at', window.startDate)
        .order('observed_at', { ascending: false })
        .limit(100)
      : Promise.resolve({ data: [] }),
    treeIds.length
      ? supabase
        .from('tree_growth')
        .select('tree_id, height_cm, measurement_date')
        .in('tree_id', treeIds)
        .order('measurement_date', { ascending: false })
        .limit(400)
      : Promise.resolve({ data: [] }),
    positionIds.length
      ? supabase
        .from('tree_gps_satellite_cache')
        .select('position_id, analysis, last_good_radar, last_good_radar_week, week_start')
        .in('position_id', positionIds)
      : Promise.resolve({ data: [] }),
  ]);

  const climate = summarizeClimate(weather, window);
  const soilByTree = getLatestObservationByTree(soilRows);
  const cacheByPosition = new Map(
    (cacheResult.error ? [] : (cacheResult.data || [])).map((row) => [Number(row.position_id), row]),
  );
  const growthByTree = new Map();
  (growthRows || []).forEach((row) => {
    const list = growthByTree.get(Number(row.tree_id)) || [];
    if (list.length < 2) list.push(row);
    growthByTree.set(Number(row.tree_id), list);
  });
  const diseaseByTree = new Map();
  (diseaseRows || []).forEach((row) => {
    const list = diseaseByTree.get(Number(row.tree_id)) || [];
    list.push(row);
    diseaseByTree.set(Number(row.tree_id), list);
  });

  const irrigByZone = new Map();
  (zoneEvents.irrigation || []).forEach((event) => {
    const list = irrigByZone.get(Number(event.zone_id)) || [];
    list.push(event);
    irrigByZone.set(Number(event.zone_id), list);
  });
  const fertByZone = new Map();
  (zoneEvents.fertigation || []).forEach((event) => {
    const list = fertByZone.get(Number(event.zone_id)) || [];
    list.push(event);
    fertByZone.set(Number(event.zone_id), list);
  });

  const snaps = trees.map((tree) => {
    const zoneId = getIrrigationZoneId(tree);
    const satellite = satelliteFromCacheRow(cacheByPosition.get(Number(tree.tree_positions?.id)));
    return buildTreeSnap({
      tree,
      zoneCode: getIrrigationZoneCode(tree),
      zoneId,
      soil: soilByTree[tree.id] || soilByTree[String(tree.id)],
      irrigationEvents: irrigByZone.get(Number(zoneId)) || [],
      fertigationEvents: fertByZone.get(Number(zoneId)) || [],
      satellite,
      climate,
      growthRows: growthByTree.get(Number(tree.id)) || [],
      diseaseRows: diseaseByTree.get(Number(tree.id)) || [],
      window,
    });
  });

  const byZone = new Map();
  snaps.forEach((snap) => {
    if (!snap.zoneId) return;
    const list = byZone.get(Number(snap.zoneId)) || [];
    list.push(snap);
    byZone.set(Number(snap.zoneId), list);
  });
  snaps.forEach((snap) => {
    const peers = byZone.get(Number(snap.zoneId)) || [];
    const statuses = peers
      .filter((peer) => Number(peer.treeId) !== Number(snap.treeId))
      .map((peer) => peer.moistureStatus?.status)
      .filter((status) => status && status !== 'unknown');
    const neighborLowShare = statuses.length
      ? statuses.filter((status) => status === 'low').length / statuses.length
      : null;
    snap.verdicts = buildTreeVerdicts(snap, { neighborLowShare });
  });

  const zoneRows = (zones || []).map((zone) => {
    const events = irrigByZone.get(Number(zone.id)) || [];
    const ferts = fertByZone.get(Number(zone.id)) || [];
    const liters = events.reduce((sum, event) => sum + (Number(resolveEventWaterLiters(event)) || 0), 0);
    const treesInZone = snaps.filter((snap) => Number(snap.zoneId) === Number(zone.id));
    const probeLow = treesInZone.filter((snap) => snap.moistureStatus?.status === 'low').length;
    return {
      zoneId: zone.id,
      zoneCode: zone.zone_code,
      treeCount: treesInZone.length,
      irrigationCount: events.length,
      waterLiters: liters > 0 ? liters : null,
      fertigation: ferts.length > 0,
      probeLow,
      lastIrrigation: events[0]?.event_date || null,
    };
  });

  const exceptions = snaps.filter((snap) => {
    const dripper = snap.verdicts.some((v) => v.work === 'walk');
    const dryMiss = snap.verdicts.some((v) => v.work === 'irrigate');
    const diseaseWet = snap.verdicts.some((v) => v.work === 'disease');
    const radarDryLow = snap.radar?.drierThanUsual && snap.moistureStatus?.status === 'low';
    return dripper || dryMiss || diseaseWet || radarDryLow || snap.diseaseThisWeek;
  }).slice(0, 40);

  const workList = [];
  const walkZones = [...new Set(snaps.filter((s) => s.verdicts.some((v) => v.work === 'walk')).map((s) => s.zoneCode))];
  if (walkZones.length) {
    workList.push(`Walk emitters on ${walkZones.join(', ')} — zone water ran but some probes stayed low.`);
  }
  zoneRows.filter((z) => z.treeCount > 0 && z.irrigationCount === 0).forEach((z) => {
    workList.push(`No irrigation event this week on ${z.zoneCode}. Check the program if probes are low.`);
  });
  if (climate.rainMm > 0 && snaps.some((s) => s.moistureStatus?.status === 'high' || s.radar?.veryHigh)) {
    workList.push('Rain plus wet ground: skip extra irrigation; use Climate for spray, not more water.');
  }
  if (snaps.some((s) => s.verdicts.some((v) => v.work === 'fertilizer'))) {
    workList.push('Fertigate only where moisture is not high; some trees still show low nutrients after fertigation.');
  }
  if (!workList.length) {
    workList.push('No urgent conflicts. Keep weekly emitter walks; radar will not show a single clogged dripper.');
  }

  const counts = {
    trees: snaps.length,
    radarDrier: snaps.filter((s) => s.radar?.drierThanUsual).length,
    probeLow: snaps.filter((s) => s.moistureStatus?.status === 'low').length,
    zonesNoIrrigation: zoneRows.filter((z) => z.treeCount > 0 && z.irrigationCount === 0).length,
    disease: (diseaseRows || []).length,
    rainMm: climate.rainMm,
  };

  return {
    window,
    climate,
    counts,
    zones: zoneRows,
    exceptions,
    workList,
    trees: snaps.length,
  };
}
