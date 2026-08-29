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
  FormHelperText,
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
  formatClockDisplay,
  formatEstimatedDuration,
  formatTimeInput,
  suggestStartsFromAllowedWindows,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

function emptyStep(seq = 0) {
  return { zone_id: '', target_liters: '', on_duration_minutes: '', seq, is_active: true };
}

function stepHasZoneAndLiters(step) {
  return Boolean(step?.zone_id) && Number(step?.target_liters) > 0;
}

function stepHasZoneAndDuration(step) {
  return Boolean(step?.zone_id) && Number(step?.on_duration_minutes) > 0;
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function groupAllowedRanges(windows, daysOfWeek) {
  const { slots } = suggestStartsFromAllowedWindows(windows, daysOfWeek);
  const byRange = new Map();

  slots.forEach((slot) => {
    const start = formatClockDisplay(slot.start) || slot.start;
    const end = formatClockDisplay(slot.end) || slot.end;
    const key = `${start} – ${end}`;
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

const fieldsetSx = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  px: 2,
  pt: 0.5,
  pb: 2,
  m: 0,
  minWidth: 0,
};

const legendSx = {
  px: 0.5,
  typography: 'caption',
  fontWeight: 700,
  color: 'text.secondary',
};

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
  const [submitted, setSubmitted] = useState(false);
  const isFertigation = programType === 'fertigation';

  const startTime = formatTimeInput(form.start_times?.[0]) || '';
  const hasCompleteStep = (form.steps || []).some(
    isFertigation ? stepHasZoneAndDuration : stepHasZoneAndLiters,
  );

  const totalMinutes = useMemo(
    () => estimateProgramMinutes(form.steps, zones),
    [form.steps, zones],
  );

  const allowedRanges = useMemo(
    () => groupAllowedRanges(windows, form.days_of_week),
    [windows, form.days_of_week],
  );

  const startOutsideAllowed = useMemo(() => {
    if (!startTime) return false;
    const { slots } = suggestStartsFromAllowedWindows(windows, form.days_of_week);
    if (!slots.length) return false;
    const now = minutesOf(startTime);
    return !slots.some((s) => now >= minutesOf(s.start) && now < minutesOf(s.end));
  }, [windows, form.days_of_week, startTime]);

  useEffect(() => {
    if (open) {
      setError(null);
      setSubmitted(false);
    }
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

  useEffect(() => {
    if (!open || editing || !isFertigation) return;
    if ((form.injector_ids || []).length) return;
    if (injectors.length !== 1) return;
    setForm((f) => {
      if ((f.injector_ids || []).length) return f;
      return { ...f, injector_ids: [injectors[0].id] };
    });
  }, [open, editing, isFertigation, injectors, form.injector_ids, setForm]);

  const applyDays = (days_of_week) => {
    setForm((prev) => ({
      ...prev,
      days_of_week,
      start_times: [defaultStartFromWindows(windows, days_of_week)],
      use_allowed_windows: true,
    }));
  };

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
    setSubmitted(true);
    if (!form.name.trim()) {
      setError('Enter a program name.');
      return;
    }
    if (!form.days_of_week.length) {
      setError('Pick at least one day.');
      return;
    }
    if (!startTime) {
      setError('Enter a start time.');
      return;
    }
    if (!(form.motor_device_ids || []).length) {
      setError('Select an irrigation motor.');
      return;
    }
    if (isFertigation && !(form.injector_ids || []).length) {
      setError('Select a fertigation injector.');
      return;
    }
    if (!hasCompleteStep) {
      setError(isFertigation
        ? 'Add at least one zone and how many minutes to run.'
        : 'Add at least one zone and how many liters to water.');
      return;
    }
    setError(null);
    onSave();
  };

  const title = editing
    ? `Edit ${isFertigation ? 'fertigation' : 'water'} program`
    : `New ${isFertigation ? 'fertigation' : 'water'} program`;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ pb: 0.5 }}>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {isFertigation
            ? 'Selected equipment terminals (motor, injector, zone valve) start and stop together. Next zone starts when that time is over.'
            : 'Each zone waters until the liters are done, then the next zone starts. Only runs during power hours.'}
        </Typography>

        {error && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Grid container spacing={2.5}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              required
              label="Name"
              placeholder={isFertigation ? 'e.g. Morning fertigation' : 'e.g. Morning watering'}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              error={submitted && !form.name.trim()}
              helperText={submitted && !form.name.trim() ? 'Required' : undefined}
              autoFocus
            />
          </Grid>

          <Grid item xs={12}>
            <FormControl component="fieldset" variant="standard" fullWidth sx={fieldsetSx}>
              <FormLabel component="legend" sx={legendSx}>When</FormLabel>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
                <Button size="small" onClick={() => applyDays([1, 2, 3, 4, 5, 6])}>Mon–Sat</Button>
                <Button size="small" onClick={() => applyDays([1, 2, 3, 4])}>Mon–Thu</Button>
                <Button size="small" onClick={() => applyDays([0, 1, 2, 3, 4, 5, 6])}>Every day</Button>
              </Box>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
                {WEEKDAY_LABELS.map((label, day) => {
                  const selected = form.days_of_week.includes(day);
                  return (
                    <Button
                      key={label}
                      size="small"
                      variant={selected ? 'contained' : 'outlined'}
                      color={submitted && !form.days_of_week.length ? 'error' : 'primary'}
                      onClick={() => toggleDay(day)}
                      sx={{ minWidth: 48, px: 1 }}
                    >
                      {label}
                    </Button>
                  );
                })}
              </Box>
              {submitted && !form.days_of_week.length && (
                <Typography variant="caption" color="error" display="block" sx={{ mb: 1 }}>
                  Select at least one day.
                </Typography>
              )}

              <Grid container spacing={2} alignItems="flex-start">
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    required
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
                    error={submitted && !startTime}
                    helperText={submitted && !startTime ? 'Required' : undefined}
                  />
                </Grid>
                <Grid item xs={12} sm={8}>
                  <FormControl component="fieldset" variant="standard" fullWidth sx={{ ...fieldsetSx, pb: 1.25 }}>
                    <FormLabel component="legend" sx={legendSx}>Allowed timing</FormLabel>
                    {allowedRanges.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No power hours for these days. Set them under Allowed hours.
                      </Typography>
                    ) : (
                      allowedRanges.map((item) => (
                        <Typography key={item.range} variant="body2">
                          {item.days}: {item.range}
                        </Typography>
                      ))
                    )}
                  </FormControl>
                </Grid>
              </Grid>
            </FormControl>
          </Grid>

          {startOutsideAllowed && (
            <Grid item xs={12}>
              <Alert severity="info">
                {formatClockDisplay(startTime)} is outside power hours. It will wait until power is on.
              </Alert>
            </Grid>
          )}

          <Grid item xs={12}>
            <FormControl component="fieldset" variant="standard" fullWidth sx={fieldsetSx}>
              <FormLabel component="legend" sx={legendSx}>Equipment</FormLabel>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={isFertigation ? 6 : 12}>
                  <FormControl
                    fullWidth
                    required
                    error={submitted && !(form.motor_device_ids || []).length}
                    disabled={motors.length === 0}
                  >
                    <InputLabel>Irrigation motor</InputLabel>
                    <Select
                      label="Irrigation motor"
                      value={form.motor_device_ids[0] != null ? String(form.motor_device_ids[0]) : ''}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        motor_device_ids: e.target.value ? [Number(e.target.value)] : [],
                      }))}
                    >
                      {motors.map((m) => (
                        <MenuItem key={m.id} value={String(m.id)}>
                          {m.name}{m.device_code ? ` (${m.device_code})` : ''}
                        </MenuItem>
                      ))}
                    </Select>
                    {motors.length === 0 && (
                      <FormHelperText>Add a motor under Devices first.</FormHelperText>
                    )}
                    {submitted && motors.length > 0 && !(form.motor_device_ids || []).length && (
                      <FormHelperText>Required</FormHelperText>
                    )}
                  </FormControl>
                </Grid>
                {isFertigation && (
                  <Grid item xs={12} sm={6}>
                    <FormControl
                      fullWidth
                      required
                      error={submitted && !(form.injector_ids || []).length}
                      disabled={injectors.length === 0}
                    >
                      <InputLabel>Injector</InputLabel>
                      <Select
                        label="Injector"
                        value={form.injector_ids[0] != null ? String(form.injector_ids[0]) : ''}
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          injector_ids: e.target.value ? [Number(e.target.value)] : [],
                        }))}
                      >
                        {injectors.map((m) => (
                          <MenuItem key={m.id} value={String(m.id)}>
                            {m.name}{m.device_code ? ` (${m.device_code})` : ''}
                          </MenuItem>
                        ))}
                      </Select>
                      {injectors.length === 0 && (
                        <FormHelperText>Add an injector under Devices first.</FormHelperText>
                      )}
                      {submitted && injectors.length > 0 && !(form.injector_ids || []).length && (
                        <FormHelperText>Required</FormHelperText>
                      )}
                    </FormControl>
                  </Grid>
                )}
              </Grid>
            </FormControl>
          </Grid>

          <Grid item xs={12}>
            <FormControl component="fieldset" variant="standard" fullWidth sx={fieldsetSx}>
              <FormLabel component="legend" sx={legendSx}>
                Zones
              </FormLabel>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1.5, gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {isFertigation
                    ? 'One after another. Minutes are how long the selected terminals stay on together.'
                    : 'One after another. Enter liters for each zone.'}
                </Typography>
                {totalMinutes > 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    About {formatEstimatedDuration(totalMinutes)} total
                  </Typography>
                )}
              </Box>

              {form.steps.map((step, idx) => {
                const zone = (zones || []).find((z) => String(z.id) === String(step.zone_id));
                const est = estimateMinutesFromLiters(step.target_liters, zone?.flow_rate_lph);
                const showStepError = submitted && !hasCompleteStep;
                return (
                  <Grid container spacing={1.5} alignItems="flex-start" key={idx} sx={{ mb: 1.5 }}>
                    <Grid item xs={12} sm={isFertigation ? 7 : 6}>
                      <FormControl fullWidth required error={showStepError && !step.zone_id}>
                        <InputLabel>Zone {idx + 1}</InputLabel>
                        <Select
                          label={`Zone ${idx + 1}`}
                          value={step.zone_id}
                          onChange={(e) => {
                            const zone_id = e.target.value;
                            if (isFertigation) {
                              updateStep(idx, { zone_id });
                              return;
                            }
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
                        {showStepError && !step.zone_id && <FormHelperText>Pick a zone</FormHelperText>}
                      </FormControl>
                    </Grid>
                    {isFertigation ? (
                      <Grid item xs={8} sm={4}>
                        <TextField
                          fullWidth
                          required
                          label="Minutes"
                          type="number"
                          value={step.on_duration_minutes}
                          error={showStepError && !(Number(step.on_duration_minutes) > 0)}
                          helperText={showStepError && !(Number(step.on_duration_minutes) > 0)
                            ? 'Required'
                            : undefined}
                          inputProps={{ min: 1, step: 1 }}
                          onChange={(e) => updateStep(idx, {
                            on_duration_minutes: e.target.value,
                            target_liters: '',
                          })}
                        />
                      </Grid>
                    ) : (
                      <Grid item xs={8} sm={5}>
                        <TextField
                          fullWidth
                          required
                          label="Liters"
                          type="number"
                          value={step.target_liters}
                          error={showStepError && !(Number(step.target_liters) > 0)}
                          helperText={showStepError && !(Number(step.target_liters) > 0)
                            ? 'Required'
                            : (est != null ? `About ${formatEstimatedDuration(est)}` : undefined)}
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
                    )}
                    <Grid item xs={4} sm={1} sx={{ pt: { sm: 1 } }}>
                      <IconButton
                        size="small"
                        aria-label="Remove zone"
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
                Add another zone
              </Button>
            </FormControl>
          </Grid>
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
