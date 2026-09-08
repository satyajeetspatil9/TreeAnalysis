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
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/common/PageHeader';
import { GpsTreeDotMap } from '../../components/common/GpsTreeDotMap';
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

  const mapItems = useMemo(
    () => rows.map((row) => ({
      id: row.treeId,
      label: row.tree,
      to: treeDashboardUrl(row.tree, 'soil'),
      color: moistureDotColor(theme, row.status),
      gps: row.gps,
      tooltip: [
        row.statusLabel || 'Moisture',
        `${formatNumber(row.moisture, 0)}%`,
        row.observedAt ? formatDate(row.observedAt) : null,
      ].filter(Boolean).join(' · '),
    })),
    [rows, theme],
  );

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
              <GpsTreeDotMap
                items={mapItems}
                emptyGpsText="Trees with moisture readings need GPS on their position to appear on this layout."
              />
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
