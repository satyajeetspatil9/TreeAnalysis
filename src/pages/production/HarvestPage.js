import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Button, TextField, Grid, FormControl, InputLabel, Select, MenuItem, Alert,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatCurrency, formatDate, formatNumber } from '../../utils/formatters';

function harvestRlsHint(message) {
  if (!message) return message;
  if (message?.includes('row-level security')) {
    return `${message} Run supabase/migrations/021_fix_harvest_rls.sql in Supabase SQL Editor.`;
  }
  return message;
}

function HarvestPage() {
  const { farm } = useFarm();
  const [records, setRecords] = useState([]);
  const [trees, setTrees] = useState([]);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    tree_id: '',
    harvest_date: new Date().toISOString().slice(0, 10),
    quantity_kg: '',
    grade: 'A',
    price_per_kg: '',
  });

  const treeIds = useMemo(() => trees.map((t) => t.id), [trees]);

  const loadTrees = useCallback(async () => {
    if (!farm) {
      setTrees([]);
      return;
    }
    const { data: t, error } = await supabase
      .from('trees')
      .select('id, tree_positions(position_code)')
      .eq('status', 'Active')
      .order('id');
    if (error) {
      setMessage({ type: 'error', text: harvestRlsHint(error.message) });
      setTrees([]);
      return;
    }
    setTrees(t || []);
  }, [farm]);

  const loadRecords = useCallback(async () => {
    if (!treeIds.length) {
      setRecords([]);
      return;
    }
    const { data, error } = await supabase
      .from('harvest_events')
      .select('*, trees(tree_positions(position_code))')
      .in('tree_id', treeIds)
      .order('harvest_date', { ascending: false });
    if (error) {
      setMessage({ type: 'error', text: harvestRlsHint(error.message) });
      setRecords([]);
      return;
    }
    setRecords(data || []);
  }, [treeIds]);

  useEffect(() => {
    loadTrees();
  }, [loadTrees]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleSave = async () => {
    setMessage(null);
    if (!form.tree_id || !form.quantity_kg) {
      setMessage({ type: 'error', text: 'Select a tree and enter quantity.' });
      return;
    }

    const qty = Number(form.quantity_kg);
    if (Number.isNaN(qty) || qty <= 0) {
      setMessage({ type: 'error', text: 'Enter a valid quantity in kg.' });
      return;
    }

    const price = Number(form.price_per_kg) || 0;
    setSaving(true);
    try {
      const { error } = await supabase.from('harvest_events').insert([{
        tree_id: form.tree_id,
        harvest_date: form.harvest_date,
        quantity_kg: qty,
        grade: form.grade,
        price_per_kg: price || null,
        revenue: price ? qty * price : null,
      }]);
      if (error) throw error;

      setForm({
        tree_id: '',
        harvest_date: new Date().toISOString().slice(0, 10),
        quantity_kg: '',
        grade: 'A',
        price_per_kg: '',
      });
      await loadRecords();
      setMessage({ type: 'success', text: 'Harvest recorded.' });
    } catch (err) {
      setMessage({ type: 'error', text: harvestRlsHint(err.message) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Harvest"
        subtitle="Record yield and revenue per tree."
      />
      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Select or create a farm in Settings before recording harvest.</Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth required>
              <InputLabel>Tree</InputLabel>
              <Select
                value={form.tree_id}
                label="Tree"
                onChange={(e) => setForm({ ...form, tree_id: e.target.value })}
              >
                {trees.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.tree_positions?.position_code}</MenuItem>
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
              value={form.harvest_date}
              onChange={(e) => setForm({ ...form, harvest_date: e.target.value })}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              label="Qty (kg)"
              fullWidth
              required
              type="number"
              inputProps={{ min: 0, step: 'any' }}
              value={form.quantity_kg}
              onChange={(e) => setForm({ ...form, quantity_kg: e.target.value })}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField label="Grade" fullWidth value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField label="₹/kg" fullWidth value={form.price_per_kg} onChange={(e) => setForm({ ...form, price_per_kg: e.target.value })} />
          </Grid>
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={handleSave} disabled={saving || !farm}>
          {saving ? 'Saving…' : 'Save Harvest'}
        </Button>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Tree</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Qty</TableCell>
              <TableCell>Grade</TableCell>
              <TableCell>Revenue</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.trees?.tree_positions?.position_code}</TableCell>
                <TableCell>{formatDate(r.harvest_date)}</TableCell>
                <TableCell>{formatNumber(r.quantity_kg, 1)} kg</TableCell>
                <TableCell>{r.grade}</TableCell>
                <TableCell>{formatCurrency(r.revenue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default HarvestPage;
