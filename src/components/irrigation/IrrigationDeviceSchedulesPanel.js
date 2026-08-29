import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { supabase } from '../../supabaseClient';
import {
  formatClockDisplay,
  isMissingScheduleTable,
  programDaysLabel,
  scheduleTableHint,
  timeToInputValue,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

const emptyForm = (deviceId = '') => ({
  device_id: deviceId,
  weekdays: [1, 2, 3, 4],
  start_time: '06:00',
  end_time: '14:00',
  enabled: true,
  cyclic_on_minutes: '',
  cyclic_off_minutes: '',
});

function groupSchedules(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = [
      row.device_id,
      timeToInputValue(row.start_time),
      timeToInputValue(row.end_time),
      row.cyclic_on_minutes ?? '',
      row.cyclic_off_minutes ?? '',
      row.enabled ? '1' : '0',
    ].join('|');
    if (!map.has(key)) {
      map.set(key, {
        key,
        device_id: row.device_id,
        start_time: timeToInputValue(row.start_time),
        end_time: timeToInputValue(row.end_time),
        cyclic_on_minutes: row.cyclic_on_minutes,
        cyclic_off_minutes: row.cyclic_off_minutes,
        enabled: row.enabled !== false,
        irrigation_devices: row.irrigation_devices,
        items: [],
      });
    }
    map.get(key).items.push(row);
  });

  return [...map.values()].map((group) => ({
    ...group,
    weekdays: group.items.map((item) => Number(item.weekday)).sort((a, b) => a - b),
    ids: group.items.map((item) => item.id),
  }));
}

