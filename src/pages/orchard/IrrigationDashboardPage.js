import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Typography,
  alpha,
} from '@mui/material';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import SpeedIcon from '@mui/icons-material/Speed';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import {
  IRRIGATION_STATUS_POLL_MS,
  buildIrrigationStatusSampleJson,
  countIrrigationStatusRows,
  formatAmperage,
  formatDateTime,
  formatDischargeRate,
  formatIrrigationDurationLong,
  formatRelativeTime,
  formatTotalDischarge,
  formatVoltage,
  isMissingStatusTable,
  mergeZoneStatusRows,
  statusTableHint,
} from '../../utils/irrigationStatus';

function MetricTile({ label, value, icon, emphasize = false }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        height: '100%',
        bgcolor: emphasize ? (theme) => alpha(theme.palette.info.main, 0.08) : 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        {icon}
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
      </Box>
      <Typography variant={emphasize ? 'h5' : 'h6'} fontWeight={700} sx={{ lineHeight: 1.2 }}>
        {value}
      </Typography>
    </Paper>
  );
}

function SignalBadge({ on, onLabel, offLabel, color }) {
  return (
    <Chip
      size="small"
      icon={color === 'success' ? <PlayArrowIcon /> : <StopIcon />}
      label={on ? onLabel : offLabel}
      color={on ? color : 'default'}
      variant={on ? 'filled' : 'outlined'}
      sx={{ fontWeight: 700 }}
    />
  );
}

function zoneStatusCopy(row) {
  if (!row.hasTelemetry) {
    return { label: 'No signal', color: 'default', helper: 'Controller has not reported this zone yet' };
  }
  if (row.isIrrigating) {
    return { label: 'Watering now', color: 'info', helper: 'Pump is running on this zone' };
  }
  return { label: 'Idle', color: 'success', helper: 'Not watering' };
}

