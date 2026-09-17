import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber } from '../../utils/formatters';
import { formatWaterLiters } from '../../utils/irrigation';
import { loadFarmWeekBriefing } from '../../utils/orchardBriefing';
import { treeDashboardUrl } from '../../utils/treeDashboard';

function OrchardBriefingPage() {
  const { farm } = useFarm();
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!farm?.id) {
      setBriefing(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await loadFarmWeekBriefing(supabase, farm.id);
      setBriefing(data);
    } catch (err) {
      setError(err.message);
      setBriefing(null);
    } finally {
      setLoading(false);
    }
  }, [farm?.id]);

  useEffect(() => { load(); }, [load]);

  const window = briefing?.window;
  const counts = briefing?.counts || {};

  return (
    <Box>
      <PageHeader
        section="Monitoring"
        title="Weekly briefing"
        subtitle="Last 7 days: water, moisture, radar, soil, fertigation, climate, growth, and disease joined for this farm. Radar will not name a single clogged dripper."
      />

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Create a farm in Settings before viewing the briefing.</Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress /></Box>
      ) : briefing && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {window ? `${formatDate(window.startDate)} – ${formatDate(window.endDate)}` : ''}
            {counts.trees ? ` · ${counts.trees} trees` : ''}
          </Typography>

          <Grid container spacing={1} sx={{ mb: 2 }}>
            <Grid item><Chip color="warning" label={`${counts.radarDrier || 0} radar drier than usual`} /></Grid>
            <Grid item><Chip color="warning" variant="outlined" label={`${counts.probeLow || 0} probe low`} /></Grid>
            <Grid item><Chip variant="outlined" label={`${counts.zonesNoIrrigation || 0} zones with no irrigation event`} /></Grid>
            <Grid item><Chip color="error" variant="outlined" label={`${counts.disease || 0} trees with disease`} /></Grid>
            <Grid item><Chip label={`${formatNumber(counts.rainMm || 0, 1)} mm rain`} /></Grid>
            {briefing.sprayAdvice && (
              <Grid item>
                <Chip
                  color={briefing.sprayAdvice.type === 'SPRAY' ? 'warning' : 'success'}
                  label={briefing.sprayAdvice.type === 'SPRAY' ? 'Do not spray' : 'Spray window'}
                />
              </Grid>
            )}
          </Grid>

          <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>Work this week</Typography>
            {(briefing.workList || []).map((item) => (
              <Typography key={item} variant="body2" sx={{ mb: 0.75 }}>· {item}</Typography>
            ))}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
              <Button size="small" component={RouterLink} to="/orchard/irrigation">Irrigation</Button>
              <Button size="small" component={RouterLink} to="/orchard/climate">Climate</Button>
              <Button size="small" component={RouterLink} to="/monitoring/moisture">Moisture</Button>
              <Button size="small" component={RouterLink} to="/monitoring/satellite">Satellite</Button>
              <Button size="small" component={RouterLink} to="/monitoring/disease">Disease</Button>
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ mb: 3 }}>
            <Box sx={{ p: 2, pb: 0 }}>
              <Typography variant="h6">Zones</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Irrigation and fertigation are by zone. A zone event does not prove every plant received water.
              </Typography>
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Zone</TableCell>
                  <TableCell>Trees</TableCell>
                  <TableCell>Irrigation events</TableCell>
                  <TableCell>Water</TableCell>
                  <TableCell>Fertigation</TableCell>
                  <TableCell>Probe low</TableCell>
                  <TableCell>Last irrigation</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(briefing.zones || []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center">No zones yet.</TableCell></TableRow>
                ) : briefing.zones.map((zone) => (
                  <TableRow key={zone.zoneId}>
                    <TableCell>{zone.zoneCode}</TableCell>
                    <TableCell>{zone.treeCount}</TableCell>
                    <TableCell>{zone.irrigationCount}</TableCell>
                    <TableCell>{formatWaterLiters(zone.waterLiters)}</TableCell>
                    <TableCell>{zone.fertigation ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{zone.probeLow}</TableCell>
                    <TableCell>{zone.lastIrrigation ? formatDate(zone.lastIrrigation) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Paper variant="outlined">
            <Box sx={{ p: 2, pb: 0 }}>
              <Typography variant="h6">Exception trees</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Walk these first: watered but still dry, radar-dry with low probe, or disease in a wet week.
              </Typography>
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tree</TableCell>
                  <TableCell>Zone</TableCell>
                  <TableCell>Probe</TableCell>
                  <TableCell>Radar</TableCell>
                  <TableCell>Irrigated</TableCell>
                  <TableCell>Story</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(briefing.exceptions || []).length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center">No exceptions this week.</TableCell></TableRow>
                ) : briefing.exceptions.map((tree) => (
                  <TableRow key={tree.treeId} hover>
                    <TableCell>
                      <Button
                        size="small"
                        component={RouterLink}
                        to={treeDashboardUrl(tree.positionCode)}
                      >
                        {tree.positionCode}
                      </Button>
                    </TableCell>
                    <TableCell>{tree.zoneCode}</TableCell>
                    <TableCell>
                      {tree.moisture != null ? `${formatNumber(tree.moisture, 0)}%` : '—'}
                      {tree.moistureStatus?.label ? ` ${tree.moistureStatus.label}` : ''}
                    </TableCell>
                    <TableCell>
                      {tree.radar?.wetnessLabel || '—'}
                      {tree.radar?.drierThanUsual ? ' · drier than usual' : ''}
                    </TableCell>
                    <TableCell>{tree.irrigationThisWeek ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{tree.verdicts?.[0]?.text || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
    </Box>
  );
}

export default OrchardBriefingPage;
