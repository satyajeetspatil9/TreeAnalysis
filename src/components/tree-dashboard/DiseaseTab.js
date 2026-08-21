import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Paper, TextField, Button, FormControl, InputLabel, Select, MenuItem,
  Alert, CircularProgress, Chip, Table, TableBody, TableCell, TableHead, TableRow,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { supabase } from '../../supabaseClient';
import { formatDate } from '../../utils/formatters';
import { rlsHint } from '../../utils/soil';

const PROBLEM_CATEGORIES = [
  { value: 'DISEASE', label: 'Disease' },
  { value: 'PEST', label: 'Pest' },
  { value: 'NUTRIENT_DEFICIENCY', label: 'Nutrient deficiency' },
  { value: 'WATER_STRESS', label: 'Water stress' },
  { value: 'PHYSICAL_DAMAGE', label: 'Physical damage' },
  { value: 'OTHER', label: 'Other' },
];

const SEVERITY_LEVELS = ['Low', 'Medium', 'High'];

function emptyForm() {
  return {
    problem_type: '',
    problem_category: 'DISEASE',
    severity: 'Medium',
    symptoms: '',
    treatment: '',
    result: '',
    observed_at: new Date().toISOString().slice(0, 10),
  };
}

function observationToForm(observation) {
  if (!observation) return emptyForm();
  return {
    problem_type: observation.problem_type || '',
    problem_category: observation.problem_category || 'DISEASE',
    severity: observation.severity || 'Medium',
    symptoms: observation.symptoms || '',
    treatment: observation.treatment || '',
    result: observation.result || '',
    observed_at: observation.observed_at
      ? String(observation.observed_at).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  };
}

function buildObservationPayload(form, treeId) {
  return {
    tree_id: treeId,
    problem_type: form.problem_type.trim(),
    problem_category: form.problem_category,
    severity: form.severity,
    symptoms: form.symptoms.trim() || null,
    treatment: form.treatment.trim() || null,
    result: form.result.trim() || null,
    observed_at: form.observed_at,
  };
}

function validateForm(form) {
  if (!form.problem_type.trim()) return 'Problem type is required.';
  return null;
}

