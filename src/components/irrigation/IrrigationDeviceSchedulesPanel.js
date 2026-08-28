import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { supabase } from '../../supabaseClient';
import {
  isMissingScheduleTable,
  scheduleTableHint,
  timeToInputValue,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

function IrrigationDeviceSchedulesPanel({ farmId, devices }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    device_id: '',
    weekday: 1,
    start_time: '06:00',
    end_time: '14:00',
    enabled: true,
    cyclic_on_minutes: '',
    cyclic_off_minutes: '',
  });

  const schedulable = (devices || []).filter((d) =>
    ['irrigation_motor', 'bore_motor', 'other', 'fertigation'].includes(d.kind));

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('irrigation_device_schedules')
      .select('*, irrigation_devices(name, device_code, kind)')
      .eq('farm_id', farmId)
      .order('weekday');

    if (error) {
      setMessage({
        type: isMissingScheduleTable(error) ? 'warning' : 'error',
        text: isMissingScheduleTable(error)
          ? 'Run migration 039_irrigation_schedule_control.sql in Supabase, then reload.'
          : scheduleTableHint(error.message),
      });
      setRows([]);
    } else {
      setRows(data || []);
      setMessage(null);
    }
    setLoading(false);
  }, [farmId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!form.device_id) {
      setMessage({ type: 'error', text: 'Select a device.' });
      return;
    }
    setSaving(true);
    const payload = {
      farm_id: farmId,
      device_id: Number(form.device_id),
      weekday: Number(form.weekday),
      start_time: `${timeToInputValue(form.start_time)}:00`,
      end_time: `${timeToInputValue(form.end_time)}:00`,
      enabled: form.enabled,
      cyclic_on_minutes: form.cyclic_on_minutes === '' ? null : Number(form.cyclic_on_minutes),
      cyclic_off_minutes: form.cyclic_off_minutes === '' ? null : Number(form.cyclic_off_minutes),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('irrigation_device_schedules').insert({
      ...payload,
      created_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    setOpen(false);
    setMessage({ type: 'success', text: 'Schedule added.' });
    await load();
  };

  const remove = async (row) => {
    const { error } = await supabase.from('irrigation_device_schedules').delete().eq('id', row.id);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    await load();
  };

  const toggle = async (row) => {
    const { error } = await supabase
      .from('irrigation_device_schedules')
      .update({ enabled: !row.enabled, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    await load();
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
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

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          Weekly start/stop for motors and other devices. Optional cyclic on/off (bore) within the window.
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          disabled={!schedulable.length}
          onClick={() => {
            setForm({
              device_id: schedulable[0] ? String(schedulable[0].id) : '',
              weekday: 1,
              start_time: '06:00',
              end_time: '14:00',
              enabled: true,
              cyclic_on_minutes: '',
              cyclic_off_minutes: '',
            });
            setOpen(true);
          }}
        >
          Add schedule
        </Button>
      </Box>

      {!schedulable.length && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Add a motor or other device under Devices first.
        </Alert>
      )}

      {rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No device schedules yet.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {rows.map((row) => (
            <Grid item xs={12} sm={6} key={row.id}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography fontWeight={800}>
                    {row.irrigation_devices?.name || 'Device'}
                  </Typography>
                  <Switch checked={row.enabled} onChange={() => toggle(row)} />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {WEEKDAY_LABELS[row.weekday]} · {timeToInputValue(row.start_time)}–{timeToInputValue(row.end_time)}
                  {row.cyclic_on_minutes
                    ? ` · cyclic ${row.cyclic_on_minutes}m on / ${row.cyclic_off_minutes}m off`
                    : ''}
                </Typography>
                <Button size="small" color="error" sx={{ mt: 1 }} onClick={() => remove(row)}>
                  Delete
                </Button>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add device schedule</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Device</InputLabel>
                <Select
                  label="Device"
                  value={form.device_id}
                  onChange={(e) => setForm((f) => ({ ...f, device_id: e.target.value }))}
                >
                  {schedulable.map((d) => (
                    <MenuItem key={d.id} value={String(d.id)}>
                      {d.name} ({d.device_code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth>
                <InputLabel>Weekday</InputLabel>
                <Select
                  label="Weekday"
                  value={form.weekday}
                  onChange={(e) => setForm((f) => ({ ...f, weekday: e.target.value }))}
                >
                  {WEEKDAY_LABELS.map((label, day) => (
                    <MenuItem key={label} value={day}>{label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={4}>
              <TextField
                fullWidth
                label="Start"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={6} sm={4}>
              <TextField
                fullWidth
                label="End"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Cyclic on (min)"
                type="number"
                value={form.cyclic_on_minutes}
                onChange={(e) => setForm((f) => ({ ...f, cyclic_on_minutes: e.target.value }))}
                helperText="Optional bore cycle"
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Cyclic off (min)"
                type="number"
                value={form.cyclic_off_minutes}
                onChange={(e) => setForm((f) => ({ ...f, cyclic_off_minutes: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={(
                  <Switch
                    checked={form.enabled}
                    onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                  />
                )}
                label="Enabled"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default IrrigationDeviceSchedulesPanel;
