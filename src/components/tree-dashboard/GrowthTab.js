import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Grid, TextField, Button, CircularProgress, Alert,
} from '@mui/material';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { formatNumber } from '../../utils/formatters';

function growthRlsHint(message) {
  if (!message) return message;
  if (message?.includes('row-level security')) {
    return `${message} Run supabase/migrations/023_fix_tree_growth_rls.sql in Supabase SQL Editor.`;
  }
  return message;
}

function emptyForm() {
  return {
    height_cm: '',
    trunk_diameter_mm: '',
    canopy_ns_cm: '',
    canopy_ew_cm: '',
    measurement_date: new Date().toISOString().slice(0, 10),
  };
}

function GrowthTab({ tree }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [latest, setLatest] = useState(null);
  const [form, setForm] = useState(emptyForm());

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tree_growth')
      .select('*')
      .eq('tree_id', tree.id)
      .order('measurement_date', { ascending: true });

    if (error) {
      setMessage({ type: 'error', text: growthRlsHint(error.message) });
      setRecords([]);
      setLatest(null);
    } else {
      setRecords(data || []);
      setLatest(data?.[data.length - 1] || null);
    }
    setLoading(false);
  }, [tree.id]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const chartData = records.map((r) => ({
    date: new Date(r.measurement_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    height: r.height_cm != null ? Number(r.height_cm) / 100 : null,
    trunk: r.trunk_diameter_mm,
  }));

  const handleAdd = async () => {
    const hasMeasurement = [
      form.height_cm,
      form.trunk_diameter_mm,
      form.canopy_ns_cm,
      form.canopy_ew_cm,
    ].some((value) => value !== '' && value != null);

    if (!hasMeasurement) {
      setMessage({ type: 'error', text: 'Enter at least one measurement value.' });
      return;
    }

    setSaving(true);
    setMessage(null);

    const { error } = await supabase.from('tree_growth').insert([{
      tree_id: tree.id,
      height_cm: form.height_cm ? Number(form.height_cm) : null,
      trunk_diameter_mm: form.trunk_diameter_mm ? Number(form.trunk_diameter_mm) : null,
      canopy_ns_cm: form.canopy_ns_cm ? Number(form.canopy_ns_cm) : null,
      canopy_ew_cm: form.canopy_ew_cm ? Number(form.canopy_ew_cm) : null,
      measurement_date: form.measurement_date,
    }]);

    if (error) {
      setMessage({ type: 'error', text: growthRlsHint(error.message) });
      setSaving(false);
      return;
    }

    setForm(emptyForm());
    await fetchRecords();
    setMessage({ type: 'success', text: 'Measurement saved.' });
    setSaving(false);
  };

  if (loading) return <CircularProgress size={24} />;

  return (
    <Box>
      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption">Height</Typography>
            <Typography variant="h5">
              {latest?.height_cm != null ? `${formatNumber(Number(latest.height_cm) / 100, 2)} m` : '—'}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption">Trunk diameter</Typography>
            <Typography variant="h5">
              {latest?.trunk_diameter_mm != null ? `${formatNumber(latest.trunk_diameter_mm, 0)} mm` : '—'}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption">Canopy (N-S × E-W)</Typography>
            <Typography variant="h5">
              {latest?.canopy_ns_cm && latest?.canopy_ew_cm
                ? `${formatNumber(Number(latest.canopy_ns_cm) / 100, 1)} × ${formatNumber(Number(latest.canopy_ew_cm) / 100, 1)} m`
                : '—'}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {chartData.length > 0 && (
        <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
          <Typography variant="h6" gutterBottom>Growth Over Time</Typography>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="height" stroke="#2e7d32" name="Height (m)" />
              <Line yAxisId="right" type="monotone" dataKey="trunk" stroke="#1565c0" name="Trunk (mm)" />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      )}

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Record Measurement</Typography>
        <Grid container spacing={2}>
          <Grid item xs={6} md={3}>
            <TextField label="Height (cm)" fullWidth type="number" inputProps={{ min: 0, step: 'any' }} value={form.height_cm} onChange={(e) => setForm({ ...form, height_cm: e.target.value })} />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField label="Trunk (mm)" fullWidth type="number" inputProps={{ min: 0, step: 'any' }} value={form.trunk_diameter_mm} onChange={(e) => setForm({ ...form, trunk_diameter_mm: e.target.value })} />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField label="Canopy N-S (cm)" fullWidth type="number" inputProps={{ min: 0, step: 'any' }} value={form.canopy_ns_cm} onChange={(e) => setForm({ ...form, canopy_ns_cm: e.target.value })} />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField label="Canopy E-W (cm)" fullWidth type="number" inputProps={{ min: 0, step: 'any' }} value={form.canopy_ew_cm} onChange={(e) => setForm({ ...form, canopy_ew_cm: e.target.value })} />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField label="Date" type="date" fullWidth required InputLabelProps={{ shrink: true }} value={form.measurement_date} onChange={(e) => setForm({ ...form, measurement_date: e.target.value })} />
          </Grid>
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={handleAdd} disabled={saving}>
          {saving ? 'Saving…' : 'Save Measurement'}
        </Button>
      </Paper>
    </Box>
  );
}

export default GrowthTab;
