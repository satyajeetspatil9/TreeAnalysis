import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, TextField, Button, FormControl, InputLabel, Select, MenuItem,
  Alert, IconButton, Table, TableBody, TableCell, TableHead, TableRow, Stack,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { getProductStock, inventoryStockHint, loadSprayProducts, productStockLabel, validateFertilizerStock } from '../../utils/products';
import { formatDate } from '../../utils/formatters';
import {
  deleteSprayEvent,
  emptyFertigationLineItem,
  formatFertilizerProductLines,
  loadFarmSprayEvents,
} from '../../utils/fertilizerEventMaintenance';

function rlsHint(message) {
  if (!message) return message;
  if (message.includes('Insufficient stock')) return message;
  if (message?.includes('row-level security')) {
    return `${message} Re-run supabase/migrations/022_spray_event_delete.sql in Supabase SQL Editor.`;
  }
  return message;
}

function resetSprayForm() {
  return {
    zone_id: '',
    event_date: new Date().toISOString().slice(0, 10),
    purpose: '',
  };
}

function SprayPage() {
  const { farm } = useFarm();
  const [zones, setZones] = useState([]);
  const [products, setProducts] = useState([]);
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(resetSprayForm());
  const [lineItems, setLineItems] = useState([emptyFertigationLineItem()]);

  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const sprayProducts = useMemo(() => products, [products]);

  const reloadProducts = async () => {
    try {
      const sprayList = await loadSprayProducts(supabase);
      setProducts(sprayList);
      return sprayList;
    } catch (err) {
      setProducts([]);
      setMessage({ type: 'error', text: inventoryStockHint(err.message) });
      return [];
    }
  };

  const reloadEvents = useCallback(async () => {
    if (!zoneIds.length) {
      setEvents([]);
      return;
    }
    try {
      setEvents(await loadFarmSprayEvents(supabase, zoneIds));
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
        .select('id, zone_code')
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
    setForm(resetSprayForm());
    setLineItems([emptyFertigationLineItem()]);
  };

  const startEdit = (event) => {
    setEditingId(event.id);
    setForm({
      zone_id: event.zone_id ? String(event.zone_id) : '',
      event_date: event.event_date,
      purpose: event.purpose || '',
    });
    setLineItems(
      (event.spray_products || []).length
        ? event.spray_products.map((row) => ({
          product_id: String(row.product_id),
          quantity: String(row.quantity),
        }))
        : [emptyFertigationLineItem()]
    );
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (event) => {
    const label = `${formatDate(event.event_date)} · ${event.irrigation_zones?.zone_code || 'Zone'}`;
    if (!window.confirm(`Delete spray event (${label})? Stock and costs will be reversed.`)) return;

    setSaving(true);
    setMessage(null);
    const { error } = await deleteSprayEvent(supabase, event.id);
    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      setSaving(false);
      return;
    }

    if (editingId === event.id) resetFormState();
    await reloadProducts();
    await reloadEvents();
    setMessage({ type: 'success', text: 'Spray deleted. Stock restored.' });
    setSaving(false);
  };

  const handleApply = async () => {
    setMessage(null);
    if (!form.zone_id) {
      setMessage({ type: 'error', text: 'Select an irrigation zone.' });
      return;
    }

    const items = lineItems.filter((li) => li.product_id && li.quantity);
    if (!items.length) {
      setMessage({ type: 'error', text: 'Add at least one product and quantity.' });
      return;
    }

    setSaving(true);
    const wasEditing = editingId;
    try {
      if (editingId) {
        const { error: deleteError } = await deleteSprayEvent(supabase, editingId);
        if (deleteError) throw deleteError;
        await reloadProducts();
      }

      const stockCheck = validateFertilizerStock(products, items);
      if (!stockCheck.ok) {
        setMessage({ type: 'error', text: stockCheck.message });
        setSaving(false);
        return;
      }

      const { data: event, error } = await supabase.from('spray_events').insert([{
        zone_id: Number(form.zone_id),
        event_date: form.event_date,
        purpose: form.purpose.trim() || null,
      }]).select().single();
      if (error) throw error;

      const productRows = items.map((li) => ({
        spray_event_id: event.id,
        product_id: Number(li.product_id),
        quantity: Number(li.quantity),
        unit: products.find((p) => p.id === Number(li.product_id))?.unit || 'L',
      }));

      const { error: pErr } = await supabase.from('spray_products').insert(productRows);
      if (pErr) throw pErr;

      resetFormState();
      await reloadProducts();
      await reloadEvents();
      setMessage({
        type: 'success',
        text: wasEditing
          ? 'Spray updated. Inventory and expenses adjusted.'
          : 'Spray recorded. Inventory and expenses updated automatically.',
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
        title="Spray / Plant Protection"
        subtitle="Record plant protection applications by zone. Stock is deducted and costs allocated to trees in the zone."
      />
      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Select or create a farm in Settings before recording spray events.</Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>{editingId ? 'Edit Spray' : 'New Spray'}</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth required>
              <InputLabel>Zone</InputLabel>
              <Select
                value={form.zone_id}
                label="Zone"
                onChange={(e) => setForm({ ...form, zone_id: e.target.value })}
              >
                {zones.map((z) => (
                  <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>
                ))}
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
          <Grid item xs={12} md={6}>
            <TextField
              label="Purpose"
              fullWidth
              placeholder="e.g. Fungicide for anthracnose"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </Grid>
        </Grid>

        <Typography variant="h6" sx={{ mt: 2 }}>Products</Typography>
        {sprayProducts.length === 0 ? (
          <Alert severity="warning" sx={{ mt: 1, mb: 1 }}>
            No plant protection products found. Add products under{' '}
            <Button component={RouterLink} to="/inputs/add-product" size="small" sx={{ ml: 0.5, mr: 0.5 }}>
              Inputs → Add Product
            </Button>
            with category <strong>Plant Protection</strong>, then record a purchase in Inventory.
          </Alert>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
            {sprayProducts.length} product{sprayProducts.length === 1 ? '' : 's'} available from inventory.
          </Typography>
        )}
        {lineItems.map((li, idx) => (
          <Grid container spacing={2} key={idx} sx={{ mt: 1 }} alignItems="center">
            <Grid item xs={12} md={5}>
              <FormControl fullWidth>
                <InputLabel>Product</InputLabel>
                <Select
                  value={li.product_id}
                  label="Product"
                  displayEmpty
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[idx].product_id = e.target.value;
                    setLineItems(next);
                  }}
                >
                  <MenuItem value="" disabled>Select product</MenuItem>
                  {sprayProducts.map((p) => (
                    <MenuItem key={p.id} value={String(p.id)}>{productStockLabel(p)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={5}>
              <TextField
                label="Quantity"
                fullWidth
                type="number"
                inputProps={{ min: 0, step: 'any' }}
                value={li.quantity}
                onChange={(e) => {
                  const next = [...lineItems];
                  next[idx].quantity = e.target.value;
                  setLineItems(next);
                }}
                helperText={
                  li.product_id
                    ? `${getProductStock(products.find((p) => String(p.id) === String(li.product_id)))} ${products.find((p) => String(p.id) === String(li.product_id))?.unit || ''} available`
                    : ''
                }
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <IconButton
                aria-label="Remove product"
                disabled={lineItems.length === 1}
                onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))}
              >
                <DeleteIcon />
              </IconButton>
            </Grid>
          </Grid>
        ))}

        <Button sx={{ mt: 1 }} onClick={() => setLineItems([...lineItems, emptyFertigationLineItem()])}>
          + Add product
        </Button>

        <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
          <Button variant="contained" onClick={handleApply} disabled={saving || !farm}>
            {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Apply Spray'}
          </Button>
          {editingId && (
            <Button variant="text" onClick={resetFormState} disabled={saving}>Cancel</Button>
          )}
          {!editingId && (
            <Button variant="text" onClick={resetFormState} disabled={saving}>Clear</Button>
          )}
        </Box>
      </Paper>

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Recent spray events</Typography>
        {!events.length ? (
          <Typography color="text.secondary">No spray events recorded for this farm yet.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Zone</TableCell>
                <TableCell>Purpose</TableCell>
                <TableCell>Products</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>{formatDate(event.event_date)}</TableCell>
                  <TableCell>{event.irrigation_zones?.zone_code || '—'}</TableCell>
                  <TableCell>{event.purpose || '—'}</TableCell>
                  <TableCell>{formatFertilizerProductLines(event.spray_products)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <IconButton aria-label="Edit spray" size="small" onClick={() => startEdit(event)} disabled={saving}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton aria-label="Delete spray" size="small" onClick={() => handleDelete(event)} disabled={saving}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  );
}

export default SprayPage;
