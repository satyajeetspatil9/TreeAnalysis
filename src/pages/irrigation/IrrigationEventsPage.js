import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Button, FormControl, InputLabel, Select, MenuItem, Alert, Grid,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate } from '../../utils/formatters';
import { calcIrrigationWaterLiters, formatWaterLiters } from '../../utils/irrigation';

function rlsHint(message) {
  if (!message?.includes('row-level security')) return message;
  return `${message} Re-run supabase/migrations/008_fix_irrigation_rls.sql in Supabase SQL Editor.`;
}

const emptyForm = { zone_id: '', event_date: new Date().toISOString().slice(0, 10), duration_minutes: '' };

function buildEventPayload(zone, form) {
  const waterLiters = calcIrrigationWaterLiters(zone.flow_rate_lph, form.duration_minutes);
  return {
    zone_id: Number(form.zone_id),
    event_date: form.event_date,
    duration_minutes: Number(form.duration_minutes),
    water_liters: waterLiters,
    flow_rate_lph: Number(zone.flow_rate_lph),
  };
}

function IrrigationEventsPage() {
  const { farm } = useFarm();
  const [zones, setZones] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [deletingEvent, setDeletingEvent] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedZone = useMemo(
    () => zones.find((z) => String(z.id) === form.zone_id),
    [zones, form.zone_id]
  );

  const editZone = useMemo(
    () => zones.find((z) => String(z.id) === editForm.zone_id),
    [zones, editForm.zone_id]
  );

  const estimatedWater = useMemo(
    () => calcIrrigationWaterLiters(selectedZone?.flow_rate_lph, form.duration_minutes),
    [selectedZone, form.duration_minutes]
  );

  const editEstimatedWater = useMemo(
    () => calcIrrigationWaterLiters(editZone?.flow_rate_lph, editForm.duration_minutes),
    [editZone, editForm.duration_minutes]
  );

  const loadData = useCallback(async () => {
    if (!farm) {
      setZones([]);
      setEvents([]);
      return;
    }

    const { data: zonesData } = await supabase
      .from('irrigation_zones')
      .select('*')
      .eq('farm_id', farm.id)
      .order('zone_code');
    setZones(zonesData || []);

    const zoneIds = (zonesData || []).map((z) => z.id);
    if (zoneIds.length === 0) {
      setEvents([]);
      return;
    }

    const { data: eventsData } = await supabase
      .from('irrigation_events')
      .select('*, irrigation_zones(zone_code, flow_rate_lph)')
      .in('zone_id', zoneIds)
      .order('event_date', { ascending: false })
      .limit(50);
    setEvents(eventsData || []);
  }, [farm]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const validateEventForm = (eventForm, zone) => {
    if (!eventForm.zone_id) return 'Select a zone.';
    if (!eventForm.duration_minutes) return 'Enter duration (minutes).';
    if (!zone?.flow_rate_lph) {
      return 'This zone has no flow rate. Set it under Irrigation → Zones first.';
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validateEventForm(form, selectedZone);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    const waterLiters = calcIrrigationWaterLiters(selectedZone.flow_rate_lph, form.duration_minutes);

    const { error } = await supabase.from('irrigation_events').insert([buildEventPayload(selectedZone, form)]);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
    } else {
      setMessage({ type: 'success', text: `Irrigation recorded — ${formatWaterLiters(waterLiters)} applied.` });
      setForm({ zone_id: form.zone_id, event_date: form.event_date, duration_minutes: '' });
      loadData();
    }
  };

  const openEdit = (event) => {
    setEditingEvent(event);
    setEditForm({
      zone_id: String(event.zone_id),
      event_date: event.event_date,
      duration_minutes: event.duration_minutes != null ? String(event.duration_minutes) : '',
    });
  };

  const closeEdit = () => {
    setEditingEvent(null);
    setEditForm(emptyForm);
  };

  const handleSaveEdit = async () => {
    if (!editingEvent) return;

    const validationError = validateEventForm(editForm, editZone);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    setSaving(true);
    const waterLiters = calcIrrigationWaterLiters(editZone.flow_rate_lph, editForm.duration_minutes);

    const { error } = await supabase
      .from('irrigation_events')
      .update(buildEventPayload(editZone, editForm))
      .eq('id', editingEvent.id);

    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: `Event updated — ${formatWaterLiters(waterLiters)}.` });
    closeEdit();
    loadData();
  };

  const handleDelete = async () => {
    if (!deletingEvent) return;

    setDeleting(true);
    const { error } = await supabase.from('irrigation_events').delete().eq('id', deletingEvent.id);
    setDeleting(false);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Irrigation event deleted.' });
    if (editingEvent?.id === deletingEvent.id) closeEdit();
    setDeletingEvent(null);
    loadData();
  };

  return (
    <Box>
      <PageHeader
        section="Irrigation"
        title="Irrigation Events"
        subtitle="Record how long a zone ran. Water is calculated from zone flow rate × duration. Edit or delete past events in the table below."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Create a farm in Settings before recording irrigation.</Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Record event</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth required disabled={!farm}>
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
          <Grid item xs={12} md={4}>
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
          <Grid item xs={12} md={4}>
            <TextField
              label="Duration (min)"
              type="number"
              fullWidth
              required
              value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
              helperText={
                selectedZone?.flow_rate_lph
                  ? `Zone flow: ${selectedZone.flow_rate_lph} L/hr`
                  : form.zone_id
                    ? 'Set flow rate on Irrigation → Zones'
                    : 'Select a zone first'
              }
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Estimated water (L)"
              fullWidth
              value={estimatedWater != null ? String(Math.round(estimatedWater)) : ''}
              InputProps={{ readOnly: true }}
              helperText="Auto: flow rate × duration"
            />
          </Grid>
        </Grid>
        <Button
          variant="contained"
          sx={{ mt: 2 }}
          onClick={handleSave}
          disabled={!farm || !form.zone_id || !form.duration_minutes}
        >
          Save Event
        </Button>
      </Paper>

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Zone</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>Water</TableCell>
              <TableCell>Flow (L/hr)</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">No irrigation events yet.</TableCell>
              </TableRow>
            ) : (
              events.map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell>{e.irrigation_zones?.zone_code}</TableCell>
                  <TableCell>{formatDate(e.event_date)}</TableCell>
                  <TableCell>{e.duration_minutes ? `${e.duration_minutes} min` : '—'}</TableCell>
                  <TableCell>
                    {formatWaterLiters(
                      e.water_liters ?? calcIrrigationWaterLiters(
                        e.flow_rate_lph ?? e.irrigation_zones?.flow_rate_lph,
                        e.duration_minutes
                      )
                    )}
                  </TableCell>
                  <TableCell>{e.flow_rate_lph ?? e.irrigation_zones?.flow_rate_lph ?? '—'}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openEdit(e)} aria-label="Edit event">
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => setDeletingEvent(e)} aria-label="Delete event">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={!!editingEvent} onClose={closeEdit} maxWidth="sm" fullWidth>
        <DialogTitle>Edit irrigation event</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <FormControl fullWidth required>
                <InputLabel>Zone</InputLabel>
                <Select
                  value={editForm.zone_id}
                  label="Zone"
                  onChange={(e) => setEditForm({ ...editForm, zone_id: e.target.value })}
                >
                  {zones.map((z) => (
                    <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Date"
                type="date"
                fullWidth
                required
                InputLabelProps={{ shrink: true }}
                value={editForm.event_date}
                onChange={(e) => setEditForm({ ...editForm, event_date: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Duration (min)"
                type="number"
                fullWidth
                required
                value={editForm.duration_minutes}
                onChange={(e) => setEditForm({ ...editForm, duration_minutes: e.target.value })}
                helperText={
                  editZone?.flow_rate_lph
                    ? `Zone flow: ${editZone.flow_rate_lph} L/hr`
                    : 'Set flow rate on Irrigation → Zones'
                }
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Estimated water (L)"
                fullWidth
                value={editEstimatedWater != null ? String(Math.round(editEstimatedWater)) : ''}
                InputProps={{ readOnly: true }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          <Button color="error" onClick={() => editingEvent && setDeletingEvent(editingEvent)}>
            Delete
          </Button>
          <Box>
            <Button onClick={closeEdit} sx={{ mr: 1 }}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleSaveEdit}
              disabled={saving || !editForm.zone_id || !editForm.duration_minutes}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deletingEvent} onClose={() => setDeletingEvent(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete irrigation event?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mt: 1 }}>
            {deletingEvent && (
              <>
                Remove {deletingEvent.irrigation_zones?.zone_code} on {formatDate(deletingEvent.event_date)}
                {' '}({deletingEvent.duration_minutes} min)? This cannot be undone.
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingEvent(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default IrrigationEventsPage;
