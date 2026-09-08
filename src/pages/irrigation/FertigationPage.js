import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Grid, FormControl, InputLabel, Select, MenuItem,
  Alert, IconButton, Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber } from '../../utils/formatters';
import {
  formatWaterLiters,
  resolveEventWaterLiters,
  filterEventsByPeriod,
  buildFarmFertigationChartData,
  IRRIGATION_PERIOD_OPTIONS,
  IRRIGATION_GROUP_OPTIONS,
} from '../../utils/irrigation';
import {
  deleteFertigationEvent,
  formatFertilizerProductLines,
  loadFarmFertigationEvents,
} from '../../utils/fertilizerEventMaintenance';

function rlsHint(message) {
  if (!message) return message;
  if (message.includes('Insufficient stock')) return message;
  if (message?.includes('row-level security')) {
    return `${message} Re-run supabase/migrations/008_fix_irrigation_rls.sql and 019_fertilizer_event_delete.sql in Supabase SQL Editor.`;
  }
  return message;
}

function FertigationPage() {
  const theme = useTheme();
  const { farm } = useFarm();
  const [zones, setZones] = useState([]);
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [period, setPeriod] = useState('180d');
  const [grouping, setGrouping] = useState('week');

  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const reloadEvents = useCallback(async () => {
    if (!zoneIds.length) {
      setEvents([]);
      return;
    }
    try {
      setEvents(await loadFarmFertigationEvents(supabase, zoneIds));
    } catch (err) {
      setMessage({ type: 'error', text: rlsHint(err.message) });
    }
  }, [zoneIds]);

  useEffect(() => {
    async function load() {
      if (!farm) {
        setZones([]);
        setEvents([]);
        return;
      }
      const { data: zonesData } = await supabase
        .from('irrigation_zones')
        .select('*')
        .eq('farm_id', farm.id)
        .order('zone_code');
      setZones(zonesData || []);
    }
    load();
  }, [farm]);

  useEffect(() => {
    reloadEvents();
  }, [reloadEvents]);

  const filteredEvents = useMemo(
    () => filterEventsByPeriod(events, period),
    [events, period],
  );

  const chartData = useMemo(
    () => buildFarmFertigationChartData(filteredEvents, grouping),
    [filteredEvents, grouping],
  );

  const handleDelete = async (event) => {
    const label = `${formatDate(event.event_date)} · ${event.irrigation_zones?.zone_code || 'Zone'}`;
    if (!window.confirm(`Delete fertigation record (${label})? Stock and costs will be reversed.`)) return;

    setSaving(true);
    setMessage(null);
    const { error } = await deleteFertigationEvent(supabase, event.id);
    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      setSaving(false);
      return;
    }

    await reloadEvents();
    setMessage({ type: 'success', text: 'Fertigation record deleted. Stock restored.' });
    setSaving(false);
  };

  return (
    <Box>
      <PageHeader
        section="Monitoring"
        title="Fertigation"
        subtitle="Fertilizer applied through drip from programs and logged events."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Create a farm in Settings before viewing fertigation.</Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Fertigation applied</Typography>
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
        </Grid>

        {chartData.length > 0 ? (
          <Box sx={{ width: '100%', height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                <XAxis dataKey="label" tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                <YAxis
                  yAxisId="water"
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  label={{ value: 'Liters', angle: -90, position: 'insideLeft', fill: theme.palette.text.secondary }}
                />
                <YAxis
                  yAxisId="product"
                  orientation="right"
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  label={{ value: 'Product qty', angle: 90, position: 'insideRight', fill: theme.palette.text.secondary }}
                />
                <Tooltip
                  formatter={(value, name) => (
                    name === 'Product qty'
                      ? formatNumber(value, 2)
                      : formatWaterLiters(value)
                  )}
                />
                <Legend />
                <Line
                  yAxisId="water"
                  type="monotone"
                  dataKey="water"
                  name="Water (L)"
                  stroke={theme.palette.primary.main}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="product"
                  type="monotone"
                  dataKey="productQty"
                  name="Product qty"
                  stroke={theme.palette.secondary.main}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        ) : (
          <Typography color="text.secondary">No fertigation events in the selected period.</Typography>
        )}
      </Paper>

      <Paper variant="outlined">
        <Typography variant="h6" sx={{ p: 2, pb: 0 }}>Recent fertigation</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell>Products</TableCell>
              <TableCell>Water</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredEvents.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{formatDate(event.event_date)}</TableCell>
                <TableCell>{event.irrigation_zones?.zone_code || '—'}</TableCell>
                <TableCell>{formatFertilizerProductLines(event.fertigation_products)}</TableCell>
                <TableCell>{formatWaterLiters(resolveEventWaterLiters(event))}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" aria-label="Delete" onClick={() => handleDelete(event)} disabled={saving}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {filteredEvents.length === 0 && (
              <TableRow><TableCell colSpan={5}>No fertigation records yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default FertigationPage;
