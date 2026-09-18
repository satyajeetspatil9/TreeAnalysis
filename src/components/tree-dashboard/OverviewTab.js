import React, { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Grid, Paper, Typography, Box, CircularProgress, Alert, Button, Chip } from '@mui/material';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import { formatDate, formatNumber, formatNumberSmart } from '../../utils/formatters';
import { formatWaterLiters } from '../../utils/irrigation';
import { evaluateSoilStandard, getSoilStandard, soilStatusBadgeSx, soilStatusColor } from '../../utils/soil';
import { loadTreeSprayAdvice, loadTreeWeekBriefing } from '../../utils/orchardBriefing';
import HealthIndicator from '../common/HealthIndicator';

function SummaryCard({ label, value, status, to }) {
  const body = (
    <Paper sx={{ p: 2, textAlign: 'center', height: '100%' }} variant="outlined">
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, mt: 0.5 }}>
        {status?.label && (
          <Typography component="span" sx={soilStatusBadgeSx(status.status)}>
            {status.label}
          </Typography>
        )}
        <Typography
          variant="h6"
          sx={{ fontWeight: 700, color: status?.status ? soilStatusColor(status.status) : undefined }}
        >
          {value}
        </Typography>
      </Box>
    </Paper>
  );
  if (!to) return body;
  return (
    <Box component={RouterLink} to={to} sx={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
      {body}
    </Box>
  );
}

