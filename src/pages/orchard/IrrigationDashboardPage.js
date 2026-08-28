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
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
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
  sendIrrigationCommandPayload,
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
  const [controlZoneId, setControlZoneId] = useState('');
  const [commanding, setCommanding] = useState(false);
  const [confirmStart, setConfirmStart] = useState(null);

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
  const controlRow = useMemo(
    () => rows.find((row) => String(row.zone.id) === String(controlZoneId)) || rows[0] || null,
    [rows, controlZoneId],
  );

  useEffect(() => {
    if (!rows.length) return;
    if (controlZoneId && rows.some((row) => String(row.zone.id) === String(controlZoneId))) return;
    const preferred = rows.find((row) => row.isIrrigating) || rows[0];
    setControlZoneId(String(preferred.zone.id));
  }, [rows, controlZoneId]);

  const sendCommand = async (row, command) => {
    if (!farm?.id || !row) return { error: 'Select a zone first.' };
    const { error } = await supabase
      .from('irrigation_zone_status')
      .upsert(sendIrrigationCommandPayload(farm.id, row, command), { onConflict: 'zone_id' });
    if (error) {
      if (String(error.message || '').includes('pending_command')) {
        return { error: 'Run migration 038_irrigation_zone_commands.sql in Supabase, then try again.' };
      }
      return { error: error.message };
    }
    return { error: null };
  };

  const startWatering = async (row) => {
    if (!row) return;
    setCommanding(true);
    setMessage(null);
    const others = rows.filter((item) => item.isIrrigating && item.zone.id !== row.zone.id);
    for (const other of others) {
      const stopped = await sendCommand(other, 'stop');
      if (stopped.error) {
        setMessage({ type: 'error', text: stopped.error });
        setCommanding(false);
        return;
      }
    }
    const started = await sendCommand(row, 'start');
    setCommanding(false);
    if (started.error) {
      setMessage({ type: 'error', text: started.error });
      return;
    }
    setMessage({ type: 'success', text: `Start sent to ${row.zone.zone_code}. Controller should switch the valve within a few seconds.` });
    await load();
  };

  const stopWatering = async (row) => {
    if (!row) return;
    setCommanding(true);
    setMessage(null);
    const stopped = await sendCommand(row, 'stop');
    setCommanding(false);
    if (stopped.error) {
      setMessage({ type: 'error', text: stopped.error });
      return;
    }
    setMessage({ type: 'success', text: `Stop sent to ${row.zone.zone_code}.` });
    await load();
  };

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

        {activeZone && (
          <Button
            color="error"
            variant="contained"
            startIcon={<StopIcon />}
            sx={{ mt: 2 }}
            disabled={commanding}
            onClick={() => stopWatering(activeZone)}
          >
            Stop watering
          </Button>
        )}
      </Paper>

      {rows.length > 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
          <Typography variant="h6" fontWeight={800} gutterBottom>
            Control irrigation
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose a drip zone, then start or stop watering. Only one zone runs at a time.
            The pump controller must poll commands (see technician setup below).
          </Typography>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={4}>
              <FormControl fullWidth>
                <InputLabel>Zone</InputLabel>
                <Select
                  value={controlRow ? String(controlRow.zone.id) : ''}
                  label="Zone"
                  onChange={(e) => setControlZoneId(e.target.value)}
                >
                  {rows.map((row) => (
                    <MenuItem key={row.zone.id} value={String(row.zone.id)}>
                      {row.zone.zone_code}
                      {row.zone.description ? ` — ${row.zone.description}` : ''}
                      {row.isIrrigating ? ' (watering)' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={8}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  color="info"
                  size="large"
                  startIcon={commanding ? <CircularProgress size={18} color="inherit" /> : <PlayArrowIcon />}
                  disabled={!controlRow || commanding || controlRow.isIrrigating}
                  onClick={() => setConfirmStart(controlRow)}
                >
                  Start watering
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  size="large"
                  startIcon={<StopIcon />}
                  disabled={!controlRow || commanding || (!controlRow.isIrrigating && controlRow.status?.pending_command !== 'start')}
                  onClick={() => stopWatering(controlRow)}
                >
                  Stop watering
                </Button>
              </Box>
            </Grid>
          </Grid>
          {controlRow?.status?.pending_command && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {controlRow.status.pending_command === 'start' ? 'Start' : 'Stop'} sent to{' '}
              {controlRow.zone.zone_code} — waiting for the controller to apply it.
            </Alert>
          )}
        </Paper>
      )}

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

                    <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                      <Button
                        variant="contained"
                        color="info"
                        startIcon={<PlayArrowIcon />}
                        disabled={commanding || row.isIrrigating}
                        onClick={() => setConfirmStart(row)}
                      >
                        Start
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        startIcon={<StopIcon />}
                        disabled={commanding || (!row.isIrrigating && status?.pending_command !== 'start')}
                        onClick={() => stopWatering(row)}
                      >
                        Stop
                      </Button>
                      {status?.pending_command && (
                        <Chip
                          size="small"
                          color="warning"
                          label={status.pending_command === 'start' ? 'Start pending' : 'Stop pending'}
                        />
                      )}
                    </Box>
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
            Controller posts telemetry with POST. Poll start/stop with GET using the same API key.
            After acting on a command, POST telemetry with <code>ack_command: true</code>.
            Dashboard rereads status every 3 minutes.
          </Typography>
          <Box component="pre" sx={{ m: 0, overflow: 'auto', fontSize: '0.75rem' }}>
            {buildIrrigationStatusSampleJson(rows[0]?.zone?.zone_code || 'Z01')}
          </Box>
        </AccordionDetails>
      </Accordion>

      <Dialog open={Boolean(confirmStart)} onClose={() => setConfirmStart(null)}>
        <DialogTitle>Start watering {confirmStart?.zone.zone_code}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This sends a start command to the irrigation controller
            {confirmStart?.zone.description ? ` for ${confirmStart.zone.description}` : ''}.
            {activeZones.some((row) => row.zone.id !== confirmStart?.zone.id)
              ? ' Any other zone that is watering will be stopped first.'
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmStart(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="info"
            disabled={commanding}
            onClick={() => {
              const row = confirmStart;
              setConfirmStart(null);
              startWatering(row);
            }}
          >
            Start watering
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default IrrigationDashboardPage;
