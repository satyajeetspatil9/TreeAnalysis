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
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import { treeDashboardUrl } from '../../utils/treeDashboard';
import { getTreeGps } from '../../utils/schema';
import {
  SOIL_NUTRIENT_STANDARDS,
  evaluateSoilStandard,
  getLatestObservationByTree,
} from '../../utils/soil';

const moistureStandard = SOIL_NUTRIENT_STANDARDS.moisture_percent;

function moistureChipColor(status) {
  if (status === 'good' || status === 'ok') return 'success';
  if (status === 'low') return 'warning';
  if (status === 'high') return 'error';
  return 'default';
}

function moistureDotColor(theme, status) {
  if (status === 'good' || status === 'ok') return theme.palette.success.main;
  if (status === 'low') return theme.palette.warning.main;
  if (status === 'high') return theme.palette.error.main;
  return theme.palette.grey[400];
}

function MoistureDot({ color }) {
  return (
    <Box
      sx={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: `radial-gradient(circle at 32% 28%, ${alpha('#fff', 0.65)} 0%, ${color} 42%, ${alpha('#000', 0.28)} 100%)`,
        boxShadow: `0 2px 4px ${alpha('#000', 0.22)}`,
        flexShrink: 0,
      }}
    />
  );
}

function layoutByGps(rows) {
  if (!rows.length) return { aspect: 1.4, items: [] };
  const lats = rows.map((row) => row.gps.latitude);
  const lngs = rows.map((row) => row.gps.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 1e-6;
  const lngSpan = maxLng - minLng || 1e-6;
  const midLat = (minLat + maxLat) / 2;
  const widthM = lngSpan * 111320 * Math.cos((midLat * Math.PI) / 180);
  const heightM = latSpan * 111320;
  const aspect = Math.min(2.4, Math.max(0.7, widthM / heightM));

  const pad = 0.08;
  return {
    aspect,
    items: rows.map((row) => ({
      ...row,
      x: pad + ((row.gps.longitude - minLng) / lngSpan) * (1 - 2 * pad),
      y: pad + ((maxLat - row.gps.latitude) / latSpan) * (1 - 2 * pad),
    })),
  };
}

function TreeMoistureMarker({ row, color, tooltip }) {
  return (
    <Tooltip title={tooltip} arrow>
      <Box
        component={RouterLink}
        to={treeDashboardUrl(row.tree, 'soil')}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0.5,
          textDecoration: 'none',
          color: 'text.primary',
          py: 0.25,
          px: 0.5,
          borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {row.tree}
        </Typography>
        <MoistureDot color={color} />
      </Box>
    </Tooltip>
  );
}

function MoistureMonitoringPage() {
  const theme = useTheme();
  const [observations, setObservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('soil_observations')
      .select('id, tree_id, moisture_percent, observed_at, trees(tree_positions(position_code, latitude, longitude))')
      .not('moisture_percent', 'is', null)
      .order('observed_at', { ascending: false })
      .limit(2000);

    if (error) {
      setMessage({ type: 'error', text: error.message });
      setObservations([]);
      setLoading(false);
      return;
    }

    setObservations(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const latestByTree = getLatestObservationByTree(observations);
    return Object.values(latestByTree)
      .filter((obs) => obs.moisture_percent != null && obs.moisture_percent !== '')
      .map((obs) => {
        const moisture = Number(obs.moisture_percent);
        const evaluation = evaluateSoilStandard(moistureStandard, moisture);
        const tree = getTreeDisplayId(obs.trees || {});
        return {
          treeId: obs.tree_id,
          tree,
          moisture,
          observedAt: obs.observed_at,
          status: evaluation.status,
          statusLabel: evaluation.label,
          gps: getTreeGps(obs.trees || {}),
        };
      })
      .sort((a, b) => a.tree.localeCompare(b.tree, undefined, { numeric: true, sensitivity: 'base' }));
  }, [observations]);

  const gpsRows = useMemo(() => rows.filter((row) => row.gps), [rows]);
  const noGpsRows = useMemo(() => rows.filter((row) => !row.gps), [rows]);
  const gpsLayout = useMemo(() => layoutByGps(gpsRows), [gpsRows]);

  const markerTooltip = (row) => [
    row.statusLabel || 'Moisture',
    `${formatNumber(row.moisture, 0)}%`,
    row.observedAt ? formatDate(row.observedAt) : null,
  ].filter(Boolean).join(' · ');

  return (
    <Box>
      <PageHeader
        section="Monitoring"
        title="Moisture"
        subtitle={`Latest soil-sensor moisture for each tree. Adequate band is ${moistureStandard.rangeLabel}.`}
      />

      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
              <Typography variant="h6">Moisture by tree</Typography>
              <Typography variant="caption" color="text.secondary">
                {rows.length} tree{rows.length === 1 ? '' : 's'} with a reading
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              <Chip size="small" color="warning" label="Low" />
              <Chip size="small" color="success" label="Adequate" />
              <Chip size="small" color="error" label="High" />
            </Box>
            {rows.length > 0 ? (
              <>
                {gpsLayout.items.length > 0 ? (
                  <Box sx={{ position: 'relative' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      North ↑ · placed by GPS
                    </Typography>
                    <Box
                      sx={{
                        position: 'relative',
                        width: '100%',
                        aspectRatio: String(gpsLayout.aspect),
                        minHeight: 320,
                        maxHeight: 640,
                        bgcolor: alpha(theme.palette.grey[500], 0.06),
                        borderRadius: 1,
                      }}
                    >
                      {gpsLayout.items.map((row) => (
                        <Box
                          key={row.treeId}
                          sx={{
                            position: 'absolute',
                            left: `${row.x * 100}%`,
                            top: `${row.y * 100}%`,
                            transform: 'translate(-50%, -50%)',
                            zIndex: 1,
                          }}
                        >
                          <TreeMoistureMarker
                            row={row}
                            color={moistureDotColor(theme, row.status)}
                            tooltip={markerTooltip(row)}
                          />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <Typography color="text.secondary" sx={{ mb: 1 }}>
                    Trees with moisture readings need GPS on their position to appear on this layout.
                  </Typography>
                )}
                {noGpsRows.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      {noGpsRows.length} tree{noGpsRows.length === 1 ? '' : 's'} without GPS
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      {noGpsRows.map((row) => (
                        <TreeMoistureMarker
                          key={row.treeId}
                          row={row}
                          color={moistureDotColor(theme, row.status)}
                          tooltip={markerTooltip(row)}
                        />
                      ))}
                    </Box>
                  </Box>
                )}
              </>
            ) : (
              <Typography color="text.secondary">
                No moisture readings yet. Record them on Soil monitoring or a tree Soil tab.
              </Typography>
            )}
          </Paper>

          {rows.length > 0 && (
            <Paper variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Tree</TableCell>
                    <TableCell align="right">Moisture</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Observed</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.treeId} hover>
                      <TableCell>
                        <Typography
                          component={RouterLink}
                          to={treeDashboardUrl(row.tree, 'soil')}
                          sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}
                        >
                          {row.tree}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{formatNumber(row.moisture, 0)}%</TableCell>
                      <TableCell>
                        {row.statusLabel ? (
                          <Chip size="small" color={moistureChipColor(row.status)} label={row.statusLabel} />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>{formatDate(row.observedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}

export default MoistureMonitoringPage;
