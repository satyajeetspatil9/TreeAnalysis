import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, CircularProgress,
  Grid, FormControl, InputLabel, Select, MenuItem, ToggleButtonGroup, ToggleButton, Chip, Stack,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import {
  calcTreeWaterShare,
  formatWaterLiters,
  filterEventsByPeriod,
  buildIrrigationChartData,
  IRRIGATION_PERIOD_OPTIONS,
  IRRIGATION_GROUP_OPTIONS,
  IRRIGATION_METRIC_OPTIONS,
} from '../../utils/irrigation';
import { getIrrigationZoneId } from '../../utils/schema';

const DEFAULT_METRICS = ['zoneWater', 'treeWater'];
const CHART_TYPES = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block" sx={{ fontWeight: 600, mb: 0.5 }}>{label}</Typography>
      {payload.map((entry) => (
        <Typography key={entry.dataKey} variant="body2" sx={{ color: entry.color }}>
          {entry.name}: {entry.dataKey === 'duration'
            ? `${formatNumber(entry.value, 0)} min`
            : formatWaterLiters(entry.value)}
        </Typography>
      ))}
      {row?.eventCount > 1 && (
        <Typography variant="caption" color="text.secondary">
          {row.eventCount} irrigation events
        </Typography>
      )}
    </Paper>
  );
}

