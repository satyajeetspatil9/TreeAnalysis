import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Button, FormControl, InputLabel, Select, MenuItem, Alert, Grid,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, formatTime } from '../../utils/formatters';
import {
  calcIrrigationWaterLiters,
  formatWaterLiters,
  resolveEventWaterLiters,
  filterEventsByPeriod,
  buildFarmIrrigationChartData,
  IRRIGATION_PERIOD_OPTIONS,
  IRRIGATION_GROUP_OPTIONS,
  syncCompletedIrrigationJobs,
} from '../../utils/irrigation';

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
  const theme = useTheme();
  const { farm } = useFarm();
  const [zones, setZones] = useState([]);
  const [events, setEvents] = useState([]);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [deletingEvent, setDeletingEvent] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [period, setPeriod] = useState('180d');
  const [grouping, setGrouping] = useState('week');

  const editZone = useMemo(
    () => zones.find((z) => String(z.id) === editForm.zone_id),
    [zones, editForm.zone_id],
  );

  const editEstimatedWater = useMemo(
    () => calcIrrigationWaterLiters(editZone?.flow_rate_lph, editForm.duration_minutes),
    [editZone, editForm.duration_minutes],
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

    try {
      const { events: eventsData } = await syncCompletedIrrigationJobs(supabase, {
        farmId: farm.id,
        zoneIds,
      });
      setEvents(eventsData);
    } catch (err) {
      setMessage({ type: 'error', text: rlsHint(err.message) });
      setEvents([]);
    }
  }, [farm]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredEvents = useMemo(
    () => filterEventsByPeriod(events, period),
    [events, period],
  );

  const chartData = useMemo(
    () => buildFarmIrrigationChartData(filteredEvents, grouping),
    [filteredEvents, grouping],
  );

  const validateEventForm = (eventForm, zone) => {
    if (!eventForm.zone_id) return 'Select a zone.';
    if (!eventForm.duration_minutes) return 'Enter duration (minutes).';
    if (!zone?.flow_rate_lph) {
      return 'This zone has no flow rate. Set it under Farm Setting → Zones first.';
    }
    return null;
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
        section="Monitoring"
        title="Irrigation"
        subtitle="Water applied from programs and logged events. Completed water programs appear here automatically."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Create a farm in Settings before viewing irrigation.</Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Water applied</Typography>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Period</InputLabel>
              <Select label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
                {IRRIGATION_PERIOD_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Group by</InputLabel>
              <Select label="Group by" value={grouping} onChange={(e) => setGrouping(e.target.value)}>
                {IRRIGATION_GROUP_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {chartData.length > 0 ? (
          <Box sx={{ width: '100%', height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                <XAxis dataKey="label" tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                <YAxis
                  yAxisId="water"
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  label={{ value: 'Liters', angle: -90, position: 'insideLeft', fill: theme.palette.text.secondary }}
                />
                <YAxis
                  yAxisId="duration"
                  orientation="right"
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  label={{ value: 'Minutes', angle: 90, position: 'insideRight', fill: theme.palette.text.secondary }}
                />
                <Tooltip
                  formatter={(value, name) => (
                    name === 'Duration'
                      ? `${formatNumber(value, 0)} min`
                      : formatWaterLiters(value)
                  )}
                />
                <Legend />
                <Line
                  yAxisId="water"
                  type="monotone"
                  dataKey="water"
                  name="Water (L)"
                  stroke={theme.palette.primary.main}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="duration"
                  type="monotone"
                  dataKey="duration"
                  name="Duration"
                  stroke={theme.palette.info.main}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        ) : (
          <Typography color="text.secondary">No irrigation events in the selected period.</Typography>
        )}
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Zone</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Start</TableCell>
              <TableCell>End</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>Water</TableCell>
              <TableCell>Flow (L/hr)</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredEvents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">No irrigation events yet.</TableCell>
              </TableRow>
            ) : (
              filteredEvents.map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell>{e.irrigation_zones?.zone_code}</TableCell>
                  <TableCell>{formatDate(e.event_date)}</TableCell>
                  <TableCell>{formatTime(e.started_at)}</TableCell>
                  <TableCell>{formatTime(e.ended_at)}</TableCell>
                  <TableCell>{e.duration_minutes ? `${e.duration_minutes} min` : '—'}</TableCell>
                  <TableCell>{formatWaterLiters(resolveEventWaterLiters(e))}</TableCell>
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
                    : 'Set flow rate on Farm Setting → Zones'
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
