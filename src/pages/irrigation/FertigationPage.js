import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Grid, TextField, Button, FormControl, InputLabel, Select, MenuItem,
  Alert, IconButton, Table, TableBody, TableCell, TableHead, TableRow, Stack,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { calcIrrigationWaterLiters, formatWaterLiters } from '../../utils/irrigation';
import {
  getProductStock,
  productStockLabel,
  validateFertilizerStock,
} from '../../utils/products';
import { formatDate } from '../../utils/formatters';
import {
  deleteFertigationEvent,
  emptyFertigationLineItem,
  formatFertilizerProductLines,
  loadFarmFertigationEvents,
  resetFertigationForm,
} from '../../utils/fertilizerEventMaintenance';

function rlsHint(message) {
  if (!message) return message;
  if (message.includes('Insufficient stock')) return message;
  if (message?.includes('row-level security')) {
    return `${message} Re-run supabase/migrations/008_fix_irrigation_rls.sql and 019_fertilizer_event_delete.sql in Supabase SQL Editor.`;
  }
  return message;
}

async function loadFertilizerProducts() {
  const { data } = await supabase
    .from('products')
    .select('*, inventory(current_stock)')
    .eq('active', true)
    .eq('category', 'Fertilizer')
    .order('name');
  return data || [];
}

