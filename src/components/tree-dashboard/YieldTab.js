import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, CircularProgress, Grid, Alert, Table, TableBody, TableCell,
  TableHead, TableRow, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  DialogContentText, TextField, Button,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { formatCurrency, formatDate, formatNumber } from '../../utils/formatters';
import {
  aggregateRecordsByCropYear,
  cropYearNoticeText,
  filterRecordsForCropYear,
  getCropYearRange,
  getCurrentCropYearRange,
} from '../../utils/cropYear';

function harvestRlsHint(message) {
  if (!message) return message;
  if (message.includes('row-level security')) {
    return `${message} Run supabase/migrations/021_fix_harvest_rls.sql in Supabase SQL Editor.`;
  }
  return message;
}

function emptyHarvestForm() {
  return {
    harvest_date: new Date().toISOString().slice(0, 10),
    quantity_kg: '',
    grade: 'A',
    price_per_kg: '',
  };
}

function harvestToForm(record) {
  if (!record) return emptyHarvestForm();
  return {
    harvest_date: record.harvest_date
      ? String(record.harvest_date).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    quantity_kg: record.quantity_kg != null ? String(record.quantity_kg) : '',
    grade: record.grade || 'A',
    price_per_kg: record.price_per_kg != null ? String(record.price_per_kg) : '',
  };
}

function buildHarvestPayload(form, treeId) {
  const qty = Number(form.quantity_kg);
  const price = form.price_per_kg !== '' && form.price_per_kg != null
    ? Number(form.price_per_kg)
    : null;

  return {
    tree_id: treeId,
    harvest_date: form.harvest_date,
    quantity_kg: qty,
    grade: form.grade?.trim() || null,
    price_per_kg: price,
    revenue: price != null && !Number.isNaN(price) ? qty * price : null,
  };
}

function validateHarvestForm(form) {
  const qty = Number(form.quantity_kg);
  if (!form.harvest_date) return 'Harvest date is required.';
  if (!form.quantity_kg || Number.isNaN(qty) || qty <= 0) return 'Enter a valid quantity in kg.';
  if (form.price_per_kg !== '' && Number.isNaN(Number(form.price_per_kg))) {
    return 'Enter a valid price per kg.';
  }
  return null;
}

function YieldTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block">Crop year {point?.label}</Typography>
      <Typography variant="body2">
        Yield: {formatNumber(payload[0]?.value, 1)} kg
      </Typography>
      {point?.harvestCount > 1 && (
        <Typography variant="caption" color="text.secondary">
          {point.harvestCount} harvests combined
        </Typography>
      )}
    </Paper>
  );
}

function RevenueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block">Crop year {point?.label}</Typography>
      <Typography variant="body2">
        Revenue: {formatCurrency(payload[0]?.value)}
      </Typography>
      {point?.harvestCount > 1 && (
        <Typography variant="caption" color="text.secondary">
          {point.harvestCount} harvests combined
        </Typography>
      )}
    </Paper>
  );
}

function buildChartData(records) {
  return aggregateRecordsByCropYear(records).map((year) => ({
    startYear: year.startYear,
    label: year.label,
    yieldKg: year.yieldKg,
    revenue: year.revenue,
    harvestCount: year.harvestCount,
  }));
}

function sumTotals(records) {
  return (records || []).reduce(
    (acc, record) => ({
      kg: acc.kg + Number(record.quantity_kg || 0),
      revenue: acc.revenue + Number(record.revenue || 0),
    }),
    { kg: 0, revenue: 0 },
  );
}

function HarvestEditFields({ form, onChange }) {
  return (
    <Grid container spacing={2} sx={{ mt: 0.5 }}>
      <Grid item xs={12} md={6}>
        <TextField
          label="Harvest date"
          type="date"
          fullWidth
          required
          InputLabelProps={{ shrink: true }}
          value={form.harvest_date}
          onChange={(e) => onChange({ ...form, harvest_date: e.target.value })}
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          label="Grade"
          fullWidth
          value={form.grade}
          onChange={(e) => onChange({ ...form, grade: e.target.value })}
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          label="Quantity (kg)"
          fullWidth
          required
          type="number"
          inputProps={{ min: 0, step: 'any' }}
          value={form.quantity_kg}
          onChange={(e) => onChange({ ...form, quantity_kg: e.target.value })}
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          label="Price (₹/kg)"
          fullWidth
          type="number"
          inputProps={{ min: 0, step: 'any' }}
          value={form.price_per_kg}
          onChange={(e) => onChange({ ...form, price_per_kg: e.target.value })}
        />
      </Grid>
    </Grid>
  );
}

