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
import { getProductStock, productStockLabel, validateFertilizerStock } from '../../utils/products';
import { formatDate } from '../../utils/formatters';
import {
  deleteSoilApplicationEvent,
  emptySoilLineItem,
  formatFertilizerProductLines,
  loadFarmSoilApplicationEvents,
  resetSoilForm,
  soilApplicationTargetLabel,
} from '../../utils/fertilizerEventMaintenance';

const APPLICATION_METHODS = ['Basin', 'Broadcast', 'Band', 'Ring', 'Other'];

function rlsHint(message) {
  if (!message) return message;
  if (message.includes('Insufficient stock')) return message;
  if (message?.includes('tree_id') || message?.includes('018')) {
    return `${message} Run supabase/migrations/018_soil_application_tree.sql in Supabase SQL Editor.`;
  }
  if (message?.includes('row-level security')) {
    return `${message} Re-run supabase/migrations/018_soil_application_tree.sql and 019_fertilizer_event_delete.sql in Supabase SQL Editor.`;
  }
  return message;
}

function SoilApplicationPage() {
  const { farm } = useFarm();
  const [zones, setZones] = useState([]);
  const [trees, setTrees] = useState([]);
  const [products, setProducts] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(resetSoilForm());
  const [lineItems, setLineItems] = useState([emptySoilLineItem()]);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const fertilizerProducts = useMemo(
    () => products.filter((p) => p.category === 'Fertilizer'),
    [products]
  );

  const reloadProducts = async () => {
    const { data: productsData } = await supabase
      .from('products')
      .select('*, inventory(current_stock)')
      .eq('active', true)
      .eq('category', 'Fertilizer')
      .order('name');
    setProducts(productsData || []);
  };

  const reloadEvents = useCallback(async () => {
    if (!zoneIds.length) {
      setEvents([]);
      return;
    }
    try {
      setEvents(await loadFarmSoilApplicationEvents(supabase, zoneIds));
    } catch (err) {
      setMessage({ type: 'error', text: rlsHint(err.message) });
    }
  }, [zoneIds]);

  useEffect(() => {
    async function load() {
      if (!farm) {
        setZones([]);
        setTrees([]);
        setProducts([]);
        setEvents([]);
        return;
      }
      const [{ data: zonesData }, { data: treesData }] = await Promise.all([
        supabase
          .from('irrigation_zones')
          .select('id, zone_code')
          .eq('farm_id', farm.id)
          .order('zone_code'),
        supabase
          .from('trees')
          .select('id, tree_positions(position_code)')
          .eq('status', 'Active'),
      ]);
      setZones(zonesData || []);
      setTrees(treesData || []);
      await reloadProducts();
    }
    load();
  }, [farm]);

  useEffect(() => {
    reloadEvents();
  }, [reloadEvents]);

  const resetFormState = () => {
    setEditingId(null);
    setForm(resetSoilForm());
    setLineItems([emptySoilLineItem()]);
  };

  const startEdit = (event) => {
    setEditingId(event.id);
    setForm({
      scope: event.tree_id ? 'tree' : 'zone',
      zone_id: event.zone_id ? String(event.zone_id) : '',
      tree_id: event.tree_id || '',
      event_date: event.event_date,
      application_method: event.application_method,
      notes: event.notes || '',
    });
    setLineItems(
      (event.soil_application_products || []).length
        ? event.soil_application_products.map((row) => ({
          product_id: String(row.product_id),
          quantity: String(row.quantity),
        }))
        : [emptySoilLineItem()]
    );
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (event) => {
    const label = `${formatDate(event.event_date)} · ${soilApplicationTargetLabel(event)}`;
    if (!window.confirm(`Delete soil application (${label})? Stock and costs will be reversed.`)) return;

    setSaving(true);
    setMessage(null);
    const { error } = await deleteSoilApplicationEvent(supabase, event.id);
    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      setSaving(false);
      return;
    }

    if (editingId === event.id) resetFormState();
    await reloadProducts();
    await reloadEvents();
    setMessage({ type: 'success', text: 'Soil application deleted. Stock restored.' });
    setSaving(false);
  };

  const handleApply = async () => {
    if (form.scope === 'zone' && !form.zone_id) {
      setMessage({ type: 'error', text: 'Select irrigation zone.' });
      return;
    }
    if (form.scope === 'tree' && !form.tree_id) {
      setMessage({ type: 'error', text: 'Select tree.' });
      return;
    }

    const items = lineItems.filter((li) => li.product_id && li.quantity);
    if (!items.length) {
      setMessage({ type: 'error', text: 'Add at least one fertilizer product and quantity.' });
      return;
    }

    const stockCheck = validateFertilizerStock(products, items);
    if (!stockCheck.ok) {
      setMessage({ type: 'error', text: stockCheck.message });
      return;
    }

    setSaving(true);
    setMessage(null);
    const wasEditing = editingId;
    try {
      if (editingId) {
        const { error: deleteError } = await deleteSoilApplicationEvent(supabase, editingId);
        if (deleteError) throw deleteError;
      }

      const eventPayload = {
        event_date: form.event_date,
        application_method: form.application_method,
        notes: form.notes.trim() || null,
        zone_id: form.scope === 'zone' ? Number(form.zone_id) : null,
        tree_id: form.scope === 'tree' ? form.tree_id : null,
      };

      const { data: event, error: eventError } = await supabase
        .from('soil_application_events')
        .insert([eventPayload])
        .select()
        .single();

      if (eventError) throw eventError;

      const rows = items.map((li) => {
        const product = products.find((p) => String(p.id) === String(li.product_id));
        return {
          soil_application_event_id: event.id,
          product_id: Number(li.product_id),
          quantity: Number(li.quantity),
          unit: product?.unit || 'kg',
        };
      });

      const { error: productsError } = await supabase.from('soil_application_products').insert(rows);
      if (productsError) throw productsError;

      await reloadProducts();
      await reloadEvents();
      resetFormState();
      setMessage({
        type: 'success',
        text: wasEditing
          ? 'Soil application updated. Stock and costs recalculated.'
          : form.scope === 'tree'
            ? 'Soil application recorded for the selected tree. Stock deducted and cost allocated to that tree.'
            : 'Soil application recorded. Stock deducted and cost split across trees in the zone.',
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
        section="Inputs"
        title="Soil Application"
        subtitle="Apply fertilizer directly on soil to a whole zone or an individual tree."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Create a farm in Settings before recording soil applications.</Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        {editingId && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Editing soil application #{editingId}. Saving replaces the old record and recalculates stock/cost.
            <Button size="small" sx={{ ml: 2 }} onClick={resetFormState}>Cancel edit</Button>
          </Alert>
        )}

        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth disabled={!farm}>
              <InputLabel>Apply to</InputLabel>
              <Select
                value={form.scope}
                label="Apply to"
                onChange={(e) => setForm({
                  ...form,
                  scope: e.target.value,
                  zone_id: '',
                  tree_id: '',
                })}
              >
                <MenuItem value="zone">Irrigation zone</MenuItem>
                <MenuItem value="tree">Individual tree</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          {form.scope === 'zone' && (
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
          )}
          {form.scope === 'tree' && (
            <Grid item xs={12} md={3}>
              <FormControl fullWidth required disabled={!farm}>
                <InputLabel>Tree</InputLabel>
                <Select
                  value={form.tree_id}
                  label="Tree"
                  onChange={(e) => setForm({ ...form, tree_id: e.target.value })}
                >
                  {trees.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.tree_positions?.position_code || t.id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
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
            <FormControl fullWidth>
              <InputLabel>Application method</InputLabel>
              <Select
                value={form.application_method}
                label="Application method"
                onChange={(e) => setForm({ ...form, application_method: e.target.value })}
              >
                {APPLICATION_METHODS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Notes (optional)"
              fullWidth
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Grid>
        </Grid>

        <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>Fertilizers applied</Typography>
        {lineItems.map((li, idx) => {
          const product = products.find((p) => String(p.id) === String(li.product_id));
          const stock = getProductStock(product);
          return (
            <Grid container spacing={2} key={idx} sx={{ mb: 1 }} alignItems="center">
              <Grid item xs={12} md={5}>
                <FormControl fullWidth>
                  <InputLabel>Product</InputLabel>
                  <Select
                    value={li.product_id}
                    label="Product"
                    onChange={(e) => {
                      const next = [...lineItems];
                      next[idx].product_id = e.target.value;
                      setLineItems(next);
                    }}
                  >
                    {fertilizerProducts.map((p) => (
                      <MenuItem
                        key={p.id}
                        value={String(p.id)}
                        disabled={!editingId && getProductStock(p) <= 0}
                      >
                        {productStockLabel(p)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={5}>
                <TextField
                  label="Quantity"
                  type="number"
                  fullWidth
                  value={li.quantity}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[idx].quantity = e.target.value;
                    setLineItems(next);
                  }}
                  helperText={
                    product
                      ? `Stock: ${stock} ${product.unit}${form.scope === 'zone' ? ' · split across zone trees' : ' · applied to this tree only'}`
                      : undefined
                  }
                />
              </Grid>
              <Grid item xs={12} md={2}>
                <IconButton
                  onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))}
                  disabled={lineItems.length === 1}
                >
                  <DeleteIcon />
                </IconButton>
              </Grid>
            </Grid>
          );
        })}

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <Button onClick={() => setLineItems([...lineItems, emptySoilLineItem()])}>
            + Add product
          </Button>
          <Button variant="contained" onClick={handleApply} disabled={saving || !farm}>
            {editingId ? 'Update soil application' : 'Record soil application'}
          </Button>
        </Box>
      </Paper>

      <Paper variant="outlined">
        <Typography variant="h6" sx={{ p: 2, pb: 0 }}>Recent soil applications</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Applied to</TableCell>
              <TableCell>Method</TableCell>
              <TableCell>Products</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id} selected={editingId === event.id}>
                <TableCell>{formatDate(event.event_date)}</TableCell>
                <TableCell>{soilApplicationTargetLabel(event)}</TableCell>
                <TableCell>{event.application_method}</TableCell>
                <TableCell>{formatFertilizerProductLines(event.soil_application_products)}</TableCell>
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
              <TableRow><TableCell colSpan={5}>No soil application records yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default SoilApplicationPage;
