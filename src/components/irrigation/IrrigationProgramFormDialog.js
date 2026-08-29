import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
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
  suggestStartsFromAllowedWindows,
  timeToInputValue,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

function emptyStep(seq = 0) {
  return { zone_id: '', target_liters: '', on_duration_minutes: '', seq, is_active: true };
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Group allowed windows into "Mon, Tue · 06:00–14:00" lines for the selected days. */
function groupAllowedRanges(windows, daysOfWeek) {
  const { slots } = suggestStartsFromAllowedWindows(windows, daysOfWeek);
  const byRange = new Map();

  slots.forEach((slot) => {
    const key = `${slot.start}–${slot.end}`;
    const days = byRange.get(key) || [];
    days.push(slot.weekday);
    byRange.set(key, days);
  });

  return [...byRange.entries()].map(([range, days]) => ({
    range,
    days: [...new Set(days)]
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d])
      .join(', '),
  }));
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

  const allowedRanges = useMemo(
    () => groupAllowedRanges(windows, form.days_of_week),
    [windows, form.days_of_week],
  );

  const startTime = timeToInputValue(form.start_times[0] || '06:00');

  const startOutsideAllowed = useMemo(() => {
    const { slots } = suggestStartsFromAllowedWindows(windows, form.days_of_week);
    if (!slots.length) return false;
    const now = minutesOf(startTime);
    return !slots.some((s) => now >= minutesOf(s.start) && now < minutesOf(s.end));
  }, [windows, form.days_of_week, startTime]);

  useEffect(() => {
    if (open) setError(null);
  }, [open, editing?.id]);

  useEffect(() => {
    if (!open || editing) return;
    if ((form.motor_device_ids || []).length) return;
    if (motors.length !== 1) return;
    setForm((f) => {
      if ((f.motor_device_ids || []).length) return f;
      return { ...f, motor_device_ids: [motors[0].id] };
    });
  }, [open, editing, motors, form.motor_device_ids, setForm]);

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

        <Grid container spacing={2.5}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </Grid>

          <Grid item xs={12}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Days
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {WEEKDAY_LABELS.map((label, day) => {
                const selected = form.days_of_week.includes(day);
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

          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              type="time"
              label="Start time"
              value={startTime}
              onChange={(e) => setForm((f) => ({
                ...f,
                start_times: [e.target.value],
                use_allowed_windows: true,
              }))}
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 300 }}
            />
          </Grid>

          <Grid item xs={12} sm={8}>
            <FormControl
              component="fieldset"
              variant="standard"
              fullWidth
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                px: 1.5,
                pb: 1.25,
                minHeight: 56,
                height: '100%',
              }}
            >
              <FormLabel
                component="legend"
                sx={{ px: 0.5, typography: 'caption', fontWeight: 600, color: 'text.secondary' }}
              >
                Allowed timing
              </FormLabel>
              {allowedRanges.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Not set for these days — add it in Allowed hours.
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, pt: 0.25 }}>
                  {allowedRanges.map((item) => (
                    <Chip
                      key={item.range}
                      size="small"
                      variant="outlined"
                      label={`${item.days} · ${item.range}`}
                    />
                  ))}
                </Box>
              )}
            </FormControl>
          </Grid>

          {startOutsideAllowed && (
            <Grid item xs={12}>
              <Alert severity="info">
                Start {startTime} is outside allowed timing. Watering will begin when power hours start.
              </Alert>
            </Grid>
          )}

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Irrigation motor</InputLabel>
              <Select
                label="Irrigation motor"
                value={form.motor_device_ids[0] != null ? String(form.motor_device_ids[0]) : ''}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  motor_device_ids: e.target.value ? [Number(e.target.value)] : [],
                }))}
                disabled={motors.length === 0}
              >
                {motors.length !== 1 && (
                  <MenuItem value="">None</MenuItem>
                )}
                {motors.map((m) => (
                  <MenuItem key={m.id} value={String(m.id)}>
                    {m.name}{m.device_code ? ` · ${m.device_code}` : ''}
                  </MenuItem>
                ))}
              </Select>
              {motors.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Add an irrigation motor under Devices first.
                </Typography>
              )}
            </FormControl>
          </Grid>

          <Grid item xs={12}>
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

            {form.steps.map((step, idx) => {
              const zone = (zones || []).find((z) => String(z.id) === String(step.zone_id));
              const est = estimateMinutesFromLiters(step.target_liters, zone?.flow_rate_lph);
              return (
                <Grid
                  container
                  spacing={1}
                  alignItems="center"
                  key={idx}
                  sx={{ mb: 1 }}
                >
                  <Grid item xs={2} sm={1}>
                    <Typography variant="body2" color="text.secondary" fontWeight={700}>
                      {idx + 1}
                    </Typography>
                  </Grid>
                  <Grid item xs={10} sm={5}>
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
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <TextField
                      fullWidth
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
                    />
                  </Grid>
                  <Grid item xs={4} sm={2}>
                    <Typography variant="body2" color="text.secondary">
                      {est != null ? `~${formatEstimatedDuration(est)}` : '—'}
                    </Typography>
                  </Grid>
                  <Grid item xs={2} sm={1} sx={{ textAlign: 'right' }}>
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
                  </Grid>
                </Grid>
              );
            })}

            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setForm((f) => ({
                ...f,
                steps: [...f.steps, emptyStep(f.steps.length)],
              }))}
            >
              Add zone
            </Button>
          </Grid>

          {programType === 'fertigation' && injectors.length > 0 && (
            <Grid item xs={12} sm={6}>
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
            </Grid>
          )}
        </Grid>
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
