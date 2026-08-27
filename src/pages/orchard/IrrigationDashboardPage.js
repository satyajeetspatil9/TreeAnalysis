import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  alpha,
} from '@mui/material';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
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
  formatIrrigationDuration,
  formatLastUpdated,
  formatTotalDischarge,
  formatVoltage,
  isMissingStatusTable,
  mergeZoneStatusRows,
  statusTableHint,
} from '../../utils/irrigationStatus';

function IndicatorChip({ active, activeLabel, inactiveLabel, activeColor = 'success' }) {
  return (
    <Chip
      icon={<FiberManualRecordIcon sx={{ fontSize: '12px !important' }} />}
      label={active ? activeLabel : inactiveLabel}
      size="small"
      color={active ? activeColor : 'default'}
      variant={active ? 'filled' : 'outlined'}
      sx={{ fontWeight: 600 }}
    />
  );
}

function IrrigationDashboardPage() {
  const { farm, loading: farmLoading } = useFarm();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const load = useCallback(async () => {
    if (!farm?.id) {
      setRows([]);
      setLoading(false);
      return;
    }

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
    setLoading(true);
    load();

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
  const activeZone = rows.find((row) => row.isIrrigating);

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
        title="Irrigation dashboard"
        subtitle="Drip zone status from your irrigation controller. Readings refresh every 3 minutes."
      />

      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Paper
        sx={(theme) => ({
          p: 2.5,
          mb: 3,
          border: '2px solid',
          borderColor: counts.irrigating > 0
            ? theme.palette.info.main
            : alpha(theme.palette.success.main, 0.45),
          borderLeftWidth: 8,
          borderLeftColor: counts.irrigating > 0
            ? theme.palette.info.dark
            : theme.palette.success.main,
          bgcolor: counts.irrigating > 0
            ? alpha(theme.palette.info.main, 0.1)
            : alpha(theme.palette.success.main, 0.08),
        })}
        variant="outlined"
      >
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
          Current status
        </Typography>
        {activeZone ? (
          <Typography variant="body1" sx={{ mb: 1.5 }}>
            Irrigating <strong>{activeZone.zone.zone_code}</strong>
            {activeZone.zone.description ? ` · ${activeZone.zone.description}` : ''}
            {' '}since {formatDateTime(activeZone.status?.started_at)}
            {' '}({formatIrrigationDuration(activeZone.status?.started_at, nowMs)})
          </Typography>
        ) : (
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1.5 }}>
            No zone is irrigating right now.
          </Typography>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Chip label={`${counts.irrigating} irrigating`} color="info" size="small" />
          <Chip label={`${counts.idle} idle`} color="default" size="small" />
          <Chip label={`${counts.noData} no live data`} color="default" variant="outlined" size="small" />
        </Box>
      </Paper>

      <Alert severity="info" sx={{ mb: 2 }}>
        Controller posts to the ingest API every few seconds. Use the same ESP32 API key as soil sensors.
        Sample JSON:
        <Box component="pre" sx={{ mt: 1, mb: 0, overflow: 'auto', fontSize: '0.75rem' }}>
          {buildIrrigationStatusSampleJson(rows[0]?.zone?.zone_code || 'Z01')}
        </Box>
      </Alert>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <TableContainer sx={{ maxHeight: '72vh' }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Zone</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Start time</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Duration</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Voltage</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Amp</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Start</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Stop</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Current discharge</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Total discharge</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Updated</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.zone.id}
                  hover
                  sx={(theme) => (
                    row.isIrrigating
                      ? { bgcolor: alpha(theme.palette.info.main, 0.08) }
                      : undefined
                  )}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>{row.zone.zone_code}</Typography>
                    {row.zone.description && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.zone.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {!row.hasTelemetry ? (
                      <Chip label="No data" size="small" />
                    ) : (
                      <Chip
                        icon={row.isIrrigating ? <WaterDropIcon /> : undefined}
                        label={row.isIrrigating ? 'Irrigating' : 'Idle'}
                        size="small"
                        color={row.isIrrigating ? 'info' : 'default'}
                      />
                    )}
                  </TableCell>
                  <TableCell>{row.isIrrigating ? formatDateTime(row.status?.started_at) : '—'}</TableCell>
                  <TableCell>
                    {row.isIrrigating
                      ? formatIrrigationDuration(row.status?.started_at, nowMs)
                      : '—'}
                  </TableCell>
                  <TableCell>{formatVoltage(row.status?.voltage_v)}</TableCell>
                  <TableCell>{formatAmperage(row.status?.current_amp)}</TableCell>
                  <TableCell>
                    {row.hasTelemetry ? (
                      <IndicatorChip
                        active={row.status?.start_indicator}
                        activeLabel="ON"
                        inactiveLabel="OFF"
                        activeColor="success"
                      />
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {row.hasTelemetry ? (
                      <IndicatorChip
                        active={row.status?.stop_indicator}
                        activeLabel="ON"
                        inactiveLabel="OFF"
                        activeColor="error"
                      />
                    ) : '—'}
                  </TableCell>
                  <TableCell>{formatDischargeRate(row.status?.current_discharge_lpm)}</TableCell>
                  <TableCell>{formatTotalDischarge(row.status?.total_discharge_liters)}</TableCell>
                  <TableCell>{formatLastUpdated(row.status?.reported_at)}</TableCell>
                </TableRow>
              ))}

              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} align="center">
                    <Box sx={{ py: 4 }}>
                      <PlayArrowIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                      <Typography color="text.secondary" sx={{ mb: 0.5 }}>
                        No irrigation zones configured yet.
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Add zones under Farm Setting → Zones, then connect your controller.
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
        <Chip icon={<PlayArrowIcon />} label="Start indicator ON = pump start signal active" size="small" variant="outlined" />
        <Chip icon={<StopIcon />} label="Stop indicator ON = stop signal active" size="small" variant="outlined" />
      </Box>
    </Box>
  );
}

export default IrrigationDashboardPage;