function IrrigationDashboardPage() {
  const { farm, loading: farmLoading } = useFarm();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const load = useCallback(async ({ showSpinner = false } = {}) => {
    if (!farm?.id) {
      setRows([]);
      setLoading(false);
      return;
    }

    if (showSpinner) setLoading(true);
    setMessage(null);

    const { data: zones, error: zonesError } = await supabase
      .from('irrigation_zones')
      .select('id, zone_code, description, flow_rate_lph')
      .eq('farm_id', farm.id)
      .order('zone_code');

    if (zonesError) {
      setMessage({ type: 'error', text: zonesError.message });
      setRows([]);
      setLoading(false);
      return;
    }

    const { data: statusRows, error: statusError } = await supabase
      .from('irrigation_zone_status')
      .select('*')
      .eq('farm_id', farm.id);

    if (statusError) {
      if (isMissingStatusTable(statusError)) {
        setMessage({
          type: 'warning',
          text: 'Run migration 037_irrigation_zone_status.sql in Supabase, then reload.',
        });
      } else {
        setMessage({ type: 'error', text: statusTableHint(statusError.message) });
      }
      setRows(mergeZoneStatusRows(zones, []));
      setLoading(false);
      return;
    }

    setRows(mergeZoneStatusRows(zones, statusRows));
    setLoading(false);
  }, [farm?.id]);

  useEffect(() => {
    if (farmLoading) return undefined;
    load({ showSpinner: true });

    const pollId = window.setInterval(() => {
      load();
      setNowMs(Date.now());
    }, IRRIGATION_STATUS_POLL_MS);

    const tickId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, [load, farmLoading]);

  const counts = useMemo(() => countIrrigationStatusRows(rows), [rows]);
  const activeZones = useMemo(() => rows.filter((row) => row.isIrrigating), [rows]);
  const activeZone = activeZones[0] || null;

  if (farmLoading || loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <PageHeader
        section="Orchard"
        title="Irrigation"
        subtitle="See which zone is watering, how long it has run, and pump readings. Status updates every 3 minutes."
      />

      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Paper
        sx={(theme) => ({
          p: { xs: 2, sm: 3 },
          mb: 3,
          border: '2px solid',
          borderColor: activeZone ? theme.palette.info.main : alpha(theme.palette.success.main, 0.5),
          borderLeftWidth: 10,
          borderLeftColor: activeZone ? theme.palette.info.dark : theme.palette.success.main,
          bgcolor: activeZone
            ? alpha(theme.palette.info.main, 0.12)
            : alpha(theme.palette.success.main, 0.08),
        })}
        variant="outlined"
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1 }}>
              Right now
            </Typography>
            {activeZone ? (
              <>
                <Typography variant="h4" fontWeight={800} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <WaterDropIcon color="info" fontSize="large" />
                  Watering {activeZone.zone.zone_code}
                </Typography>
                {activeZone.zone.description && (
                  <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
                    {activeZone.zone.description}
                  </Typography>
                )}
              </>
            ) : (
              <>
                <Typography variant="h4" fontWeight={800} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PauseCircleOutlineIcon color="success" fontSize="large" />
                  No watering
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
                  All zones are idle. Open a zone card below if you need pump details.
                </Typography>
              </>
            )}
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Chip color="info" label={`${counts.irrigating} watering`} />
            <Chip color="success" variant="outlined" label={`${counts.idle} idle`} />
            {counts.noData > 0 && (
              <Chip variant="outlined" label={`${counts.noData} no signal`} />
            )}
          </Box>
        </Box>

        {activeZone && (
          <Grid container spacing={1.5} sx={{ mt: 2 }}>
            <Grid item xs={6} sm={4} md={2}>
              <MetricTile
                label="Running for"
                value={formatIrrigationDurationLong(activeZone.status?.started_at, nowMs)}
                emphasize
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <MetricTile
                label="Started"
                value={formatDateTime(activeZone.status?.started_at)}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <MetricTile
                label="Voltage"
                value={formatVoltage(activeZone.status?.voltage_v)}
                icon={<ElectricBoltIcon fontSize="small" color="action" />}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <MetricTile
                label="Current"
                value={formatAmperage(activeZone.status?.current_amp)}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <MetricTile
                label="Flow now"
                value={formatDischargeRate(activeZone.status?.current_discharge_lpm)}
                icon={<SpeedIcon fontSize="small" color="action" />}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <MetricTile
                label="Water used"
                value={formatTotalDischarge(activeZone.status?.total_discharge_liters)}
              />
            </Grid>
          </Grid>
        )}
      </Paper>

      {rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <WaterDropIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
          <Typography variant="h6" gutterBottom>No drip zones yet</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Add zones first, then the controller can report which line is watering.
          </Typography>
          <Button variant="contained" component={RouterLink} to="/irrigation/zones">
            Add irrigation zones
          </Button>
        </Paper>
      ) : (
        <>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
            Zones
          </Typography>
          <Grid container spacing={2}>
            {rows.map((row) => {
              const copy = zoneStatusCopy(row);
              const status = row.status;

              return (
                <Grid item xs={12} md={6} key={row.zone.id}>
                  <Paper
                    variant="outlined"
                    sx={(theme) => ({
                      p: 2,
                      height: '100%',
                      borderWidth: 2,
                      borderColor: row.isIrrigating
                        ? theme.palette.info.main
                        : theme.palette.divider,
                      bgcolor: row.isIrrigating
                        ? alpha(theme.palette.info.main, 0.06)
                        : undefined,
                    })}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
                      <Box>
                        <Typography variant="h6" fontWeight={800}>
                          {row.zone.zone_code}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {row.zone.description || 'Drip zone'}
                        </Typography>
                      </Box>
                      <Chip label={copy.label} color={copy.color} sx={{ fontWeight: 700 }} />
                    </Box>

                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                      {copy.helper}
                      {row.hasTelemetry ? ` · Updated ${formatRelativeTime(status?.reported_at, nowMs)}` : ''}
                    </Typography>

                    {row.isIrrigating && (
                      <Typography variant="h5" fontWeight={800} sx={{ mb: 1.5 }}>
                        {formatIrrigationDurationLong(status?.started_at, nowMs)}
                      </Typography>
                    )}

                    <Grid container spacing={1}>
                      <Grid item xs={6}>
                        <MetricTile label="Started" value={row.isIrrigating ? formatDateTime(status?.started_at) : '—'} />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricTile label="Voltage" value={formatVoltage(status?.voltage_v)} />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricTile label="Current" value={formatAmperage(status?.current_amp)} />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricTile label="Flow now" value={formatDischargeRate(status?.current_discharge_lpm)} />
                      </Grid>
                      <Grid item xs={12}>
                        <MetricTile label="Total water this run" value={formatTotalDischarge(status?.total_discharge_liters)} />
                      </Grid>
                    </Grid>

                    {row.hasTelemetry && (
                      <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                        <SignalBadge
                          on={status?.start_indicator}
                          onLabel="Pump start ON"
                          offLabel="Pump start off"
                          color="success"
                        />
                        <SignalBadge
                          on={status?.stop_indicator}
                          onLabel="Pump stop ON"
                          offLabel="Pump stop off"
                          color="error"
                        />
                      </Box>
                    )}
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </>
      )}

      <Accordion sx={{ mt: 3 }} disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">Controller setup (for technician)</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Controller posts to the ingest API. Use the same ESP32 API key as soil sensors.
            Dashboard rereads the latest values every 3 minutes.
          </Typography>
          <Box component="pre" sx={{ m: 0, overflow: 'auto', fontSize: '0.75rem' }}>
            {buildIrrigationStatusSampleJson(rows[0]?.zone?.zone_code || 'Z01')}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}

export default IrrigationDashboardPage;