function DiseaseObservationFields({ form, onChange }) {
  return (
    <>
      <TextField
        label="Problem"
        fullWidth
        margin="normal"
        required
        value={form.problem_type}
        onChange={(e) => onChange({ ...form, problem_type: e.target.value })}
      />
      <TextField
        label="Observation date"
        type="date"
        fullWidth
        margin="normal"
        InputLabelProps={{ shrink: true }}
        value={form.observed_at}
        onChange={(e) => onChange({ ...form, observed_at: e.target.value })}
      />
      <FormControl fullWidth margin="normal">
        <InputLabel>Category</InputLabel>
        <Select
          value={form.problem_category}
          label="Category"
          onChange={(e) => onChange({ ...form, problem_category: e.target.value })}
        >
          {PROBLEM_CATEGORIES.map(({ value, label }) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl fullWidth margin="normal">
        <InputLabel>Severity</InputLabel>
        <Select
          value={form.severity}
          label="Severity"
          onChange={(e) => onChange({ ...form, severity: e.target.value })}
        >
          {SEVERITY_LEVELS.map((level) => (
            <MenuItem key={level} value={level}>{level}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        label="Symptoms"
        fullWidth
        margin="normal"
        multiline
        rows={2}
        value={form.symptoms}
        onChange={(e) => onChange({ ...form, symptoms: e.target.value })}
      />
      <TextField
        label="Treatment"
        fullWidth
        margin="normal"
        multiline
        rows={2}
        value={form.treatment}
        onChange={(e) => onChange({ ...form, treatment: e.target.value })}
      />
      <TextField
        label="Result"
        fullWidth
        margin="normal"
        multiline
        rows={2}
        value={form.result}
        onChange={(e) => onChange({ ...form, result: e.target.value })}
      />
    </>
  );
}

function DiseaseTab({ tree, onUpdate }) {
  const [observations, setObservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [editingObservation, setEditingObservation] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm());
  const [deletingObservation, setDeletingObservation] = useState(null);

  const fetchObservations = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('disease_observations')
      .select('*')
      .eq('tree_id', tree.id)
      .order('observed_at', { ascending: false });
    setObservations(data || []);
    setLoading(false);
  }, [tree.id]);

  useEffect(() => {
    fetchObservations();
  }, [fetchObservations]);

  const handleSave = async () => {
    const validationError = validateForm(form);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const { error: insertError } = await supabase.from('disease_observations').insert([
        buildObservationPayload(form, tree.id),
      ]);
      if (insertError) throw insertError;
      setForm(emptyForm());
      setMessage({ type: 'success', text: 'Observation saved.' });
      await fetchObservations();
      onUpdate?.();
    } catch (err) {
      setMessage({
        type: 'error',
        text: rlsHint(err.message, '027_fix_disease_observations_rls.sql'),
      });
    } finally {
      setSaving(false);
    }
  };

  const openEditObservation = (observation) => {
    setEditingObservation(observation);
    setEditForm(observationToForm(observation));
  };

  const closeEditObservation = () => {
    setEditingObservation(null);
    setEditForm(emptyForm());
  };

  const handleSaveEdit = async () => {
    if (!editingObservation) return;

    const validationError = validateForm(editForm);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('disease_observations')
      .update(buildObservationPayload(editForm, tree.id))
      .eq('id', editingObservation.id);
    setSaving(false);

    if (error) {
      setMessage({
        type: 'error',
        text: rlsHint(error.message, '027_fix_disease_observations_rls.sql'),
      });
      return;
    }

    setMessage({ type: 'success', text: 'Observation updated.' });
    closeEditObservation();
    await fetchObservations();
    onUpdate?.();
  };

  const handleDeleteObservation = async () => {
    if (!deletingObservation) return;

    setDeleting(true);
    const { error } = await supabase
      .from('disease_observations')
      .delete()
      .eq('id', deletingObservation.id);
    setDeleting(false);

    if (error) {
      setMessage({
        type: 'error',
        text: rlsHint(error.message, '027_fix_disease_observations_rls.sql'),
      });
      return;
    }

    setMessage({ type: 'success', text: 'Observation deleted.' });
    if (editingObservation?.id === deletingObservation.id) closeEditObservation();
    setDeletingObservation(null);
    await fetchObservations();
    onUpdate?.();
  };

  if (loading) return <CircularProgress size={24} />;

  return (
    <Box>
      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Save Observation</Typography>
        <DiseaseObservationFields form={form} onChange={setForm} />
        <Button variant="contained" onClick={handleSave} disabled={saving} sx={{ mt: 1 }}>
          {saving ? 'Saving...' : 'Save Observation'}
        </Button>
      </Paper>

      <Paper sx={{ p: 2 }} variant="outlined">
        <Typography variant="h6" gutterBottom>History</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Problem</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell>Symptoms / treatment</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {observations.map((obs) => (
              <TableRow key={obs.id}>
                <TableCell>{formatDate(obs.observed_at)}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{obs.problem_type}</TableCell>
                <TableCell>{obs.problem_category || '—'}</TableCell>
                <TableCell>
                  {obs.severity ? <Chip label={obs.severity} size="small" /> : '—'}
                </TableCell>
                <TableCell>{obs.symptoms || obs.treatment || obs.result || '—'}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" aria-label="Edit observation" onClick={() => openEditObservation(obs)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label="Delete observation" onClick={() => setDeletingObservation(obs)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {observations.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">No disease observations recorded.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={Boolean(editingObservation)} onClose={closeEditObservation} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Observation</DialogTitle>
        <DialogContent>
          <DiseaseObservationFields form={editForm} onChange={setEditForm} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditObservation}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={saving}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deletingObservation)} onClose={() => setDeletingObservation(null)}>
        <DialogTitle>Delete Observation?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete the observation for {deletingObservation?.problem_type} from{' '}
            {formatDate(deletingObservation?.observed_at)}? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingObservation(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteObservation} disabled={deleting}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default DiseaseTab;
