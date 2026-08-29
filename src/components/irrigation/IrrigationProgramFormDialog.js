import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  defaultStartFromWindows,
  estimateMinutesFromLiters,
  estimateProgramMinutes,
  formatEstimatedDuration,
  timeToInputValue,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

function emptyStep(seq = 0) {
  return { zone_id: '', target_liters: '', on_duration_minutes: '', seq, is_active: true };
}

export default function IrrigationProgramFormDialog({
  open,
  onClose,
  editing,
  form,
  setForm,
  zones,
  windows,
  motors,
  injectors,
  programType,
  saving,
  onSave,
}) {
  const [error, setError] = useState(null);

  const totalMinutes = useMemo(
    () => estimateProgramMinutes(form.steps, zones),
    [form.steps, zones],
  );

  useEffect(() => {
    if (open) setError(null);
  }, [open, editing?.id]);

  const toggleDay = (day) => {
    setForm((prev) => {
      const has = prev.days_of_week.includes(day);
      const days_of_week = has
        ? prev.days_of_week.filter((d) => d !== day)
        : [...prev.days_of_week, day].sort((a, b) => a - b);
      return {
        ...prev,
        days_of_week,
        start_times: [defaultStartFromWindows(windows, days_of_week)],
        use_allowed_windows: true,
      };
    });
  };

  const updateStep = (idx, patch) => {
    setForm((f) => {
      const steps = [...f.steps];
      steps[idx] = { ...steps[idx], ...patch };
      return { ...f, steps };
    });
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      setError('Enter a program name.');
      return;
    }
    if (!form.days_of_week.length) {
      setError('Pick at least one day.');
      return;
    }
    const validSteps = (form.steps || []).filter((s) => s.zone_id && s.target_liters);
    if (!validSteps.length) {
      setError('Add at least one zone with target liters.');
      return;
    }
    setError(null);
    onSave();
  };

  const title = editing
    ? `Edit ${programType === 'fertigation' ? 'fertigation' : 'water'} program`
    : `New ${programType === 'fertigation' ? 'fertigation' : 'water'} program`;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <TextField
          fullWidth
          label="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          sx={{ mb: 2.5 }}
          autoFocus
        />

        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Days
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2.5 }}>
          {WEEKDAY_LABELS.map((label, day) => {
            const selected = form.days_of_week.includes(day);
            return (
              <Button
                key={label}
                size="small"
                variant={selected ? 'contained' : 'outlined'}
                onClick={() => toggleDay(day)}
                sx={{ minWidth: 44, px: 1 }}
              >
                {label}
              </Button>
            );
          })}
        </Box>

        <TextField
          type="time"
          label="Start time"
          value={timeToInputValue(form.start_times[0] || '06:00')}
          onChange={(e) => setForm((f) => ({
            ...f,
            start_times: [e.target.value],
            use_allowed_windows: true,
          }))}
          InputLabelProps={{ shrink: true }}
          helperText="Runs inside Allowed hours (MSEB power)"
          sx={{ mb: 3, maxWidth: 180 }}
        />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Zones (one after another)
          </Typography>
          {totalMinutes > 0 && (
            <Typography variant="body2" color="text.secondary">
              ~{formatEstimatedDuration(totalMinutes)} total
            </Typography>
          )}
        </Box>

        <Stack spacing={1.5}>
          {form.steps.map((step, idx) => {
            const zone = (zones || []).find((z) => String(z.id) === String(step.zone_id));
            const est = estimateMinutesFromLiters(step.target_liters, zone?.flow_rate_lph);
            return (
              <Box
                key={idx}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1.2fr 1fr auto auto' },
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <FormControl fullWidth size="small">
                  <InputLabel>Zone</InputLabel>
                  <Select
                    label="Zone"
                    value={step.zone_id}
                    onChange={(e) => {
                      const zone_id = e.target.value;
                      const z = (zones || []).find((item) => String(item.id) === String(zone_id));
                      const computed = estimateMinutesFromLiters(step.target_liters, z?.flow_rate_lph);
                      updateStep(idx, {
                        zone_id,
                        on_duration_minutes: computed != null ? String(computed) : '',
                      });
                    }}
                  >
                    {(zones || []).map((z) => (
                      <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  label="Liters"
                  type="number"
                  value={step.target_liters}
                  onChange={(e) => {
                    const target_liters = e.target.value;
                    const computed = estimateMinutesFromLiters(target_liters, zone?.flow_rate_lph);
                    updateStep(idx, {
                      target_liters,
                      on_duration_minutes: computed != null ? String(computed) : '',
                    });
                  }}
                  helperText={est != null ? `~${formatEstimatedDuration(est)}` : ' '}
                />
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 36 }}>
                  #{idx + 1}
                </Typography>
                <IconButton
                  size="small"
                  disabled={form.steps.length <= 1}
                  onClick={() => setForm((f) => ({
                    ...f,
                    steps: f.steps.filter((_, i) => i !== idx),
                  }))}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            );
          })}
        </Stack>

        <Button
          size="small"
          startIcon={<AddIcon />}
          sx={{ mt: 1.5 }}
          onClick={() => setForm((f) => ({
            ...f,
            steps: [...f.steps, emptyStep(f.steps.length)],
          }))}
        >
          Add zone
        </Button>

        {/* Keep motors/injectors available but out of the way */}
        {(motors.length > 0 || (programType === 'fertigation' && injectors.length > 0)) && (
          <Box sx={{ mt: 3 }}>
            {motors.length > 0 && (
              <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                <InputLabel>Motor (optional)</InputLabel>
                <Select
                  label="Motor (optional)"
                  value={form.motor_device_ids[0] || ''}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    motor_device_ids: e.target.value ? [e.target.value] : [],
                  }))}
                >
                  <MenuItem value="">None</MenuItem>
                  {motors.map((m) => (
                    <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {programType === 'fertigation' && injectors.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>Injector</InputLabel>
                <Select
                  label="Injector"
                  value={form.injector_ids[0] || ''}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    injector_ids: e.target.value ? [e.target.value] : [],
                  }))}
                >
                  <MenuItem value="">None</MenuItem>
                  {injectors.map((m) => (
                    <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : (editing ? 'Save' : 'Create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export { emptyStep };
