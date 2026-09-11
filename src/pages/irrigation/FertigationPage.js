import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, FormControl, InputLabel, Select, MenuItem,
  Alert, IconButton, Table, TableBody, TableCell, TableHead, TableRow,
  Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, formatTime } from '../../utils/formatters';
import { getProductStock, productStockLabel, validateFertilizerStock } from '../../utils/products';
import {
  formatWaterLiters,
  resolveEventWaterLiters,
  filterEventsByPeriod,
  buildFarmFertigationChartData,
  IRRIGATION_PERIOD_OPTIONS,
  IRRIGATION_GROUP_OPTIONS,
} from '../../utils/irrigation';
import {
  addProductsToFertigationEvent,
  deleteFertigationEvent,
  emptyFertigationLineItem,
  formatFertilizerProductLines,
  syncCompletedFertigationJobs,
} from '../../utils/fertilizerEventMaintenance';

function rlsHint(message) {
  if (!message) return message;
  if (message.includes('Insufficient stock')) return message;
  if (message?.includes('irrigation_program_products')) {
    return `${message} Run supabase/migrations/056_irrigation_program_products.sql in Supabase SQL Editor.`;
  }
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
  const [products, setProducts] = useState([]);
  const [productEvent, setProductEvent] = useState(null);
  const [lineItems, setLineItems] = useState([emptyFertigationLineItem()]);

  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const reloadEvents = useCallback(async () => {
    if (!farm?.id || !zoneIds.length) {
      setEvents([]);
      return;
    }
    try {
      const { events: nextEvents, productError } = await syncCompletedFertigationJobs(supabase, {
        farmId: farm.id,
        zoneIds,
      });
      setEvents(nextEvents);
      if (productError) {
        setMessage({ type: 'warning', text: rlsHint(productError.message) });
      }
    } catch (err) {
      setMessage({ type: 'error', text: rlsHint(err.message) });
    }
  }, [farm?.id, zoneIds]);

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
      const { data: productsData } = await supabase
        .from('products')
        .select('*, inventory(current_stock)')
        .eq('active', true)
        .eq('category', 'Fertilizer')
        .order('name');
      setProducts(productsData || []);
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

  const handleSaveProducts = async () => {
    if (!productEvent) return;
    const items = lineItems.filter((li) => li.product_id && li.quantity);
    const stockCheck = validateFertilizerStock(products, items);
    if (!stockCheck.ok) {
      setMessage({ type: 'error', text: stockCheck.message });
      return;
    }
    setSaving(true);
    setMessage(null);
    const { error } = await addProductsToFertigationEvent(
      supabase,
      productEvent.id,
      items.map((li) => {
        const product = products.find((p) => String(p.id) === String(li.product_id));
        return {
          product_id: li.product_id,
          quantity: li.quantity,
          unit: product?.unit || 'kg',
        };
      }),
    );
    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      setSaving(false);
      return;
    }
    setProductEvent(null);
    await reloadEvents();
    setMessage({ type: 'success', text: 'Products added. Inventory updated.' });
    setSaving(false);
  };

  return (
    <Box>
      <PageHeader
        section="Monitoring"
        title="Fertigation"
        subtitle={(
          <>
            Fertilizer applied through drip. Add the mix on{' '}
            <Button component={RouterLink} to="/orchard/irrigation?tab=programs" size="small" sx={{ minWidth: 0, px: 0.5 }}>
              Irrigation → Programs
            </Button>
            {' '}so completed jobs show products here.
          </>
        )}
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
              <TableCell>Start</TableCell>
              <TableCell>End</TableCell>
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
                <TableCell>{formatTime(event.started_at)}</TableCell>
                <TableCell>{formatTime(event.ended_at)}</TableCell>
                <TableCell>{event.irrigation_zones?.zone_code || '—'}</TableCell>
                <TableCell>{formatFertilizerProductLines(event.fertigation_products)}</TableCell>
                <TableCell>{formatWaterLiters(resolveEventWaterLiters(event))}</TableCell>
                <TableCell align="right">
                  {!(event.fertigation_products || []).length && (
                    <Button
                      size="small"
                      onClick={() => {
                        setProductEvent(event);
                        setLineItems([emptyFertigationLineItem()]);
                      }}
                      disabled={saving}
                    >
                      Add products
                    </Button>
                  )}
                  <IconButton size="small" aria-label="Delete" onClick={() => handleDelete(event)} disabled={saving}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {filteredEvents.length === 0 && (
              <TableRow><TableCell colSpan={7}>No fertigation records yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={Boolean(productEvent)} onClose={() => setProductEvent(null)} fullWidth maxWidth="sm">
        <DialogTitle>Add products</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {productEvent
              ? `${formatDate(productEvent.event_date)} · ${productEvent.irrigation_zones?.zone_code || 'Zone'}`
              : ''}
          </Typography>
          {products.length === 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              No fertilizer products found. Add them under Inputs, then record a purchase in Inventory.
            </Alert>
          )}
          {lineItems.map((li, idx) => (
            <Grid container spacing={2} key={idx} sx={{ mb: 1 }} alignItems="center">
              <Grid item xs={12} sm={7}>
                <FormControl fullWidth size="small">
                  <InputLabel>Product</InputLabel>
                  <Select
                    label="Product"
                    value={li.product_id}
                    onChange={(e) => {
                      const next = [...lineItems];
                      next[idx] = { ...next[idx], product_id: e.target.value };
                      setLineItems(next);
                    }}
                  >
                    <MenuItem value="">Select product</MenuItem>
                    {products.map((p) => (
                      <MenuItem key={p.id} value={String(p.id)}>{productStockLabel(p)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={8} sm={4}>
                <TextField
                  size="small"
                  fullWidth
                  label="Quantity"
                  type="number"
                  value={li.quantity}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[idx] = { ...next[idx], quantity: e.target.value };
                    setLineItems(next);
                  }}
                  helperText={
                    li.product_id
                      ? `${getProductStock(products.find((p) => String(p.id) === String(li.product_id)))} available`
                      : ' '
                  }
                />
              </Grid>
              <Grid item xs={4} sm={1}>
                <IconButton
                  aria-label="Remove product"
                  disabled={lineItems.length <= 1}
                  onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))}
                >
                  <DeleteIcon />
                </IconButton>
              </Grid>
            </Grid>
          ))}
          <Button size="small" onClick={() => setLineItems([...lineItems, emptyFertigationLineItem()])}>
            Add product
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProductEvent(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveProducts} disabled={saving || !products.length}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default FertigationPage;
