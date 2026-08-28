import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ChecklistIcon from '@mui/icons-material/Checklist';
import {
  defaultStartFromWindows,
  estimateMinutesFromLiters,
  estimateProgramMinutes,
  formatEstimatedDuration,
  programDaysLabel,
  suggestStartsFromAllowedWindows,
  timeToInputValue,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

const STEPS = ['When to run', 'Zones & volume', 'Review'];

function emptyStep(seq = 0) {
  return { zone_id: '', target_liters: '', on_duration_minutes: '', seq, is_active: true };
}

function SectionLabel({ icon, title, hint }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {icon}
        <Typography variant="subtitle1" fontWeight={800}>{title}</Typography>
      </Box>
      {hint && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
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
  const [activeStep, setActiveStep] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stepError, setStepError] = useState(null);

  const suggested = useMemo(
    () => suggestStartsFromAllowedWindows(windows, form.days_of_week),
    [windows, form.days_of_week],
  );

  const totalMinutes = useMemo(
    () => estimateProgramMinutes(form.steps, zones),
    [form.steps, zones],
  );

  const filledSteps = (form.steps || []).filter((s) => s.zone_id && s.target_liters);

  useEffect(() => {
    if (open) {
      setActiveStep(0);
      setStepError(null);
      setShowAdvanced(false);
    }
  }, [open, editing?.id]);

  const toggleDay = (day) => {
    setForm((prev) => {
      const has = prev.days_of_week.includes(day);
      const days_of_week = has
        ? prev.days_of_week.filter((d) => d !== day)
        : [...prev.days_of_week, day].sort((a, b) => a - b);
      const start = defaultStartFromWindows(windows, days_of_week);
      const keepStart = prev.start_times[0]
        && suggestStartsFromAllowedWindows(windows, days_of_week).starts.includes(prev.start_times[0]);
      return {
        ...prev,
        days_of_week,
        start_times: keepStart ? prev.start_times : [start],
      };
    });
  };

  const setDaysPreset = (days) => {
    const start = defaultStartFromWindows(windows, days);
    setForm((prev) => ({
      ...prev,
      days_of_week: days,
      start_times: [start],
    }));
  };

  const updateStep = (idx, patch) => {
    setForm((f) => {
      const steps = [...f.steps];
      steps[idx] = { ...steps[idx], ...patch };
      return { ...f, steps };
    });
  };

  const moveStep = (idx, direction) => {
    setForm((f) => {
      const next = idx + direction;
      if (next < 0 || next >= f.steps.length) return f;
      const steps = [...f.steps];
      [steps[idx], steps[next]] = [steps[next], steps[idx]];
      return { ...f, steps };
    });
  };

  const validateStep = (step) => {
    if (step === 0) {
      if (!form.name.trim()) return 'Give this program a name.';
      if (!form.days_of_week.length) return 'Pick at least one day.';
      if (!form.start_times[0]) return 'Pick a start time (use an MSEB slot if available).';
      return null;
    }
    if (step === 1) {
      if (!filledSteps.length) return 'Add at least one zone with target liters.';
      const incomplete = form.steps.some((s) => s.zone_id && !s.target_liters);
      if (incomplete) return 'Each selected zone needs a target in liters.';
      const noZone = form.steps.some((s) => s.target_liters && !s.zone_id);
      if (noZone) return 'Choose a zone for each step that has liters.';
      return null;
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(activeStep);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setActiveStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setStepError(null);
    setActiveStep((s) => Math.max(s - 1, 0));
  };

  const handleSave = () => {
    const err0 = validateStep(0);
    const err1 = validateStep(1);
    if (err0 || err1) {
      setStepError(err0 || err1);
      setActiveStep(err0 ? 0 : 1);
      return;
    }
    setStepError(null);
    onSave();
  };

  const title = editing
    ? `Edit ${programType === 'fertigation' ? 'fertigation' : 'water'} program`
    : `New ${programType === 'fertigation' ? 'fertigation' : 'water'} program`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" fontWeight={800}>{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          Zones run one after another. Other programs wait until this one finishes.
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {stepError && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setStepError(null)}>
            {stepError}
          </Alert>
        )}

        {activeStep === 0 && (
          <Box>
            <SectionLabel
              icon={<ScheduleIcon color="primary" fontSize="small" />}
              title="Schedule"
              hint="Choose which days and when this program may start during MSEB power."
            />

            <TextField
              fullWidth
              label="Program name"
              placeholder={programType === 'fertigation' ? 'e.g. Fertigation A' : 'e.g. Morning drip — Block A'}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              sx={{ mb: 2 }}
              autoFocus
            />

            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Days
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
              <Chip
                size="small"
                label="Mon–Thu"
                clickable
                onClick={() => setDaysPreset([1, 2, 3, 4])}
              />
              <Chip
                size="small"
                label="Weekdays"
                clickable
                onClick={() => setDaysPreset([1, 2, 3, 4, 5])}
              />
              <Chip
                size="small"
                label="All week"
                clickable
                onClick={() => setDaysPreset([0, 1, 2, 3, 4, 5, 6])}
              />
            </Stack>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2.5 }}>
              {WEEKDAY_LABELS.map((label, day) => {
                const selected = form.days_of_week.includes(day);
                return (
                  <Chip
                    key={label}
                    label={label}
                    clickable
                    color={selected ? 'primary' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    onClick={() => toggleDay(day)}
                    sx={{ fontWeight: selected ? 700 : 500, minWidth: 48 }}
                  />
                );
              })}
            </Box>

            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Start time
            </Typography>
            {suggested.starts.length > 0 ? (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Suggested from your MSEB allowed hours
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                  {suggested.starts.map((start) => {
                    const selected = form.start_times[0] === start;
                    return (
                      <Chip
                        key={start}
                        label={start}
                        clickable
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={() => setForm((f) => ({ ...f, start_times: [start] }))}
                        sx={{ fontWeight: 700, fontSize: '0.95rem', height: 36, px: 0.5 }}
                      />
                    );
                  })}
                </Box>
                {suggested.slots.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 1.25, mb: 2, bgcolor: (t) => alpha(t.palette.info.main, 0.04) }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" sx={{ mb: 0.5 }}>
                      Power windows on selected days
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {suggested.slots.map((slot) => (
                        <Chip key={slot.label} size="small" variant="outlined" label={slot.label} />
                      ))}
                    </Box>
                  </Paper>
                )}
              </>
            ) : (
              <Alert severity="info" sx={{ mb: 2 }}>
                No MSEB allowed hours yet. Set them under the Allowed hours tab, or pick a custom start below.
              </Alert>
            )}

            <TextField
              type="time"
              label="Or custom start"
              value={timeToInputValue(form.start_times[0] || '06:00')}
              onChange={(e) => setForm((f) => ({ ...f, start_times: [e.target.value] }))}
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 300 }}
              sx={{ mb: 2, maxWidth: 200 }}
            />

            <FormControlLabel
              control={(
                <Switch
                  checked={form.use_allowed_windows}
                  onChange={(e) => setForm((f) => ({ ...f, use_allowed_windows: e.target.checked }))}
                />
              )}
              label="Only water inside MSEB allowed hours"
            />
            <FormControlLabel
              sx={{ ml: 0, display: 'flex' }}
              control={(
                <Switch
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
              )}
              label="Program is active"
            />

            <Button size="small" onClick={() => setShowAdvanced((v) => !v)} sx={{ mt: 1 }}>
              {showAdvanced ? 'Hide advanced' : 'Advanced options'}
            </Button>
            <Collapse in={showAdvanced}>
              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Run order"
                    type="number"
                    value={form.run_order}
                    onChange={(e) => setForm((f) => ({ ...f, run_order: e.target.value }))}
                    helperText="Lower number runs before others"
                  />
                </Grid>
                {motors.length > 0 && (
                  <Grid item xs={12} sm={8}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Motors</InputLabel>
                      <Select
                        multiple
                        label="Motors"
                        value={form.motor_device_ids}
                        onChange={(e) => setForm((f) => ({ ...f, motor_device_ids: e.target.value }))}
                        renderValue={(selected) => selected
                          .map((id) => motors.find((m) => m.id === id)?.name || id)
                          .join(', ')}
                      >
                        {motors.map((m) => (
                          <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                )}
                {programType === 'fertigation' && (
                  <Grid item xs={12}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Fertigation injectors</InputLabel>
                      <Select
                        multiple
                        label="Fertigation injectors"
                        value={form.injector_ids}
                        onChange={(e) => setForm((f) => ({ ...f, injector_ids: e.target.value }))}
                        renderValue={(selected) => selected
                          .map((id) => injectors.find((m) => m.id === id)?.name || id)
                          .join(', ')}
                      >
                        {injectors.map((m) => (
                          <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                )}
              </Grid>
            </Collapse>
          </Box>
        )}

        {activeStep === 1 && (
          <Box>
            <SectionLabel
              icon={<WaterDropIcon color="info" fontSize="small" />}
              title="Zone sequence"
              hint="Add zones in the order they should water. The next zone starts only after this one reaches its liters."
            />

            <Stack spacing={1.5}>
              {form.steps.map((step, idx) => {
                const zone = (zones || []).find((z) => String(z.id) === String(step.zone_id));
                const est = estimateMinutesFromLiters(step.target_liters, zone?.flow_rate_lph);
                return (
                  <Box key={idx}>
                    {idx > 0 && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', textAlign: 'center', mb: 0.75, fontWeight: 700 }}
                      >
                        then
                      </Typography>
                    )}
                    <Paper
                      variant="outlined"
                      sx={(theme) => ({
                        p: 2,
                        borderWidth: 2,
                        borderColor: step.zone_id ? theme.palette.info.light : theme.palette.divider,
                        bgcolor: step.zone_id
                          ? alpha(theme.palette.info.main, 0.04)
                          : undefined,
                      })}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                        <Chip
                          size="small"
                          color="info"
                          label={`Zone ${idx + 1}`}
                          sx={{ fontWeight: 800 }}
                        />
                        <Box>
                          <IconButton size="small" disabled={idx === 0} onClick={() => moveStep(idx, -1)}>
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            disabled={idx === form.steps.length - 1}
                            onClick={() => moveStep(idx, 1)}
                          >
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={form.steps.length <= 1}
                            onClick={() => setForm((f) => ({
                              ...f,
                              steps: f.steps.filter((_, i) => i !== idx),
                            }))}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      </Box>

                      <Grid container spacing={2} alignItems="flex-start">
                        <Grid item xs={12} sm={5}>
                          <FormControl fullWidth>
                            <InputLabel>Drip zone</InputLabel>
                            <Select
                              label="Drip zone"
                              value={step.zone_id}
                              onChange={(e) => {
                                const zone_id = e.target.value;
                                const z = (zones || []).find((item) => String(item.id) === String(zone_id));
                                const computed = estimateMinutesFromLiters(step.target_liters, z?.flow_rate_lph);
                                updateStep(idx, {
                                  zone_id,
                                  on_duration_minutes: computed != null ? String(computed) : step.on_duration_minutes,
                                });
                              }}
                            >
                              {(zones || []).map((z) => (
                                <MenuItem key={z.id} value={String(z.id)}>
                                  {z.zone_code}
                                  {z.description ? ` — ${z.description}` : ''}
                                  {z.flow_rate_lph ? ` · ${z.flow_rate_lph} L/h` : ''}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={4}>
                          <TextField
                            fullWidth
                            label="Target liters"
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
                            placeholder="e.g. 6000"
                            helperText={zone?.flow_rate_lph ? `Flow ${zone.flow_rate_lph} L/h` : 'Set flow rate on the zone for estimates'}
                          />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                          <Paper
                            variant="outlined"
                            sx={{
                              p: 1.5,
                              height: '100%',
                              textAlign: 'center',
                              bgcolor: (t) => alpha(t.palette.success.main, 0.06),
                            }}
                          >
                            <Typography variant="caption" color="text.secondary" fontWeight={700}>
                              Estimated time
                            </Typography>
                            <Typography variant="h6" fontWeight={800}>
                              {formatEstimatedDuration(est) || '—'}
                            </Typography>
                          </Paper>
                        </Grid>
                      </Grid>
                    </Paper>
                  </Box>
                );
              })}
            </Stack>

            <Button
              fullWidth
              variant="outlined"
              startIcon={<AddIcon />}
              sx={{ mt: 2 }}
              onClick={() => setForm((f) => ({
                ...f,
                steps: [...f.steps, emptyStep(f.steps.length)],
              }))}
            >
              Add next zone
            </Button>

            {totalMinutes > 0 && (
              <Alert severity="success" sx={{ mt: 2 }}>
                This program needs about <strong>{formatEstimatedDuration(totalMinutes)}</strong> of watering
                ({filledSteps.length} zone{filledSteps.length === 1 ? '' : 's'}), split across MSEB power windows if needed.
              </Alert>
            )}
          </Box>
        )}

        {activeStep === 2 && (
          <Box>
            <SectionLabel
              icon={<ChecklistIcon color="success" fontSize="small" />}
              title="Review"
              hint="Confirm the plan, then save."
            />

            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="h5" fontWeight={800} gutterBottom>
                {form.name || 'Untitled program'}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                {programDaysLabel(form.days_of_week)}
                {' · starts '}
                {timeToInputValue(form.start_times[0])}
                {form.use_allowed_windows ? ' · MSEB hours only' : ''}
                {form.is_active ? '' : ' · inactive'}
              </Typography>

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" fontWeight={800} gutterBottom>
                Watering order
              </Typography>
              <Stack spacing={1}>
                {filledSteps.map((step, idx) => {
                  const zone = (zones || []).find((z) => String(z.id) === String(step.zone_id));
                  const est = estimateMinutesFromLiters(step.target_liters, zone?.flow_rate_lph);
                  return (
                    <Box
                      key={idx}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 2,
                        flexWrap: 'wrap',
                        py: 0.75,
                        borderBottom: idx < filledSteps.length - 1 ? '1px solid' : 'none',
                        borderColor: 'divider',
                      }}
                    >
                      <Typography fontWeight={700}>
                        {idx + 1}. {zone?.zone_code || 'Zone'}
                        {zone?.description ? ` — ${zone.description}` : ''}
                      </Typography>
                      <Typography color="text.secondary">
                        {step.target_liters} L
                        {est != null ? ` · ~${formatEstimatedDuration(est)}` : ''}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>

              {totalMinutes > 0 && (
                <Typography variant="body1" fontWeight={800} sx={{ mt: 2 }}>
                  Total estimate: {formatEstimatedDuration(totalMinutes)}
                </Typography>
              )}
            </Paper>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Box sx={{ flex: 1 }} />
        {activeStep > 0 && (
          <Button onClick={goBack} disabled={saving}>Back</Button>
        )}
        {activeStep < STEPS.length - 1 ? (
          <Button variant="contained" onClick={goNext}>
            Continue
          </Button>
        ) : (
          <Button variant="contained" color="primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : (editing ? 'Save changes' : 'Create program')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export { emptyStep };