function IrrigationTab({ tree, zoneCode }) {
  const theme = useTheme();
  const [events, setEvents] = useState([]);
  const [latest, setLatest] = useState(null);
  const [treeCount, setTreeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('180d');
  const [grouping, setGrouping] = useState('event');
  const [chartType, setChartType] = useState('line');
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);

  useEffect(() => {
    async function loadIrrigation() {
      setLoading(true);
      const zoneId = getIrrigationZoneId(tree);
      if (!zoneId) {
        setLoading(false);
        return;
      }

      const { count } = await supabase
        .from('tree_irrigation_zones')
        .select('*', { count: 'exact', head: true })
        .eq('zone_id', zoneId)
        .is('end_date', null);

      setTreeCount(count || 0);

      const { data } = await supabase
        .from('irrigation_events')
        .select('*')
        .eq('zone_id', zoneId)
        .order('event_date', { ascending: false });

      setEvents(data || []);
      setLatest(data?.[0] || null);
      setLoading(false);
    }

    loadIrrigation();
  }, [tree]);

  const filteredEvents = useMemo(
    () => filterEventsByPeriod(events, period),
    [events, period],
  );

  const tableEvents = useMemo(
    () => filteredEvents.slice(0, 20),
    [filteredEvents],
  );

  const chartData = useMemo(
    () => buildIrrigationChartData(filteredEvents, treeCount, grouping),
    [filteredEvents, treeCount, grouping],
  );

  const latestTreeWater = useMemo(
    () => calcTreeWaterShare(latest?.water_liters, treeCount),
    [latest, treeCount],
  );

  const metricColors = {
    zoneWater: theme.palette.primary.main,
    treeWater: theme.palette.secondary.main,
    duration: theme.palette.info.main,
  };

  const handleMetricsChange = (_, next) => {
    if (next.length) setMetrics(next);
  };

  if (loading) return <CircularProgress size={24} />;

  if (!getIrrigationZoneId(tree)) {
    return (
      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography color="text.secondary">This tree is not assigned to an irrigation zone.</Typography>
      </Paper>
    );
  }

  const renderSeries = (ChartComponent, SeriesComponent) => (
    metrics.map((metric) => {
      const meta = IRRIGATION_METRIC_OPTIONS.find((m) => m.value === metric);
      const props = {
        key: metric,
        dataKey: metric,
        name: meta?.label || metric,
        stroke: metricColors[metric],
        fill: metricColors[metric],
        strokeWidth: 2,
        yAxisId: metric === 'duration' ? 'duration' : 'water',
      };
      return ChartComponent === BarChart
        ? <SeriesComponent {...props} radius={[4, 4, 0, 0]} />
        : <SeriesComponent {...props} type="monotone" dot={{ r: 3 }} activeDot={{ r: 5 }} />;
    })
  );

  return (
    <Box>
      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Irrigation Dashboard — {zoneCode}</Typography>
        <Typography>Tree: {getTreeDisplayId(tree)}</Typography>
        {latest && (
          <>
            <Typography>Last irrigation: {formatDate(latest.event_date)}</Typography>
            <Typography>Duration: {latest.duration_minutes || '—'} min</Typography>
            <Typography>Zone water (total): {formatWaterLiters(latest.water_liters)}</Typography>
            <Typography>
              Water to this tree: {formatWaterLiters(latestTreeWater)}
              {treeCount > 1 && ` (÷ ${treeCount} trees)`}
            </Typography>
            <Typography>Flow: {latest.flow_rate_lph ? `${formatNumber(latest.flow_rate_lph, 0)} L/hr` : '—'}</Typography>
          </>
        )}
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Irrigation Chart</Typography>

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Period</InputLabel>
              <Select label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
                {IRRIGATION_PERIOD_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Group by</InputLabel>
              <Select label="Group by" value={grouping} onChange={(e) => setGrouping(e.target.value)}>
                {IRRIGATION_GROUP_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Chart type</InputLabel>
              <Select label="Chart type" value={chartType} onChange={(e) => setChartType(e.target.value)}>
                {CHART_TYPES.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ height: '100%' }}>
              <Chip size="small" label={`${filteredEvents.length} events`} variant="outlined" />
            </Stack>
          </Grid>
        </Grid>

        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            Metrics
          </Typography>
          <ToggleButtonGroup
            size="small"
            value={metrics}
            onChange={handleMetricsChange}
            aria-label="irrigation metrics"
          >
            {IRRIGATION_METRIC_OPTIONS.map((m) => (
              <ToggleButton key={m.value} value={m.value}>{m.label}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            {chartType === 'bar' ? (
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                <XAxis dataKey="label" tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                <YAxis
                  yAxisId="water"
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  label={{ value: 'Liters', angle: -90, position: 'insideLeft', fill: theme.palette.text.secondary }}
                />
                {metrics.includes('duration') && (
                  <YAxis
                    yAxisId="duration"
                    orientation="right"
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                    label={{ value: 'Minutes', angle: 90, position: 'insideRight', fill: theme.palette.text.secondary }}
                  />
                )}
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                {renderSeries(BarChart, Bar)}
              </BarChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                <XAxis dataKey="label" tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                <YAxis
                  yAxisId="water"
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  label={{ value: 'Liters', angle: -90, position: 'insideLeft', fill: theme.palette.text.secondary }}
                />
                {metrics.includes('duration') && (
                  <YAxis
                    yAxisId="duration"
                    orientation="right"
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                    label={{ value: 'Minutes', angle: 90, position: 'insideRight', fill: theme.palette.text.secondary }}
                  />
                )}
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                {renderSeries(LineChart, Line)}
              </LineChart>
            )}
          </ResponsiveContainer>
        ) : (
          <Typography color="text.secondary">No irrigation events in the selected period.</Typography>
        )}
      </Paper>

      <Paper variant="outlined">
        <Box sx={{ px: 2, pt: 2, pb: 1 }}>
          <Typography variant="h6">Recent Events</Typography>
          <Typography variant="caption" color="text.secondary">
            Showing up to 20 events for the selected period
          </Typography>
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell align="right">Zone water</TableCell>
              <TableCell align="right">This tree</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tableEvents.map((e) => {
              const treeWater = calcTreeWaterShare(e.water_liters, treeCount);
              return (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.event_date)}</TableCell>
                  <TableCell>{e.duration_minutes ? `${e.duration_minutes} min` : '—'}</TableCell>
                  <TableCell align="right">{formatWaterLiters(e.water_liters)}</TableCell>
                  <TableCell align="right">{formatWaterLiters(treeWater)}</TableCell>
                </TableRow>
              );
            })}
            {tableEvents.length === 0 && (
              <TableRow><TableCell colSpan={4} align="center">No irrigation events recorded.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default IrrigationTab;
