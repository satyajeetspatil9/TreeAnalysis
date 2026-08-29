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
  Tab,
  Tabs,
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
import IrrigationProgramsPanel from '../../components/irrigation/IrrigationProgramsPanel';
import IrrigationAllowedHoursPanel from '../../components/irrigation/IrrigationAllowedHoursPanel';
import IrrigationDevicesPanel from '../../components/irrigation/IrrigationDevicesPanel';
import IrrigationDeviceSchedulesPanel from '../../components/irrigation/IrrigationDeviceSchedulesPanel';
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
import {
  buildCommandQueueSampleJson,
  buildLiveGetCommandJson,
  buildLivePostTelemetryJson,
  coalesceQueuedCommands,
  mapQueueRowToGetCommand,
  sendZoneControlCommand,
} from '../../utils/irrigationSchedule';

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

function TabPanel({ value, index, children }) {
  if (value !== index) return null;
  return <Box sx={{ pt: 2 }}>{children}</Box>;
}

function IrrigationDashboardPage() {
  const { farm, loading: farmLoading } = useFarm();
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState([]);
  const [zones, setZones] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [controlZoneId, setControlZoneId] = useState('');
  const [commanding, setCommanding] = useState(false);
  const [confirmStart, setConfirmStart] = useState(null);
  const [queueCommands, setQueueCommands] = useState([]);

  const loadDevices = useCallback(async () => {
    if (!farm?.id) {
      setDevices([]);
      return;
    }
    const { data } = await supabase
      .from('irrigation_devices')
      .select('*')
      .eq('farm_id', farm.id)
      .order('name');
    setDevices(data || []);
  }, [farm?.id]);

  const load = useCallback(async ({ showSpinner = false } = {}) => {
    if (!farm?.id) {
      setRows([]);
      setZones([]);
      setQueueCommands([]);
      setLoading(false);
      return;
    }

    if (showSpinner) setLoading(true);
    setMessage(null);

    const { data: zoneRows, error: zonesError } = await supabase
      .from('irrigation_zones')
      .select('id, zone_code, description, flow_rate_lph')
      .eq('farm_id', farm.id)
      .order('zone_code');

    if (zonesError) {
      setMessage({ type: 'error', text: zonesError.message });
      setRows([]);
      setZones([]);
      setQueueCommands([]);
      setLoading(false);
      return;
    }

    setZones(zoneRows || []);

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
      setRows(mergeZoneStatusRows(zoneRows, []));
      setQueueCommands([]);
      setLoading(false);
      return;
    }

    setRows(mergeZoneStatusRows(zoneRows, statusRows));

    const { data: queueRows } = await supabase
      .from('irrigation_command_queue')
      .select('id, device_code, action, job_id, zone_id, payload, created_at, expires_at, status')
      .eq('farm_id', farm.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);
    setQueueCommands(queueRows || []);

    setLoading(false);
  }, [farm?.id]);

  useEffect(() => {
    if (farmLoading) return undefined;
    load({ showSpinner: true });
    loadDevices();

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
  }, [load, loadDevices, farmLoading]);

  useEffect(() => {
    if (tab !== 5 || !farm?.id) return undefined;
    const id = window.setInterval(() => {
      load();
    }, 5000);
    return () => window.clearInterval(id);
  }, [tab, farm?.id, load]);

  const liveGetJson = useMemo(() => {
    const zoneCodeById = new Map((zones || []).map((z) => [z.id, z.zone_code]));
    const commands = coalesceQueuedCommands(
      (queueCommands || []).map((row) => mapQueueRowToGetCommand(row, zoneCodeById)),
    );
    const pendingCommands = (rows || [])
      .filter((row) => row.status?.pending_command)
      .map((row) => ({
        zone_code: row.zone.zone_code,
        command: row.status.pending_command,
        command_at: row.status.pending_command_at,
        is_irrigating: row.isIrrigating,
      }));
    return buildLiveGetCommandJson({ commands, pendingCommands });
  }, [queueCommands, rows, zones]);

  const livePostJson = useMemo(() => buildLivePostTelemetryJson(rows), [rows]);
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
    return sendZoneControlCommand(farm.id, row, command);
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
    setMessage({
      type: 'success',
      text: `Start sent to ${row.zone.zone_code}. Controller should switch the valve within a few seconds.`,
    });
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
        subtitle="Live control, programs, allowed hours, and device schedules. Status updates every 3 minutes."
      />

      {message && tab === 0 && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="Now" />
          <Tab label="Programs" />
          <Tab label="Allowed hours" />
          <Tab label="Devices" />
          <Tab label="Other schedules" />
          <Tab label="Technician" />
        </Tabs>
      </Paper>

      <TabPanel value={tab} index={0}>
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
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1 }}>
                    Right now
                  </Typography>
                  {activeZone ? (
                    <>
                      <Typography variant="h4" fontWeight={800} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <WaterDropIcon color="info" fontSize="large" />
                        Watering now
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                        <Chip
                          color="info"
                          label={`Running zone: ${activeZone.zone.zone_code}`}
                          sx={{ fontWeight: 800, fontSize: '1rem', height: 36 }}
                        />
                        {activeZone.zone.description && (
                          <Typography variant="body1" color="text.secondary">
                            {activeZone.zone.description}
                          </Typography>
                        )}
                      </Box>
                      {activeZones.length > 1 && (
                        <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
                          Also reporting watering:{' '}
                          {activeZones.slice(1).map((row) => row.zone.zone_code).join(', ')}
                        </Typography>
                      )}
                    </>
                  ) : (
                    <>
                      <Typography variant="h4" fontWeight={800} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PauseCircleOutlineIcon color="success" fontSize="large" />
                        No watering
                      </Typography>
                      <Chip
                        color="success"
                        variant="outlined"
                        label="Running zone: none"
                        sx={{ fontWeight: 700, mt: 1 }}
                      />
                      <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                        Pump is idle. Use Start below or a program to begin watering.
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

              <Typography variant="subtitle2" fontWeight={800} sx={{ mt: 3, mb: 1 }}>
                Live readings
                {activeZone ? ` · ${activeZone.zone.zone_code}` : ''}
              </Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Running zone"
                    value={activeZone ? activeZone.zone.zone_code : 'None'}
                    emphasize={Boolean(activeZone)}
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Running for"
                    value={activeZone
                      ? formatIrrigationDurationLong(activeZone.status?.started_at, nowMs)
                      : '—'}
                    emphasize={Boolean(activeZone)}
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Started"
                    value={activeZone ? formatDateTime(activeZone.status?.started_at) : '—'}
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Last update"
                    value={activeZone?.status?.reported_at
                      ? formatRelativeTime(activeZone.status.reported_at, nowMs)
                      : (controlRow?.status?.reported_at
                        ? formatRelativeTime(controlRow.status.reported_at, nowMs)
                        : 'Never')}
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Voltage"
                    value={formatVoltage(
                      activeZone?.status?.voltage_v ?? controlRow?.status?.voltage_v,
                    )}
                    icon={<ElectricBoltIcon fontSize="small" color="action" />}
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Current"
                    value={formatAmperage(
                      activeZone?.status?.current_amp ?? controlRow?.status?.current_amp,
                    )}
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Flow now"
                    value={formatDischargeRate(
                      activeZone?.status?.current_discharge_lpm
                        ?? controlRow?.status?.current_discharge_lpm,
                    )}
                    icon={<SpeedIcon fontSize="small" color="action" />}
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Water used"
                    value={formatTotalDischarge(
                      activeZone?.status?.total_discharge_liters
                        ?? controlRow?.status?.total_discharge_liters,
                    )}
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Zone flow rate"
                    value={
                      (activeZone?.zone?.flow_rate_lph ?? controlRow?.zone?.flow_rate_lph) != null
                        ? `${activeZone?.zone?.flow_rate_lph ?? controlRow.zone.flow_rate_lph} L/h`
                        : '—'
                    }
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Device"
                    value={
                      activeZone?.status?.device_code
                        || controlRow?.status?.device_code
                        || '—'
                    }
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Pending command"
                    value={
                      (activeZone?.status?.pending_command
                        || controlRow?.status?.pending_command
                        || 'None')
                    }
                  />
                </Grid>
                <Grid item xs={6} sm={4} md={3}>
                  <MetricTile
                    label="Reported at"
                    value={formatDateTime(
                      activeZone?.status?.reported_at ?? controlRow?.status?.reported_at,
                    )}
                  />
                </Grid>
              </Grid>

              <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                <SignalBadge
                  on={Boolean(activeZone?.status?.start_indicator ?? controlRow?.status?.start_indicator)}
                  onLabel="Pump start ON"
                  offLabel="Pump start off"
                  color="success"
                />
                <SignalBadge
                  on={Boolean(activeZone?.status?.stop_indicator ?? controlRow?.status?.stop_indicator)}
                  onLabel="Pump stop ON"
                  offLabel="Pump stop off"
                  color="error"
                />
                {activeZone && (
                  <Chip color="info" variant="outlined" label={`Status: watering ${activeZone.zone.zone_code}`} />
                )}
                {!activeZone && (
                  <Chip color="success" variant="outlined" label="Status: idle" />
                )}
              </Box>

              {activeZone && (
                <Button
                  color="error"
                  variant="contained"
                  startIcon={<StopIcon />}
                  sx={{ mt: 2 }}
                  disabled={commanding}
                  onClick={() => stopWatering(activeZone)}
                >
                  Stop watering {activeZone.zone.zone_code}
                </Button>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
              <Typography variant="h6" fontWeight={800} gutterBottom>
                Control irrigation
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Choose a drip zone, then start or stop. Only one zone should run at a time.
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
                          {row.isIrrigating ? ' (running now)' : ''}
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
          </>
        )}
      </TabPanel>

      <TabPanel value={tab} index={1}>
        <IrrigationProgramsPanel
          farmId={farm?.id}
          zones={zones}
          devices={devices}
          programType="water"
          title="Water programs"
        />
        <Box sx={{ mt: 5 }}>
          <IrrigationProgramsPanel
            farmId={farm?.id}
            zones={zones}
            devices={devices}
            programType="fertigation"
            title="Fertigation programs"
          />
        </Box>
      </TabPanel>

      <TabPanel value={tab} index={2}>
        <IrrigationAllowedHoursPanel farmId={farm?.id} />
      </TabPanel>

      <TabPanel value={tab} index={3}>
        <IrrigationDevicesPanel
          farmId={farm?.id}
          zones={zones}
          onChanged={setDevices}
        />
      </TabPanel>

      <TabPanel value={tab} index={4}>
        <IrrigationDeviceSchedulesPanel farmId={farm?.id} devices={devices} />
      </TabPanel>

      <TabPanel value={tab} index={5}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Live JSON the controller would receive on GET (commands to run) and send on POST (telemetry).
          This tab refreshes every 5 seconds.
        </Typography>

        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={700}>GET — controller receives</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Pending start/stop commands. Apply <code>action</code> to every code in <code>device_codes</code> at the same time. <code>zone_code</code> is display-only.
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              overflow: 'auto',
              fontSize: '0.75rem',
              bgcolor: 'action.hover',
              borderRadius: 1,
              maxHeight: 360,
            }}
          >
            {liveGetJson}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={700}>POST — controller sends</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Current zone telemetry as the controller would post it. ack_command is true when a pending command is waiting.
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              overflow: 'auto',
              fontSize: '0.75rem',
              bgcolor: 'action.hover',
              borderRadius: 1,
              maxHeight: 360,
            }}
          >
            {livePostJson}
          </Box>
        </Paper>

        <Accordion disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">Example format</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Controller posts telemetry with POST. Poll start/stop with GET using the same API key.
              After acting, POST with <code>ack_command: true</code> and optional <code>command_id</code>.
            </Typography>
            <Typography variant="caption" fontWeight={700} display="block" sx={{ mt: 2 }}>
              GET sample
            </Typography>
            <Box component="pre" sx={{ m: 0, overflow: 'auto', fontSize: '0.75rem' }}>
              {buildCommandQueueSampleJson()}
            </Box>
            <Typography variant="caption" fontWeight={700} display="block" sx={{ mt: 2 }}>
              POST sample
            </Typography>
            <Box component="pre" sx={{ m: 0, overflow: 'auto', fontSize: '0.75rem' }}>
              {buildIrrigationStatusSampleJson(rows[0]?.zone?.zone_code || 'Z01')}
            </Box>
          </AccordionDetails>
        </Accordion>
      </TabPanel>

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