function FertigationPage() {
  const { farm } = useFarm();
  const [zones, setZones] = useState([]);
  const [products, setProducts] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(resetFertigationForm());
  const [fertilizers, setFertilizers] = useState([emptyFertigationLineItem()]);
  const [editingId, setEditingId] = useState(null);
  const [nutrients, setNutrients] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const selectedZone = useMemo(
    () => zones.find((z) => String(z.id) === form.zone_id),
    [zones, form.zone_id]
  );

  const estimatedWater = useMemo(
    () => calcIrrigationWaterLiters(selectedZone?.flow_rate_lph, form.duration_minutes),
    [selectedZone, form.duration_minutes]
  );

  const reloadProducts = async () => {
    setProducts(await loadFertilizerProducts());
  };

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
        setProducts([]);
        setEvents([]);
        return;
      }
      const { data: zonesData } = await supabase
        .from('irrigation_zones')
        .select('*')
        .eq('farm_id', farm.id)
        .order('zone_code');
      setZones(zonesData || []);
      await reloadProducts();
    }
    load();
  }, [farm]);

  useEffect(() => {
    reloadEvents();
  }, [reloadEvents]);

  const resetFormState = () => {
    setEditingId(null);
    setForm(resetFertigationForm());
    setFertilizers([emptyFertigationLineItem()]);
    setNutrients(null);
  };

  const calculateNutrients = () => {
    const supplied = { N: 0, K: 0, Mg: 0 };
    fertilizers.forEach((f) => {
      const product = products.find((p) => String(p.id) === String(f.product_id));
      if (!product || !f.quantity) return;
      const qty = Number(f.quantity);
      const profile = product.nutrient_composition || {};
      supplied.N += qty * (Number(profile.N) || 0) / 100;
      supplied.K += qty * (Number(profile.K) || 0) / 100;
      supplied.Mg += qty * (Number(profile.Mg) || 0) / 100;
    });
    setNutrients(supplied);
  };

  const startEdit = (event) => {
    setEditingId(event.id);
    setForm({
      zone_id: String(event.zone_id),
      event_date: event.event_date,
      duration_minutes: String(event.duration_minutes ?? ''),
    });
    setFertilizers(
      (event.fertigation_products || []).length
        ? event.fertigation_products.map((row) => ({
          product_id: String(row.product_id),
          quantity: String(row.quantity),
        }))
        : [emptyFertigationLineItem()]
    );
    setNutrients(null);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

    if (editingId === event.id) resetFormState();
    await reloadProducts();
    await reloadEvents();
    setMessage({ type: 'success', text: 'Fertigation record deleted. Stock restored.' });
    setSaving(false);
  };

  const handleApply = async () => {
    if (!form.zone_id) {
      setMessage({ type: 'error', text: 'Select irrigation zone.' });
      return;
    }
    if (!form.duration_minutes) {
      setMessage({ type: 'error', text: 'Enter duration (minutes).' });
      return;
    }
    if (!selectedZone?.flow_rate_lph) {
      setMessage({
        type: 'error',
        text: 'This zone has no flow rate. Set it under Irrigation → Zones first.',
      });
      return;
    }

    const stockCheck = validateFertilizerStock(products, fertilizers);
    if (!stockCheck.ok) {
      setMessage({ type: 'error', text: stockCheck.message });
      return;
    }

    setSaving(true);
    setMessage(null);
    const wasEditing = editingId;
    try {
      if (editingId) {
        const { error: deleteError } = await deleteFertigationEvent(supabase, editingId);
        if (deleteError) throw deleteError;
      }

      const waterLiters = calcIrrigationWaterLiters(selectedZone.flow_rate_lph, form.duration_minutes);

      const { data: event, error: eventError } = await supabase
        .from('fertigation_events')
        .insert([{
          zone_id: Number(form.zone_id),
          event_date: form.event_date,
          duration_minutes: Number(form.duration_minutes),
          water_liters: waterLiters,
        }])
        .select()
        .single();

      if (eventError) throw eventError;

      const lineItems = fertilizers
        .filter((f) => f.product_id && f.quantity)
        .map((f) => {
          const product = products.find((p) => String(p.id) === String(f.product_id));
          return {
            fertigation_event_id: event.id,
            product_id: Number(f.product_id),
            quantity: Number(f.quantity),
            unit: product?.unit || 'kg',
          };
        });

      if (lineItems.length > 0) {
        const { error: productsError } = await supabase.from('fertigation_products').insert(lineItems);
        if (productsError) throw productsError;
      }

      await reloadProducts();
      await reloadEvents();
      resetFormState();
      setMessage({
        type: 'success',
        text: wasEditing
          ? 'Fertigation updated. Stock and costs recalculated.'
          : `Fertigation applied (${formatWaterLiters(waterLiters)}). Stock deducted from inventory.`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: rlsHint(err.message) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <PageHeader
        section="Irrigation"
        title="Fertigation"
        subtitle="Apply fertilizer through drip. Products are deducted from Inventory stock."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Create a farm in Settings before recording fertigation.</Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        {editingId && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Editing fertigation record #{editingId}. Saving replaces the old record and recalculates stock/cost.
            <Button size="small" sx={{ ml: 2 }} onClick={resetFormState}>Cancel edit</Button>
          </Alert>
        )}

        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth required disabled={!farm}>
              <InputLabel>Irrigation Zone</InputLabel>
              <Select
                value={form.zone_id}
                label="Irrigation Zone"
                onChange={(e) => setForm({ ...form, zone_id: e.target.value })}
              >
                {zones.map((z) => <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Date"
              type="date"
              fullWidth
              required
              InputLabelProps={{ shrink: true }}
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Duration (min)"
              type="number"
              fullWidth
              required
              value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
              helperText={
                selectedZone?.flow_rate_lph
                  ? `Zone flow: ${selectedZone.flow_rate_lph} L/hr`
                  : form.zone_id
                    ? 'Set flow rate on Irrigation → Zones'
                    : undefined
              }
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Estimated water (L)"
              fullWidth
              value={estimatedWater != null ? String(Math.round(estimatedWater)) : ''}
              InputProps={{ readOnly: true }}
              helperText="Auto: flow rate × duration"
            />
          </Grid>
        </Grid>

        <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>Fertilizers (from stock)</Typography>
        {fertilizers.map((f, idx) => {
          const product = products.find((p) => String(p.id) === String(f.product_id));
          const stock = getProductStock(product);
          return (
            <Box
              key={idx}
              sx={{
                display: 'flex',
                flexDirection: 'row',
                gap: 2,
                mb: 1,
                alignItems: 'flex-start',
              }}
            >
              <FormControl fullWidth sx={{ flex: 2, minWidth: 0 }}>
                <InputLabel>Product</InputLabel>
                <Select
                  value={f.product_id}
                  label="Product"
                  onChange={(e) => {
                    const next = [...fertilizers];
                    next[idx].product_id = e.target.value;
                    setFertilizers(next);
                  }}
                >
                  {products.map((p) => (
                    <MenuItem key={p.id} value={String(p.id)} disabled={!editingId && getProductStock(p) <= 0}>
                      {productStockLabel(p)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Quantity"
                type="number"
                sx={{ flex: 1, minWidth: 120 }}
                value={f.quantity}
                onChange={(e) => {
                  const next = [...fertilizers];
                  next[idx].quantity = e.target.value;
                  setFertilizers(next);
                }}
                helperText={product ? `Stock: ${stock} ${product.unit}` : 'Record purchase in Inventory first'}
              />
              <IconButton
                sx={{ mt: 1, flexShrink: 0 }}
                onClick={() => setFertilizers(fertilizers.filter((_, i) => i !== idx))}
                disabled={fertilizers.length === 1}
              >
                <DeleteIcon />
              </IconButton>
            </Box>
          );
        })}
        <Button onClick={() => setFertilizers([...fertilizers, emptyFertigationLineItem()])} sx={{ mb: 2 }}>
          + Add Fertilizer
        </Button>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={calculateNutrients}>Calculate Nutrients</Button>
          <Button variant="contained" onClick={handleApply} disabled={saving || !farm}>
            {editingId ? 'Update fertigation' : 'Apply fertigation'}
          </Button>
        </Box>

        {nutrients && (
          <Paper sx={{ p: 2, mt: 2, bgcolor: 'action.hover' }}>
            <Typography>N supplied: {nutrients.N.toFixed(2)} kg</Typography>
            <Typography>K supplied: {nutrients.K.toFixed(2)} kg</Typography>
            <Typography>Mg supplied: {nutrients.Mg.toFixed(2)} kg</Typography>
          </Paper>
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
            {events.map((event) => (
              <TableRow key={event.id} selected={editingId === event.id}>
                <TableCell>{formatDate(event.event_date)}</TableCell>
                <TableCell>{event.irrigation_zones?.zone_code || '—'}</TableCell>
                <TableCell>{formatFertilizerProductLines(event.fertigation_products)}</TableCell>
                <TableCell>{event.water_liters ? `${Math.round(event.water_liters)} L` : '—'}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <IconButton size="small" aria-label="Edit" onClick={() => startEdit(event)} disabled={saving}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label="Delete" onClick={() => handleDelete(event)} disabled={saving}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {events.length === 0 && (
              <TableRow><TableCell colSpan={5}>No fertigation records yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default FertigationPage;
