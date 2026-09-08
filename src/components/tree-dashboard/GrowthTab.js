import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Grid, TextField, Button, CircularProgress, Alert, Chip,
} from '@mui/material';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { formatNumberSmart } from '../../utils/formatters';
import {
  GROWTH_MEASUREMENT_FIELDS,
  buildGrowthPayload,
  compareGrowthToAverage,
  computeGrowthAverages,
  emptyGrowthForm,
  growthRlsHint,
  growthVsAverageColor,
  hasGrowthMeasurement,
  pickLatestGrowthByTree,
  trunkMmToCm,
} from '../../utils/treeGrowth';

function chipColor(status) {
  if (status === 'low') return 'warning';
  if (status === 'good' || status === 'ok') return 'success';
  return 'default';
}

function combineCanopyStatus(nsStatus, ewStatus) {
  if (nsStatus === 'low' || ewStatus === 'low') return { status: 'low', label: 'Below avg' };
  if (nsStatus === 'unknown' && ewStatus === 'unknown') return { status: 'unknown', label: '' };
  if (nsStatus === 'good' || ewStatus === 'good') return { status: 'good', label: 'Above avg' };
  return { status: 'ok', label: 'At avg' };
}

function GrowthMetricCard({ label, value, average, comparison }) {
  const status = comparison?.status || 'unknown';
  return (
    <Paper sx={{ p: 2, textAlign: 'center' }} variant="outlined">
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography
        variant="h5"
        sx={{
          fontWeight: 700,
          color: status !== 'unknown' ? growthVsAverageColor(status) : undefined,
        }}
      >
        {value}
      </Typography>
      {comparison?.label ? (
        <Chip size="small" color={chipColor(status)} label={comparison.label} sx={{ mt: 0.75 }} />
      ) : null}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Farm avg: {average}
      </Typography>
    </Paper>
  );
}

function GrowthTab({ tree }) {
  const [allRecords, setAllRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(emptyGrowthForm());

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tree_growth')
      .select('*')
      .order('measurement_date', { ascending: true });

    if (error) {
      setMessage({ type: 'error', text: growthRlsHint(error.message) });
      setAllRecords([]);
    } else {
      setAllRecords(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const records = useMemo(
    () => allRecords.filter((r) => r.tree_id === tree.id),
    [allRecords, tree.id]
  );
  const latest = records[records.length - 1] || null;
  const averages = useMemo(
    () => computeGrowthAverages(pickLatestGrowthByTree(allRecords)),
    [allRecords]
  );

  const heightCm = latest?.height_cm != null ? Number(latest.height_cm) : null;
  const trunkCm = trunkMmToCm(latest?.trunk_diameter_mm);
  const canopyNs = latest?.canopy_ns_cm != null ? Number(latest.canopy_ns_cm) : null;
  const canopyEw = latest?.canopy_ew_cm != null ? Number(latest.canopy_ew_cm) : null;

  const heightComparison = compareGrowthToAverage(heightCm, averages.height);
  const trunkComparison = compareGrowthToAverage(trunkCm, averages.trunk);
  const canopyComparison = combineCanopyStatus(
    compareGrowthToAverage(canopyNs, averages.canopyNs).status,
    compareGrowthToAverage(canopyEw, averages.canopyEw).status,
  );

  const chartData = records.map((r) => ({
    date: new Date(r.measurement_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    height: r.height_cm != null ? Number(r.height_cm) / 100 : null,
    trunk: trunkMmToCm(r.trunk_diameter_mm),
    canopyNs: r.canopy_ns_cm != null ? Number(r.canopy_ns_cm) / 100 : null,
    canopyEw: r.canopy_ew_cm != null ? Number(r.canopy_ew_cm) / 100 : null,
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
          <GrowthMetricCard
            label="Height"
            value={heightCm != null ? `${formatNumberSmart(heightCm / 100)} m` : '—'}
            average={averages.height != null ? `${formatNumberSmart(averages.height / 100)} m` : '—'}
            comparison={heightComparison}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <GrowthMetricCard
            label="Trunk diameter"
            value={trunkCm != null ? `${formatNumberSmart(trunkCm)} cm` : '—'}
            average={averages.trunk != null ? `${formatNumberSmart(averages.trunk)} cm` : '—'}
            comparison={trunkComparison}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <GrowthMetricCard
            label="Canopy (N-S × E-W)"
            value={
              canopyNs != null && canopyEw != null
                ? `${formatNumberSmart(canopyNs / 100)} × ${formatNumberSmart(canopyEw / 100)} m`
                : '—'
            }
            average={
              averages.canopyNs != null && averages.canopyEw != null
                ? `${formatNumberSmart(averages.canopyNs / 100)} × ${formatNumberSmart(averages.canopyEw / 100)} m`
                : '—'
            }
            comparison={canopyNs != null && canopyEw != null ? canopyComparison : { status: 'unknown', label: '' }}
          />
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
              <Line yAxisId="left" type="monotone" dataKey="height" stroke="#2e7d32" name="Height (m)" connectNulls />
              <Line yAxisId="left" type="monotone" dataKey="canopyNs" stroke="#6a1b9a" name="Canopy N-S (m)" connectNulls />
              <Line yAxisId="left" type="monotone" dataKey="canopyEw" stroke="#ab47bc" name="Canopy E-W (m)" connectNulls />
              <Line yAxisId="right" type="monotone" dataKey="trunk" stroke="#1565c0" name="Trunk (cm)" connectNulls />
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
