import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Grid, Chip, CircularProgress, TextField, Button, Alert,
  Table, TableBody, TableCell, TableHead, TableRow, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, DialogContentText,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { formatDate, formatNumber } from '../../utils/formatters';
import { useFarm } from '../../hooks/useFarm';
import {
  SENSOR_READING_FIELDS,
  LAB_NUTRIENT_FIELDS,
  emptySensorForm,
  buildSensorUpdatePayload,
  observationToForm,
  getSoilStandard,
  rlsHint,
} from '../../utils/soil';
import { refreshSoilNutrientAlerts } from '../../utils/soilAlerts';
import SoilNutrientDisplay, { SoilStandardsReference } from '../soil/SoilNutrientDisplay';

function SoilTab({ tree }) {
  const { farm } = useFarm();
  const [current, setCurrent] = useState(null);
  const [readings, setReadings] = useState([]);
  const [labReport, setLabReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState(null);
  const [editingReading, setEditingReading] = useState(null);
  const [editForm, setEditForm] = useState(emptySensorForm());
  const [deletingReading, setDeletingReading] = useState(null);

  const loadSoil = useCallback(async () => {
    setLoading(true);

    const { data } = await supabase
      .from('soil_observations')
      .select('*')
      .eq('tree_id', tree.id)
      .order('observed_at', { ascending: false })
      .limit(50);

    setReadings(data || []);
    setCurrent(data?.[0] || null);
    setHistory(
      (data || []).slice().reverse().map((d) => ({
        date: new Date(d.observed_at).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        moisture: d.moisture_percent,
      })),
    );

    if (farm?.id) {
      const { data: labData } = await supabase
        .from('farm_soil_lab_reports')
        .select('*')
        .eq('farm_id', farm.id)
        .order('sample_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      setLabReport(labData || null);
    } else {
      setLabReport(null);
    }

    setLoading(false);
  }, [tree.id, farm?.id]);

  useEffect(() => {
    loadSoil();
  }, [loadSoil]);

  const validateSensorForm = (sensorForm) => {
    const hasReading = SENSOR_READING_FIELDS.some(({ key }) => sensorForm[key] !== '' && sensorForm[key] != null);
    if (!hasReading) return 'Enter at least one sensor reading.';
    return null;
  };

  const openEditReading = (reading) => {
    setEditingReading(reading);
    setEditForm(observationToForm(reading));
  };

  const closeEditReading = () => {
    setEditingReading(null);
    setEditForm(emptySensorForm());
  };

  const handleSaveEdit = async () => {
    if (!editingReading) return;

    const validationError = validateSensorForm(editForm);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    setSaving(true);
    const payload = buildSensorUpdatePayload(editForm, tree.id);
    const { error } = await supabase
      .from('soil_observations')
      .update(payload)
      .eq('id', editingReading.id);
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Sensor reading updated.' });
    closeEditReading();
    await loadSoil();
    await refreshSoilNutrientAlerts(supabase);
  };

  const handleDeleteReading = async () => {
    if (!deletingReading) return;

    setDeleting(true);
    const { error } = await supabase
      .from('soil_observations')
      .delete()
      .eq('id', deletingReading.id);
    setDeleting(false);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Sensor reading deleted.' });
    if (editingReading?.id === deletingReading.id) closeEditReading();
    setDeletingReading(null);
    await loadSoil();
    await refreshSoilNutrientAlerts(supabase);
  };

  if (loading) return <CircularProgress size={24} />;

  return (
    <Box>
      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6">8-in-1 Sensor — This Tree</Typography>
          {current && (
            <Chip
              label={`Last reading: ${formatDate(current.observed_at)} · ${current.method || current.source || 'Manual'}`}
              size="small"
            />
          )}
        </Box>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption">Moisture</Typography>
            <SoilNutrientDisplay
              standardKey="moisture_percent"
              value={current?.moisture_percent}
              decimals={0}
              unit="%"
              showRange={false}
              showLabel={false}
              statusFirst
              variant="h6"
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption">pH</Typography>
            <SoilNutrientDisplay
              standardKey="ph"
              value={current?.ph}
              decimals={1}
              showRange={false}
              showLabel={false}
              variant="h6"
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption">EC</Typography>
            <SoilNutrientDisplay
              standardKey="ec"
              value={current?.ec}
              decimals={2}
              showRange={false}
              showLabel={false}
              variant="h6"
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption">Temperature</Typography>
            <Typography variant="h6">
              {current?.temperature_c != null ? `${formatNumber(current.temperature_c, 1)} °C` : '—'}
            </Typography>
          </Grid>
        </Grid>
        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>NPK (from sensor)</Typography>
        <Grid container spacing={2}>
          {SENSOR_READING_FIELDS.filter((f) => ['nitrogen', 'phosphorus', 'potassium'].includes(f.key)).map(({ key, label, decimals, standardKey, unit }) => (
            <Grid item xs={12} sm={4} key={key}>
              <SoilNutrientDisplay
                standardKey={standardKey}
                label={label}
                value={current?.[key]}
                decimals={decimals ?? 2}
                unit={unit}
              />
            </Grid>
          ))}
        </Grid>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6">Lab Micronutrients — Farm-wide</Typography>
          {labReport && (
            <Chip
              label={`Sample: ${formatDate(labReport.sample_date)}${labReport.lab_name ? ` · ${labReport.lab_name}` : ''}`}
              size="small"
              color="secondary"
            />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Laboratory results apply to the whole farm. Add or edit reports under Farm Setting → Add Soil Report.
        </Typography>
        <Grid container spacing={2}>
          {LAB_NUTRIENT_FIELDS.map(({ key, label, standardKey, unit }) => (
            <Grid item xs={12} sm={6} md={4} key={key}>
              <SoilNutrientDisplay
                standardKey={standardKey}
                label={label}
                unit={unit}
                value={labReport?.[key]}
              />
            </Grid>
          ))}
        </Grid>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
          Required Nutrient Ranges
        </Typography>
        <SoilStandardsReference compact />
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Reading History</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Moisture</TableCell>
              <TableCell>pH</TableCell>
              <TableCell>EC</TableCell>
              <TableCell>Temp</TableCell>
              <TableCell>N</TableCell>
              <TableCell>P</TableCell>
              <TableCell>K</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {readings.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.observed_at)}</TableCell>
                <TableCell>{r.moisture_percent != null ? `${formatNumber(r.moisture_percent, 0)}%` : '—'}</TableCell>
                <TableCell>{r.ph ?? '—'}</TableCell>
                <TableCell>{r.ec ?? '—'}</TableCell>
                <TableCell>{r.temperature_c ?? '—'}</TableCell>
                <TableCell>{r.nitrogen ?? '—'}</TableCell>
                <TableCell>{r.phosphorus ?? '—'}</TableCell>
                <TableCell>{r.potassium ?? '—'}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" aria-label="Edit reading" onClick={() => openEditReading(r)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label="Delete reading" onClick={() => setDeletingReading(r)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {readings.length === 0 && (
              <TableRow><TableCell colSpan={9} align="center">No sensor readings yet. Add under Farm Setting → Add Soil Report.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Moisture History</Typography>
        {history.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="moisture" stroke="#2e7d32" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Typography color="text.secondary">No sensor readings yet. Add readings under Farm Setting → Add Soil Report.</Typography>
        )}
      </Paper>

      <Dialog open={Boolean(editingReading)} onClose={closeEditReading} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Sensor Reading</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                label="Reading date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={editForm.observed_at}
                onChange={(e) => setEditForm({ ...editForm, observed_at: e.target.value })}
              />
            </Grid>
            {SENSOR_READING_FIELDS.map(({ key, label, unit, standardKey }) => (
              <Grid item xs={6} key={key}>
                <TextField
                  label={unit ? `${label} (${unit})` : label}
                  fullWidth
                  value={editForm[key]}
                  onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                  helperText={standardKey ? `Target: ${getSoilStandard(standardKey)?.rangeLabel || ''}` : undefined}
                />
              </Grid>
            ))}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditReading}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={saving}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deletingReading)} onClose={() => setDeletingReading(null)}>
        <DialogTitle>Delete Sensor Reading?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete the reading from {formatDate(deletingReading?.observed_at)}? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingReading(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteReading} disabled={deleting}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default SoilTab;
