import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Grid, TextField, Button, CircularProgress, Alert,
} from '@mui/material';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { formatNumber } from '../../utils/formatters';
import {
  GROWTH_MEASUREMENT_FIELDS,
  buildGrowthPayload,
  emptyGrowthForm,
  growthRlsHint,
  hasGrowthMeasurement,
  trunkMmToCm,
} from '../../utils/treeGrowth';

function GrowthTab({ tree }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [latest, setLatest] = useState(null);
  const [form, setForm] = useState(emptyGrowthForm());

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
    trunk: trunkMmToCm(r.trunk_diameter_mm),
  }));

  const handleAdd = async () => {
    if (!hasGrowthMeasurement(form)) {
      setMessage({ type: 'error', text: 'Enter at least one measurement value.' });
      return;
    }

    setSaving(true);
    setMessage(null);

    const { error } = await supabase.from('tree_growth').insert([{
      tree_id: tree.id,
      ...buildGrowthPayload(form),
    }]);

    if (error) {
      setMessage({ type: 'error', text: growthRlsHint(error.message) });
      setSaving(false);
      return;
    }

    setForm(emptyGrowthForm());
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
              {latest?.trunk_diameter_mm != null ? `${formatNumber(trunkMmToCm(latest.trunk_diameter_mm), 1)} cm` : '—'}
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
              <Line yAxisId="right" type="monotone" dataKey="trunk" stroke="#1565c0" name="Trunk (cm)" />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      )}

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Record Measurement</Typography>
        <Grid container spacing={2}>
          {GROWTH_MEASUREMENT_FIELDS.map(({ key, label, unit }) => (
            <Grid item xs={6} md={3} key={key}>
              <TextField
                label={unit ? `${label} (${unit})` : label}
                fullWidth
                type="number"
                inputProps={{ min: 0, step: 'any' }}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </Grid>
          ))}
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