function OverviewTab({ tree, zoneCode }) {
  const { farm } = useFarm();
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const position = tree.tree_positions;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const snap = await loadTreeWeekBriefing(supabase, { farmId: farm?.id, tree });
        if (cancelled) return;
        setBriefing(snap);
        setLoading(false);
        const sprayAdvice = await loadTreeSprayAdvice(supabase, { farmId: farm?.id, tree });
        if (!cancelled && sprayAdvice) {
          setBriefing((current) => (current ? { ...current, sprayAdvice } : current));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tree, farm?.id]);

  if (loading) return <CircularProgress size={24} />;

  const lat = position?.latitude;
  const lng = position?.longitude;
  const moistureStatus = briefing?.moistureStatus
    || evaluateSoilStandard(getSoilStandard('moisture_percent'), briefing?.moisture);
  const window = briefing?.window;
  const primaryVerdict = briefing?.verdicts?.[0];

  return (
    <Box>
      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Tree Overview</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {lat != null && lng != null ? (
            <Typography>📍 GPS: {formatNumber(lat, 5)}, {formatNumber(lng, 5)}</Typography>
          ) : (
            <Typography color="warning.main">📍 GPS not set — edit tree to add coordinates</Typography>
          )}
          <Typography>🌱 {tree.variety}</Typography>
          <Typography>📅 Planted {formatDate(tree.planting_date)}</Typography>
          {tree.removed_date && <Typography>🪦 Removed {formatDate(tree.removed_date)}</Typography>}
          <Typography>💧 Zone {zoneCode}</Typography>
          <Box sx={{ mt: 1 }}>Status: <HealthIndicator tree={tree} showLabel /></Box>
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {briefing && (
        <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            This week
            {window ? ` · ${formatDate(window.startDate)} – ${formatDate(window.endDate)}` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Moisture, satellite, soil, irrigation, fertigation, climate, growth, and disease for this tree in one story.
            Radar is a ground patch, not proof this emitter opened.
          </Typography>
          {briefing.sprayAdvice && (
            <Alert
              severity={briefing.sprayAdvice.type === 'SPRAY' ? 'warning' : 'success'}
              sx={{ mb: 1 }}
            >
              {briefing.sprayAdvice.message}
              {' '}
              <Button size="small" component={RouterLink} to="/orchard/climate">Climate</Button>
            </Alert>
          )}
          {briefing.satelliteError && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              Satellite cache error: {briefing.satelliteError}
            </Alert>
          )}
          {briefing.verdicts?.map((item) => (
            <Alert key={item.text} severity={item.severity === 'success' ? 'success' : item.severity} sx={{ mb: 1 }}>
              {item.text}
            </Alert>
          ))}
          <Grid container spacing={1.5} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2">Climate</Typography>
              <Typography variant="body2">
                Rain {briefing.climate?.rainMm != null ? `${formatNumber(briefing.climate.rainMm, 1)} mm` : '—'}
                {briefing.climate?.temperatureC != null ? ` · ${formatNumber(briefing.climate.temperatureC, 1)} °C` : ''}
              </Typography>
              <Button size="small" component={RouterLink} to="/orchard/climate">Climate</Button>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2">Water (zone {briefing.zoneCode})</Typography>
              <Typography variant="body2">
                {briefing.irrigationThisWeek
                  ? `Irrigated ${formatDate(briefing.latestIrrigation?.event_date)} · ${formatWaterLiters(briefing.irrigationLiters)}`
                  : 'No irrigation event this week'}
              </Typography>
              <Typography variant="body2">
                {briefing.fertigationThisWeek
                  ? `Fertigation ${formatDate(briefing.latestFertigation?.event_date)} · ${briefing.fertigationProducts}`
                  : 'No fertigation this week'}
              </Typography>
              <Button size="small" component={RouterLink} to="?tab=irrigation">Irrigation tab</Button>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2">Ground</Typography>
              <Typography variant="body2">
                Probe {briefing.moisture != null ? `${formatNumber(briefing.moisture, 0)}%` : '—'}
                {moistureStatus?.label ? ` (${moistureStatus.label}; adequate ${briefing.moistureAdequate})` : ''}
              </Typography>
              <Typography variant="body2">
                Radar {briefing.radar?.wetnessLabel || '—'}
                {briefing.radar?.anomalyLabel ? ` · ${briefing.radar.anomalyLabel}` : ''}
                {briefing.radar?.fromPriorWeek ? ' (earlier pass)' : ''}
              </Typography>
              <Typography variant="body2">
                {briefing.opticalHidden
                  ? 'NDVI hidden — optical is cloudy; radar only this week'
                  : briefing.ndviLow
                    ? 'Canopy greenness (NDVI) looks low'
                    : 'Canopy greenness (NDVI) not flagged low'}
              </Typography>
              <Button size="small" component={RouterLink} to="?tab=soil">Soil</Button>
              <Button size="small" component={RouterLink} to="?tab=satellite">Satellite</Button>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2">Outcome</Typography>
              <Typography variant="body2">
                Height {briefing.growth?.height_cm != null
                  ? `${formatNumberSmart(Number(briefing.growth.height_cm) / 100)} m`
                  : '—'}
                {briefing.growthFlat ? ' · little change vs last measure' : ''}
              </Typography>
              <Typography variant="body2">
                {briefing.diseaseThisWeek
                  ? `Disease logged ${formatDate(briefing.diseases?.[0]?.observed_at)}`
                  : 'No disease record this week'}
              </Typography>
              {(briefing.nutrientLows || []).length > 0 && (
                <Typography variant="body2">
                  Low nutrients: {briefing.nutrientLows.map((n) => n.label).join(', ')}
                </Typography>
              )}
              <Button size="small" component={RouterLink} to="?tab=growth">Growth</Button>
              <Button size="small" component={RouterLink} to="?tab=disease">Disease</Button>
            </Grid>
          </Grid>
          {primaryVerdict?.work === 'walk' && (
            <Chip size="small" color="warning" label="Walk this emitter" sx={{ mt: 2 }} />
          )}
        </Paper>
      )}

      <Grid container spacing={2}>
        <Grid item xs={6} sm={4} md={2}>
          <SummaryCard
            label="Moisture"
            value={briefing?.moisture != null ? `${formatNumber(briefing.moisture, 0)}%` : '—'}
            status={moistureStatus}
            to="?tab=soil"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <SummaryCard label="pH" value={briefing?.soil?.ph != null ? formatNumber(briefing.soil.ph, 1) : '—'} to="?tab=soil" />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <SummaryCard label="EC" value={briefing?.soil?.ec != null ? formatNumber(briefing.soil.ec, 2) : '—'} to="?tab=soil" />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <SummaryCard
            label="Growth"
            value={briefing?.growth?.height_cm != null
              ? `${formatNumberSmart(Number(briefing.growth.height_cm) / 100)} m`
              : '—'}
            to="?tab=growth"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <SummaryCard
            label="Last irrigation"
            value={briefing?.latestIrrigation?.event_date ? formatDate(briefing.latestIrrigation.event_date) : '—'}
            to="?tab=irrigation"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <SummaryCard
            label="Last fertigation"
            value={briefing?.latestFertigation?.event_date ? formatDate(briefing.latestFertigation.event_date) : '—'}
            to="?tab=fertilizer"
          />
        </Grid>
      </Grid>
    </Box>
  );
}

export default OverviewTab;