function IrrigationDeviceSchedulesPanel({ farmId, devices }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());

  const schedulable = (devices || []).filter((d) =>
    ['irrigation_motor', 'bore_motor', 'other', 'fertigation'].includes(d.kind)
    && d.io_type !== 'input');

  const grouped = useMemo(() => groupSchedules(rows), [rows]);

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('irrigation_device_schedules')
      .select('*, irrigation_devices(name, device_code, kind)')
      .eq('farm_id', farmId)
      .order('weekday')
      .order('start_time');

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

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(schedulable[0] ? String(schedulable[0].id) : ''));
    setOpen(true);
  };

  const openEdit = (group) => {
    setEditing(group);
    setForm({
      device_id: String(group.device_id),
      weekdays: group.weekdays,
      start_time: group.start_time,
      end_time: group.end_time,
      enabled: group.enabled,
      cyclic_on_minutes: group.cyclic_on_minutes ?? '',
      cyclic_off_minutes: group.cyclic_off_minutes ?? '',
    });
    setOpen(true);
  };

  const applyDays = (weekdays) => setForm((f) => ({ ...f, weekdays }));

  const toggleDay = (day) => {
    setForm((prev) => {
      const has = prev.weekdays.includes(day);
      const weekdays = has
        ? prev.weekdays.filter((d) => d !== day)
        : [...prev.weekdays, day].sort((a, b) => a - b);
      return { ...prev, weekdays };
    });
  };

  const rowPayload = (weekday) => ({
    farm_id: farmId,
    device_id: Number(form.device_id),
    weekday: Number(weekday),
    start_time: `${timeToInputValue(form.start_time)}:00`,
    end_time: `${timeToInputValue(form.end_time)}:00`,
    enabled: form.enabled,
    cyclic_on_minutes: form.cyclic_on_minutes === '' ? null : Number(form.cyclic_on_minutes),
    cyclic_off_minutes: form.cyclic_off_minutes === '' ? null : Number(form.cyclic_off_minutes),
    updated_at: new Date().toISOString(),
  });

  const save = async () => {
    if (!form.device_id) {
      setMessage({ type: 'error', text: 'Select a device.' });
      return;
    }
    if (!form.weekdays.length) {
      setMessage({ type: 'error', text: 'Pick at least one day.' });
      return;
    }
    if (timeToInputValue(form.end_time) <= timeToInputValue(form.start_time)) {
      setMessage({ type: 'error', text: 'End time must be after start time.' });
      return;
    }

    setSaving(true);
    const selected = [...form.weekdays].map(Number).sort((a, b) => a - b);

    if (editing) {
      const existingByDay = new Map(editing.items.map((item) => [Number(item.weekday), item]));
      const toDelete = editing.items
        .filter((item) => !selected.includes(Number(item.weekday)))
        .map((item) => item.id);

      for (const weekday of selected) {
        const existing = existingByDay.get(weekday);
        const payload = rowPayload(weekday);
        if (existing) {
          const { error } = await supabase
            .from('irrigation_device_schedules')
            .update(payload)
            .eq('id', existing.id);
          if (error) {
            setSaving(false);
            setMessage({ type: 'error', text: scheduleTableHint(error.message) });
            return;
          }
        } else {
          const { error } = await supabase.from('irrigation_device_schedules').insert({
            ...payload,
            created_at: new Date().toISOString(),
          });
          if (error) {
            setSaving(false);
            setMessage({ type: 'error', text: scheduleTableHint(error.message) });
            return;
          }
        }
      }

      if (toDelete.length) {
        const { error } = await supabase.from('irrigation_device_schedules').delete().in('id', toDelete);
        if (error) {
          setSaving(false);
          setMessage({ type: 'error', text: scheduleTableHint(error.message) });
          return;
        }
      }
    } else {
      const inserts = selected.map((weekday) => ({
        ...rowPayload(weekday),
        created_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('irrigation_device_schedules').insert(inserts);
      if (error) {
        setSaving(false);
        setMessage({ type: 'error', text: scheduleTableHint(error.message) });
        return;
      }
    }

    setSaving(false);
    setOpen(false);
    setMessage({ type: 'success', text: editing ? 'Schedule updated.' : 'Schedule added.' });
    await load();
  };

  const removeGroup = async (group) => {
    const { error } = await supabase.from('irrigation_device_schedules').delete().in('id', group.ids);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    setMessage({ type: 'success', text: 'Schedule removed.' });
    await load();
  };

  const toggleGroup = async (group) => {
    const { error } = await supabase
      .from('irrigation_device_schedules')
      .update({ enabled: !group.enabled, updated_at: new Date().toISOString() })
      .in('id', group.ids);
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

      <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
        Other schedules
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 640 }}>
          Weekly on/off for motors and other devices. Pick multiple days for the same start and end time.
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          disabled={!schedulable.length}
          onClick={openCreate}
        >
          Add schedule
        </Button>
      </Box>

      {!schedulable.length && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Add a motor or other device under Devices first.
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Device</TableCell>
              <TableCell>Days</TableCell>
              <TableCell>Start</TableCell>
              <TableCell>End</TableCell>
              <TableCell>Cycle</TableCell>
              <TableCell>On</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {grouped.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">No device schedules yet.</Typography>
                </TableCell>
              </TableRow>
            ) : grouped.map((group) => (
              <TableRow key={group.key} hover>
                <TableCell>
                  <Typography fontWeight={700}>
                    {group.irrigation_devices?.name || 'Device'}
                  </Typography>
                  {group.irrigation_devices?.device_code && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {group.irrigation_devices.device_code}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>{programDaysLabel(group.weekdays)}</TableCell>
                <TableCell>{formatClockDisplay(group.start_time) || group.start_time}</TableCell>
                <TableCell>{formatClockDisplay(group.end_time) || group.end_time}</TableCell>
                <TableCell>
                  {group.cyclic_on_minutes
                    ? `${group.cyclic_on_minutes}m on / ${group.cyclic_off_minutes || 0}m off`
                    : '—'}
                </TableCell>
                <TableCell>
                  <Switch
                    size="small"
                    checked={group.enabled}
                    onChange={() => toggleGroup(group)}
                    inputProps={{ 'aria-label': 'Enabled' }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => openEdit(group)}>Modify</Button>
                  <Button size="small" color="error" onClick={() => removeGroup(group)}>Delete</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Modify schedule' : 'Add schedule'}</DialogTitle>
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
            <Grid item xs={12}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>Days</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
                <Button size="small" onClick={() => applyDays([1, 2, 3, 4, 5, 6])}>Mon–Sat</Button>
                <Button size="small" onClick={() => applyDays([1, 2, 3, 4])}>Mon–Thu</Button>
                <Button size="small" onClick={() => applyDays([0, 1, 2, 3, 4, 5, 6])}>Every day</Button>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {WEEKDAY_LABELS.map((label, day) => {
                  const selected = form.weekdays.includes(day);
                  return (
                    <Button
                      key={label}
                      size="small"
                      variant={selected ? 'contained' : 'outlined'}
                      onClick={() => toggleDay(day)}
                      sx={{ minWidth: 48, px: 1 }}
                    >
                      {label}
                    </Button>
                  );
                })}
              </Box>
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Start"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={6}>
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
            {saving ? 'Saving…' : (editing ? 'Save' : 'Add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default IrrigationDeviceSchedulesPanel;
