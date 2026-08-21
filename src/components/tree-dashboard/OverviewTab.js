import React, { useEffect, useState } from 'react';
import { Grid, Paper, Typography, Box, CircularProgress } from '@mui/material';
import { supabase } from '../../supabaseClient';
import { formatDate, formatNumber } from '../../utils/formatters';
import { getIrrigationZoneId } from '../../utils/schema';
import { evaluateSoilStandard, getSoilStandard, soilStatusBadgeSx } from '../../utils/soil';
import HealthIndicator from '../common/HealthIndicator';

function SummaryCard({ label, value, status }) {
  return (
    <Paper sx={{ p: 2, textAlign: 'center' }} variant="outlined">
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, mt: 0.5 }}>
        {status?.label && (
          <Typography component="span" sx={soilStatusBadgeSx(status.status)}>
            {status.label}
          </Typography>
        )}
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{value}</Typography>
      </Box>
    </Paper>
  );
}

function OverviewTab({ tree, zoneCode }) {
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const position = tree.tree_positions;

  useEffect(() => {
    async function loadSummary() {
      setLoading(true);
      const result = {};

      const { data: soilObs } = await supabase
        .from('soil_observations')
        .select('*')
        .eq('tree_id', tree.id)
        .order('observed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (soilObs) {
        result.moisture = soilObs.moisture_percent;
        result.ph = soilObs.ph;
        result.ec = soilObs.ec;
      }

      const zoneId = getIrrigationZoneId(tree);
      if (zoneId) {
        const { data: irrEvent } = await supabase
          .from('irrigation_events')
          .select('event_date')
          .eq('zone_id', zoneId)
          .order('event_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        result.lastIrrigation = irrEvent?.event_date;

        const { data: fertEvent } = await supabase
          .from('fertigation_events')
          .select('event_date')
          .eq('zone_id', zoneId)
          .order('event_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        result.lastFertigation = fertEvent?.event_date;
      }

      const { data: growth } = await supabase
        .from('tree_growth')
        .select('height_cm')
        .eq('tree_id', tree.id)
        .order('measurement_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (growth?.height_cm != null) result.height = Number(growth.height_cm) / 100;

      setSummary(result);
      setLoading(false);
    }

    loadSummary();
  }, [tree]);

  if (loading) return <CircularProgress size={24} />;

  const lat = position?.latitude;
  const lng = position?.longitude;
  const moistureStatus = evaluateSoilStandard(
    getSoilStandard('moisture_percent'),
    summary.moisture,
  );

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

      <Grid container spacing={2}>
        <Grid item xs={6} sm={4} md={2}>
          <SummaryCard
            label="Moisture"
            value={summary.moisture != null ? `${formatNumber(summary.moisture, 0)}%` : '—'}
            status={moistureStatus}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={2}><SummaryCard label="pH" value={summary.ph != null ? formatNumber(summary.ph, 1) : '—'} /></Grid>
        <Grid item xs={6} sm={4} md={2}><SummaryCard label="EC" value={summary.ec != null ? formatNumber(summary.ec, 2) : '—'} /></Grid>
        <Grid item xs={6} sm={4} md={2}><SummaryCard label="Growth" value={summary.height != null ? `${formatNumber(summary.height, 2)} m` : '—'} /></Grid>
        <Grid item xs={6} sm={4} md={2}><SummaryCard label="Last irrigation" value={summary.lastIrrigation ? formatDate(summary.lastIrrigation) : '—'} /></Grid>
        <Grid item xs={6} sm={4} md={2}><SummaryCard label="Last fertigation" value={summary.lastFertigation ? formatDate(summary.lastFertigation) : '—'} /></Grid>
      </Grid>
    </Box>
  );
}

export default OverviewTab;
