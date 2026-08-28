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
  DEVICE_KIND_OPTIONS,
  isMissingScheduleTable,
  scheduleTableHint,
} from '../../utils/irrigationSchedule';

function IrrigationDevicesPanel({ farmId, zones, onChanged }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '',
    device_code: '',
    kind: 'irrigation_motor',
    zone_id: '',
    is_active: true,
  });

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('irrigation_devices')
      .select('*')
      .eq('farm_id', farmId)
      .order('name');

    if (error) {
      setMessage({
        type: isMissingScheduleTable(error) ? 'warning' : 'error',
        text: isMissingScheduleTable(error)
          ? 'Run migration 039_irrigation_schedule_control.sql in Supabase, then reload.'
          : scheduleTableHint(error.message),
      });
      setDevices([]);
    } else {
      const list = data || [];
      setDevices(list);
      setMessage(null);
      if (onChanged) onChanged(list);
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onChanged is optional parent setter
  }, [farmId]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      device_code: '',
      kind: 'irrigation_motor',
      zone_id: '',
      is_active: true,
    });
    setOpen(true);
  };

  const openEdit = (device) => {
    setEditing(device);
    setForm({
      name: device.name,
      device_code: device.device_code,
      kind: device.kind,
      zone_id: device.zone_id || '',
      is_active: device.is_active !== false,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.device_code.trim()) {
      setMessage({ type: 'error', text: 'Name and device code are required.' });
      return;
    }
    setSaving(true);
    const payload = {
      farm_id: farmId,
      name: form.name.trim(),
      device_code: form.device_code.trim().toUpperCase(),
      kind: form.kind,
      zone_id: form.kind === 'zone_valve' && form.zone_id ? Number(form.zone_id) : null,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };

    const result = editing
      ? await supabase.from('irrigation_devices').update(payload).eq('id', editing.id)
      : await supabase.from('irrigation_devices').insert({
        ...payload,
        created_at: new Date().toISOString(),
      });

    setSaving(false);
    if (result.error) {
      setMessage({ type: 'error', text: scheduleTableHint(result.error.message) });
      return;
    }
    setOpen(false);
    setMessage({ type: 'success', text: editing ? 'Device updated.' : 'Device added.' });
    await load();
  };

  const remove = async (device) => {
    const { error } = await supabase.from('irrigation_devices').delete().eq('id', device.id);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    setMessage({ type: 'success', text: 'Device removed.' });
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
          Register motors, fertigation injectors, and other equipment the controller addresses by device code.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add device
        </Button>
      </Box>

      {devices.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No devices yet.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {devices.map((device) => {
            const kindLabel = DEVICE_KIND_OPTIONS.find((k) => k.value === device.kind)?.label || device.kind;
            const zone = (zones || []).find((z) => z.id === device.zone_id);
            return (
              <Grid item xs={12} sm={6} md={4} key={device.id}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h6" fontWeight={800}>{device.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {kindLabel} · {device.device_code}
                    {zone ? ` · ${zone.zone_code}` : ''}
                  </Typography>
                  <Typography variant="caption" color={device.is_active ? 'success.main' : 'text.secondary'}>
                    {device.is_active ? 'Active' : 'Inactive'}
                  </Typography>
                  <Box sx={{ mt: 1.5, display: 'flex', gap: 1 }}>
                    <Button size="small" onClick={() => openEdit(device)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => remove(device)}>Delete</Button>
                  </Box>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit device' : 'Add device'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Device code"
                value={form.device_code}
                onChange={(e) => setForm((f) => ({ ...f, device_code: e.target.value }))}
                helperText="Matches controller / queue device_code"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Kind</InputLabel>
                <Select
                  label="Kind"
                  value={form.kind}
                  onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
                >
                  {DEVICE_KIND_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            {form.kind === 'zone_valve' && (
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Linked zone</InputLabel>
                  <Select
                    label="Linked zone"
                    value={form.zone_id}
                    onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value }))}
                  >
                    {(zones || []).map((z) => (
                      <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Switch
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
                <Typography>Active</Typography>
              </Box>
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

export default IrrigationDevicesPanel;
