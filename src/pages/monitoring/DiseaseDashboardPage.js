import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, Chip,
  Alert, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText,
  Button, TextField, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { supabase } from '../../supabaseClient';
import { formatDate, getTreeDisplayId } from '../../utils/formatters';
import { rlsHint } from '../../utils/soil';
import PageHeader from '../../components/common/PageHeader';

const PROBLEM_CATEGORIES = [
  { value: 'DISEASE', label: 'Disease' },
  { value: 'PEST', label: 'Pest' },
  { value: 'NUTRIENT_DEFICIENCY', label: 'Nutrient deficiency' },
  { value: 'WATER_STRESS', label: 'Water stress' },
  { value: 'PHYSICAL_DAMAGE', label: 'Physical damage' },
  { value: 'OTHER', label: 'Other' },
];

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

function DiseaseDashboardPage() {
  const [observations, setObservations] = useState([]);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingObservation, setEditingObservation] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm());
  const [deletingObservation, setDeletingObservation] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('disease_observations')
      .select('*, trees(tree_positions(position_code), variety)')
      .order('observed_at', { ascending: false })
      .limit(100);
    setObservations(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

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
    if (!editForm.problem_type.trim()) {
      setMessage({ type: 'error', text: 'Problem type is required.' });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('disease_observations')
      .update({
        problem_type: editForm.problem_type.trim(),
        problem_category: editForm.problem_category,
        severity: editForm.severity,
        symptoms: editForm.symptoms.trim() || null,
        treatment: editForm.treatment.trim() || null,
        result: editForm.result.trim() || null,
        observed_at: editForm.observed_at,
      })
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
    load();
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
    load();
  };

  return (
    <Box>
      <PageHeader
        section="Monitoring"
        title="Disease & Pest"
        subtitle="Farm-wide view. Record per-tree observations on each Tree Dashboard."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Tree</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Problem</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell>Result</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {observations.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{formatDate(o.observed_at)}</TableCell>
                <TableCell>
                  <Typography component={RouterLink} to={`/tree/${getTreeDisplayId(o.trees || {})}`} sx={{ color: 'primary.main', textDecoration: 'none' }}>
                    {getTreeDisplayId(o.trees || {})}
                  </Typography>
                </TableCell>
                <TableCell>{o.problem_category || '—'}</TableCell>
                <TableCell>{o.problem_type}</TableCell>
                <TableCell><Chip label={o.severity || '—'} size="small" /></TableCell>
                <TableCell>{o.result || o.treatment || o.symptoms || '—'}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" aria-label="Edit observation" onClick={() => openEditObservation(o)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label="Delete observation" onClick={() => setDeletingObservation(o)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {observations.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">No disease observations yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={Boolean(editingObservation)} onClose={closeEditObservation} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Observation</DialogTitle>
        <DialogContent>
          <TextField
            label="Problem"
            fullWidth
            margin="normal"
            required
            value={editForm.problem_type}
            onChange={(e) => setEditForm({ ...editForm, problem_type: e.target.value })}
          />
          <TextField
            label="Observation date"
            type="date"
            fullWidth
            margin="normal"
            InputLabelProps={{ shrink: true }}
            value={editForm.observed_at}
            onChange={(e) => setEditForm({ ...editForm, observed_at: e.target.value })}
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Category</InputLabel>
            <Select
              value={editForm.problem_category}
              label="Category"
              onChange={(e) => setEditForm({ ...editForm, problem_category: e.target.value })}
            >
              {PROBLEM_CATEGORIES.map(({ value, label }) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth margin="normal">
            <InputLabel>Severity</InputLabel>
            <Select
              value={editForm.severity}
              label="Severity"
              onChange={(e) => setEditForm({ ...editForm, severity: e.target.value })}
            >
              <MenuItem value="Low">Low</MenuItem>
              <MenuItem value="Medium">Medium</MenuItem>
              <MenuItem value="High">High</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Symptoms"
            fullWidth
            margin="normal"
            multiline
            rows={2}
            value={editForm.symptoms}
            onChange={(e) => setEditForm({ ...editForm, symptoms: e.target.value })}
          />
          <TextField
            label="Treatment"
            fullWidth
            margin="normal"
            multiline
            rows={2}
            value={editForm.treatment}
            onChange={(e) => setEditForm({ ...editForm, treatment: e.target.value })}
          />
          <TextField
            label="Result"
            fullWidth
            margin="normal"
            multiline
            rows={2}
            value={editForm.result}
            onChange={(e) => setEditForm({ ...editForm, result: e.target.value })}
          />
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
            Delete {deletingObservation?.problem_type} for{' '}
            {getTreeDisplayId(deletingObservation?.trees || {})} on{' '}
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

export default DiseaseDashboardPage;