function YieldTab({ tree }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState(emptyHarvestForm());
  const [deletingRecord, setDeletingRecord] = useState(null);
  const cropYear = useMemo(() => getCurrentCropYearRange(), []);

  const loadYield = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('harvest_events')
      .select('*')
      .eq('tree_id', tree.id)
      .order('harvest_date', { ascending: false });

    if (error) {
      setMessage({ type: 'error', text: harvestRlsHint(error.message) });
      setRecords([]);
    } else {
      setRecords(data || []);
    }
    setLoading(false);
  }, [tree.id]);

  useEffect(() => {
    loadYield();
  }, [loadYield]);

  const cropYearRecords = useMemo(
    () => filterRecordsForCropYear(records, 'harvest_date', cropYear),
    [records, cropYear],
  );

  const yearlySummaries = useMemo(
    () => aggregateRecordsByCropYear(records).slice().reverse(),
    [records],
  );

  const totals = useMemo(() => sumTotals(cropYearRecords), [cropYearRecords]);
  const chartData = useMemo(() => buildChartData(records), [records]);

  const openEditRecord = (record) => {
    setEditingRecord(record);
    setEditForm(harvestToForm(record));
  };

  const closeEditRecord = () => {
    setEditingRecord(null);
    setEditForm(emptyHarvestForm());
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;

    const validationError = validateHarvestForm(editForm);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    setSaving(true);
    setMessage(null);
    const { error } = await supabase
      .from('harvest_events')
      .update(buildHarvestPayload(editForm, tree.id))
      .eq('id', editingRecord.id);
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: harvestRlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Harvest record updated.' });
    closeEditRecord();
    await loadYield();
  };

  const handleDeleteRecord = async () => {
    if (!deletingRecord) return;

    setDeleting(true);
    setMessage(null);
    const { error } = await supabase
      .from('harvest_events')
      .delete()
      .eq('id', deletingRecord.id);
    setDeleting(false);

    if (error) {
      setMessage({ type: 'error', text: harvestRlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Harvest record deleted.' });
    if (editingRecord?.id === deletingRecord.id) closeEditRecord();
    setDeletingRecord(null);
    await loadYield();
  };

  if (loading) return <CircularProgress size={24} />;

  const cropYearNotice = (
    <Alert severity="info" sx={{ mb: 2 }}>
      {cropYearNoticeText(cropYear)}
    </Alert>
  );

  if (records.length === 0) {
    return (
      <Box>
        {message && (
          <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}
        {cropYearNotice}
        <Paper sx={{ p: 3 }} variant="outlined">
          <Typography color="text.secondary">Not yet producing. Harvest records will appear here.</Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box>
      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      {cropYearNotice}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption">Crop year yield ({cropYear.label})</Typography>
            <Typography variant="h5">{formatNumber(totals.kg, 1)} kg</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption">Crop year revenue ({cropYear.label})</Typography>
            <Typography variant="h5">{formatCurrency(totals.revenue)}</Typography>
          </Paper>
        </Grid>
      </Grid>

      {chartData.length > 0 ? (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Yield by Crop Year</Typography>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={(value) => `${value} kg`} width={56} />
                  <Tooltip content={<YieldTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="yieldKg"
                    stroke="#2e7d32"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    name="Yield (kg)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Revenue by Crop Year</Typography>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={(value) => `₹${value}`} width={56} />
                  <Tooltip content={<RevenueTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#1565c0"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    name="Revenue"
                  />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        </Grid>
      ) : (
        <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
          <Typography color="text.secondary">
            No harvest recorded in crop year {cropYear.label} yet.
          </Typography>
        </Paper>
      )}

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Harvest records</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Crop year</TableCell>
              <TableCell>Qty (kg)</TableCell>
              <TableCell>Grade</TableCell>
              <TableCell>₹/kg</TableCell>
              <TableCell>Revenue</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>{formatDate(record.harvest_date)}</TableCell>
                <TableCell>{getCropYearRange(record.harvest_date).label}</TableCell>
                <TableCell>{formatNumber(record.quantity_kg, 1)}</TableCell>
                <TableCell>{record.grade || '—'}</TableCell>
                <TableCell>
                  {record.price_per_kg != null ? formatCurrency(record.price_per_kg) : '—'}
                </TableCell>
                <TableCell>{formatCurrency(record.revenue)}</TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    aria-label="Edit harvest"
                    onClick={() => openEditRecord(record)}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="Delete harvest"
                    onClick={() => setDeletingRecord(record)}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="h6" gutterBottom>Harvest by crop year</Typography>
      {yearlySummaries.map((year) => (
        <Paper key={year.startYear} sx={{ p: 2, mb: 1 }} variant="outlined">
          <Typography variant="subtitle2">Crop year {year.label}</Typography>
          <Typography>
            {formatNumber(year.yieldKg, 1)} kg | {formatCurrency(year.revenue)}
            {year.harvestCount > 1 ? ` | ${year.harvestCount} harvests` : ''}
          </Typography>
        </Paper>
      ))}

      <Dialog open={Boolean(editingRecord)} onClose={closeEditRecord} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Harvest Record</DialogTitle>
        <DialogContent>
          <HarvestEditFields form={editForm} onChange={setEditForm} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditRecord}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deletingRecord)} onClose={() => setDeletingRecord(null)}>
        <DialogTitle>Delete Harvest Record?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete the harvest from {formatDate(deletingRecord?.harvest_date)} (
            {formatNumber(deletingRecord?.quantity_kg, 1)} kg)? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingRecord(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteRecord} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default YieldTab;
