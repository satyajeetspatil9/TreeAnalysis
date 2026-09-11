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
  FormHelperText,
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
  controllerPinOptions,
  DEVICE_IO_OPTIONS,
  DEVICE_KIND_OPTIONS,
  ioTypeFromDeviceCode,
  ioTypeLabel,
  isMissingScheduleTable,
  scheduleTableHint,
} from '../../utils/irrigationSchedule';

const emptyForm = {
  name: '',
  device_code: '',
  io_type: 'output',
  kind: 'irrigation_motor',
  zone_id: '',
  is_active: true,
  tank_capacity_liters: '',
  fertilizer_flow_lph: '',
  product_id: '',
};

function optionalNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function IrrigationDevicesPanel({ farmId, zones, onChanged }) {
  const [devices, setDevices] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const takenCodes = useMemo(() => new Set(
    devices
      .filter((d) => !editing || d.id !== editing.id)
      .map((d) => String(d.device_code || '').toUpperCase()),
  ), [devices, editing]);

  // Keep a legacy / non-standard code selectable so editing an old device can't blank it.
  const pinOptions = useMemo(() => {
    const pins = controllerPinOptions(form.io_type);
    const current = String(form.device_code || '').toUpperCase();
    return current && !pins.includes(current) ? [current, ...pins] : pins;
  }, [form.io_type, form.device_code]);

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    const [{ data, error }, productsResult] = await Promise.all([
      supabase
        .from('irrigation_devices')
        .select('*, products(name)')
        .eq('farm_id', farmId)
        .order('name'),
      supabase
        .from('products')
        .select('id, name, unit')
        .eq('active', true)
        .eq('category', 'Fertilizer')
        .order('name'),
    ]);

    setProducts(productsResult.data || []);

    if (error && /product_id/.test(error.message || '')) {
      const fallback = await supabase
        .from('irrigation_devices')
        .select('*')
        .eq('farm_id', farmId)
        .order('name');
      if (fallback.error) {
        setMessage({
          type: isMissingScheduleTable(fallback.error) ? 'warning' : 'error',
          text: isMissingScheduleTable(fallback.error)
            ? 'Run migration 039_irrigation_schedule_control.sql in Supabase, then reload.'
            : scheduleTableHint(fallback.error.message),
        });
        setDevices([]);
      } else {
        setDevices(fallback.data || []);
        setMessage({
          type: 'warning',
          text: 'Run migration 059_fertigation_injector_specs.sql in Supabase so injector tank, flow, and product can be saved.',
        });
        if (onChanged) onChanged(fallback.data || []);
      }
      setLoading(false);
      return;
    }

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
    const used = new Set(devices.map((d) => String(d.device_code || '').toUpperCase()));
    setEditing(null);
    setForm({
      ...emptyForm,
      device_code: controllerPinOptions('output').find((pin) => !used.has(pin)) || '',
    });
    setOpen(true);
  };

  const openEdit = (device) => {
    setEditing(device);
    setForm({
      ...emptyForm,
      name: device.name,
      device_code: device.device_code,
      io_type: device.io_type || ioTypeFromDeviceCode(device.device_code) || 'output',
      kind: device.kind,
      zone_id: device.zone_id || '',
      is_active: device.is_active !== false,
      tank_capacity_liters: device.tank_capacity_liters != null ? String(device.tank_capacity_liters) : '',
      fertilizer_flow_lph: device.fertilizer_flow_lph != null ? String(device.fertilizer_flow_lph) : '',
      product_id: device.product_id != null ? String(device.product_id) : '',
    });
    setOpen(true);
  };

  const changeIoType = (io_type) => {
    setForm((f) => {
      const pins = controllerPinOptions(io_type);
      const current = String(f.device_code || '').toUpperCase();
      return {
        ...f,
        io_type,
        device_code: pins.includes(current)
          ? current
          : (pins.find((pin) => !takenCodes.has(pin)) || ''),
      };
    });
  };

  const save = async () => {
    if (!form.name.trim() || !form.device_code.trim()) {
      setMessage({ type: 'error', text: 'Name and controller terminal are required.' });
      return;
    }
    if (takenCodes.has(String(form.device_code).toUpperCase())) {
      setMessage({ type: 'error', text: `${form.device_code} is already used by another device.` });
      return;
    }
    setSaving(true);
    const isInjector = form.kind === 'fertigation';
    const payload = {
      farm_id: farmId,
      name: form.name.trim(),
      device_code: form.device_code.trim().toUpperCase(),
      io_type: form.io_type,
      kind: form.kind,
      zone_id: form.kind === 'zone_valve' && form.zone_id ? Number(form.zone_id) : null,
      is_active: form.is_active,
      tank_capacity_liters: isInjector ? optionalNumber(form.tank_capacity_liters) : null,
      fertilizer_flow_lph: isInjector ? optionalNumber(form.fertilizer_flow_lph) : null,
      product_id: isInjector && form.product_id ? Number(form.product_id) : null,
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
          Register motors, fertigation injectors, and other equipment, and map each one to the controller
          terminal it is wired to — outputs Y0–Y8 drive equipment, inputs X0–X8 sense it.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add device
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Kind</TableCell>
              <TableCell>Connected to</TableCell>
              <TableCell>Terminal</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell>Tank</TableCell>
              <TableCell>Fertilizer flow</TableCell>
              <TableCell>Product</TableCell>
              <TableCell>On</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {devices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10}>
                  <Typography color="text.secondary">No devices yet.</Typography>
                </TableCell>
              </TableRow>
            ) : devices.map((device) => {
              const kindLabel = DEVICE_KIND_OPTIONS.find((k) => k.value === device.kind)?.label || device.kind;
              const zone = (zones || []).find((z) => z.id === device.zone_id);
              return (
                <TableRow key={device.id} hover>
                  <TableCell>
                    <Typography fontWeight={700}>{device.name}</Typography>
                  </TableCell>
                  <TableCell>{kindLabel}</TableCell>
                  <TableCell>{ioTypeLabel(device.io_type || ioTypeFromDeviceCode(device.device_code))}</TableCell>
                  <TableCell>{device.device_code || '—'}</TableCell>
                  <TableCell>{zone?.zone_code || '—'}</TableCell>
                  <TableCell>
                    {device.kind === 'fertigation' && device.tank_capacity_liters
                      ? `${device.tank_capacity_liters} L`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {device.kind === 'fertigation' && device.fertilizer_flow_lph
                      ? `${device.fertilizer_flow_lph} L/hr`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {device.kind === 'fertigation'
                      ? (device.products?.name || products.find((p) => p.id === device.product_id)?.name || '—')
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={device.is_active !== false}
                      onChange={async (e) => {
                        const is_active = e.target.checked;
                        const { error } = await supabase
                          .from('irrigation_devices')
                          .update({ is_active, updated_at: new Date().toISOString() })
                          .eq('id', device.id);
                        if (error) {
                          setMessage({ type: 'error', text: scheduleTableHint(error.message) });
                          return;
                        }
                        await load();
                      }}
                      inputProps={{ 'aria-label': 'Active' }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => openEdit(device)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => remove(device)}>Delete</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

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
            <Grid item xs={12} sm={4}>
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
            <Grid item xs={6} sm={4}>
              <FormControl fullWidth>
                <InputLabel>Connected to</InputLabel>
                <Select
                  label="Connected to"
                  value={form.io_type}
                  onChange={(e) => changeIoType(e.target.value)}
                >
                  {DEVICE_IO_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={4}>
              <FormControl fullWidth>
                <InputLabel>Terminal</InputLabel>
                <Select
                  label="Terminal"
                  value={form.device_code}
                  onChange={(e) => setForm((f) => ({ ...f, device_code: e.target.value }))}
                >
                  {pinOptions.map((pin) => {
                    const taken = takenCodes.has(pin);
                    return (
                      <MenuItem key={pin} value={pin} disabled={taken}>
                        {taken ? `${pin} — in use` : pin}
                      </MenuItem>
                    );
                  })}
                </Select>
                <FormHelperText>
                  {form.io_type === 'input'
                    ? 'Controller input terminal the device senses on.'
                    : 'Controller output terminal that drives the device.'}
                </FormHelperText>
              </FormControl>
            </Grid>
            {form.kind === 'fertigation' && (
              <>
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel>Product</InputLabel>
                    <Select
                      label="Product"
                      value={form.product_id}
                      onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))}
                    >
                      <MenuItem value="">None</MenuItem>
                      {products.map((product) => (
                        <MenuItem key={product.id} value={String(product.id)}>
                          {product.name}{product.unit ? ` (${product.unit})` : ''}
                        </MenuItem>
                      ))}
                    </Select>
                    <FormHelperText>
                      {products.length === 0
                        ? 'Add a fertilizer under Farm Setting → Products first.'
                        : 'Fertilizer loaded in this injector tank'}
                    </FormHelperText>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Tank capacity (L)"
                    value={form.tank_capacity_liters}
                    onChange={(e) => setForm((f) => ({ ...f, tank_capacity_liters: e.target.value }))}
                    inputProps={{ min: 0, step: 'any' }}
                    helperText="Injector stock tank volume"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Fertilizer flow (L/hr)"
                    value={form.fertilizer_flow_lph}
                    onChange={(e) => setForm((f) => ({ ...f, fertilizer_flow_lph: e.target.value }))}
                    inputProps={{ min: 0, step: 'any' }}
                    helperText="Solution injected into the drip line"
                  />
                </Grid>
              </>
            )}
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
