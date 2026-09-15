import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Checkbox,
  FormControl,
  FormControlLabel,
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
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { supabase } from '../../supabaseClient';
import {
  estimateLitersFromMinutes,
  estimateMinutesFromLiters,
  estimateProgramMinutes,
  findProgramScheduleConflicts,
  formatEstimatedDuration,
  formatTimeInput,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

function emptyStep(seq = 0) {
  return {
    zone_id: '',
    target_liters: '',
    on_duration_minutes: '',
    mode: 'duration',
    seq,
    is_active: true,
  };
}

function stepHasTarget(step) {
  return Boolean(step?.zone_id) && (Number(step?.target_liters) > 0 || Number(step?.on_duration_minutes) > 0);
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
  farmId,
  zones,
  motors,
  injectors,
  fertilizerProducts = [],
  allPrograms = [],
  programType,
  saving,
  onSave,
}) {
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [activeFarmPrograms, setActiveFarmPrograms] = useState(allPrograms || []);
  const isFertigation = programType === 'fertigation';

  // Keep in sync with prop updates
  useEffect(() => {
    setActiveFarmPrograms(allPrograms || []);
  }, [allPrograms]);

  // When dialog opens, immediately query fresh programs from database so any recent edits in other panels are reflected
  useEffect(() => {
    if (!open || !farmId) return;
    let isMounted = true;
    supabase
      .from('irrigation_programs')
      .select('*, irrigation_program_steps(*), irrigation_program_devices(*)')
      .eq('farm_id', farmId)
      .eq('is_active', true)
      .then(({ data, error: fetchErr }) => {
        if (isMounted && data && !fetchErr) {
          setActiveFarmPrograms(data);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [open, farmId]);

  const startTimes = (form.start_times || []).filter(Boolean);
  const hasCompleteStep = (form.steps || []).some(stepHasTarget);

  const totalMinutes = useMemo(
    () => estimateProgramMinutes(form.steps, zones, form),
    [form, zones],
  );

  // Schedule collision and overlap detection
  const conflicts = useMemo(() => {
    return findProgramScheduleConflicts({
      program: form,
      allPrograms: activeFarmPrograms,
      zones,
      editingProgramId: editing?.id,
    });
  }, [form, activeFarmPrograms, zones, editing?.id]);

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
      };
    });
  };

  const addStartTime = () => {
    const current = (form.start_times || []).filter(Boolean);
    const last = current[current.length - 1] || '06:00';
    const [h, m] = last.split(':').map(Number);
    const nextH = (h + 4) % 24;
    const nextTime = `${String(nextH).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
    setForm((f) => ({
      ...f,
      start_times: [...current, nextTime],
    }));
  };

  const updateStartTime = (idx, value) => {
    setForm((f) => {
      const times = [...(f.start_times || [])];
      times[idx] = value;
      return { ...f, start_times: times };
    });
  };

  const removeStartTime = (idx) => {
    setForm((f) => {
      const times = (f.start_times || []).filter((_, i) => i !== idx);
      return { ...f, start_times: times.length ? times : ['06:00'] };
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
    if (!startTimes.length) {
      setError('At least one start time is required.');
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
      setError('Add at least one zone with run time or target liters.');
      return;
    }
    if (conflicts.length > 0) {
      setError('Cannot save program: schedule conflicts with an existing active program. Please resolve overlapping start times or days.');
      return;
    }
    setError(null);
    onSave();
  };

  const title = editing
    ? `Edit ${isFertigation ? 'fertigation' : 'water'} program`
    : `New ${isFertigation ? 'fertigation' : 'water'} program`;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth={isFertigation ? 'md' : 'sm'} scroll="paper">
      <DialogTitle sx={{ pb: 0.5 }}>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {isFertigation
            ? '3-phase fertigation cycle: clean water pre-wetting, chemical injection, and line post-flushing across sequential zones. Programs cannot overlap with other schedules.'
            : 'Sequential zone irrigation. Choose duration or target volume per zone. Programs cannot overlap with other schedules on the same days.'}
        </Typography>

        {conflicts.length > 0 && (
          <Alert severity="error" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={800} gutterBottom>
              Schedule Conflict (Overlapping Program Detected)
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Only one program can operate the irrigation pump at a time. The proposed schedule collides with existing active programs:
            </Typography>
            {conflicts.map((c) => (
              <Typography key={c.key} variant="body2" sx={{ fontWeight: 600, pl: 1 }}>
                • {c.message}
              </Typography>
            ))}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Please change the start time, days of week, or step durations to clear the overlap before saving.
            </Typography>
          </Alert>
        )}

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

              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                Start Times (Pulse Irrigation Supported)
              </Typography>

              <Grid container spacing={1.5} alignItems="center">
                {(form.start_times || ['06:00']).map((timeVal, sIdx) => (
                  <Grid item xs={12} sm={4} key={sIdx} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <TextField
                      fullWidth
                      required
                      type="time"
                      label={`Start time ${sIdx + 1}`}
                      value={formatTimeInput(timeVal)}
                      onChange={(e) => updateStartTime(sIdx, e.target.value)}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{ step: 300 }}
                      error={submitted && !timeVal}
                    />
                    {(form.start_times || []).length > 1 && (
                      <IconButton size="small" aria-label="Remove start time" onClick={() => removeStartTime(sIdx)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Grid>
                ))}
                <Grid item xs={12}>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={addStartTime}
                    sx={{ textTransform: 'none' }}
                  >
                    Add another daily start time (pulse)
                  </Button>
                </Grid>
              </Grid>
            </FormControl>
          </Grid>

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

          {isFertigation && (
            <Grid item xs={12}>
              <FormControl component="fieldset" variant="standard" fullWidth sx={fieldsetSx}>
                <FormLabel component="legend" sx={legendSx}>3-Phase Fertigation Cycle (Pre & Post Flush)</FormLabel>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                  Pre-wetting pressurizes lines with clean water before chemical injection. Post-flush rinses chemical residue out of drippers to prevent emitter clogging.
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Pre-watering / Line Wetting (min)"
                      type="number"
                      value={form.pre_flush_minutes != null ? form.pre_flush_minutes : 10}
                      inputProps={{ min: 0, step: 1 }}
                      onChange={(e) => setForm((f) => ({ ...f, pre_flush_minutes: e.target.value }))}
                      helperText="Pure water before injector turns on (default 10 min)"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Post-rinse / Emitter Flush (min)"
                      type="number"
                      value={form.post_flush_minutes != null ? form.post_flush_minutes : 10}
                      inputProps={{ min: 0, step: 1 }}
                      onChange={(e) => setForm((f) => ({ ...f, post_flush_minutes: e.target.value }))}
                      helperText="Pure water after injector turns off (default 10 min)"
                    />
                  </Grid>
                </Grid>
              </FormControl>
            </Grid>
          )}

          {!isFertigation && (
            <Grid item xs={12}>
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={Boolean(form.skip_if_rain)}
                    onChange={(e) => setForm((f) => ({ ...f, skip_if_rain: e.target.checked }))}
                  />
                )}
                label="Skip start if rain detected in Climate"
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -0.5 }}>
                When checked, this program will not start if rainfall is above 0 mm. Water now still runs.
              </Typography>
            </Grid>
          )}

          <Grid item xs={12}>
            <FormControl component="fieldset" variant="standard" fullWidth sx={fieldsetSx}>
              <FormLabel component="legend" sx={legendSx}>Zones</FormLabel>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1.5, gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  One after another. Choose duration or target liters per zone.
                </Typography>
                {totalMinutes > 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                    About {formatEstimatedDuration(totalMinutes)} total run
                  </Typography>
                )}
              </Box>

              {form.steps.map((step, idx) => {
                const zone = (zones || []).find((z) => String(z.id) === String(step.zone_id));
                const estFromLiters = estimateMinutesFromLiters(step.target_liters, zone?.flow_rate_lph);
                const estFromMinutes = estimateLitersFromMinutes(step.on_duration_minutes, zone?.flow_rate_lph);
                const showStepError = submitted && !hasCompleteStep;
                const isDurationMode = step.mode === 'duration'
                  || (Number(step.on_duration_minutes) > 0 && !(Number(step.target_liters) > 0));

                return (
                  <Grid container spacing={1.5} alignItems="center" key={idx} sx={{ mb: 1.5 }}>
                    <Grid item xs={12} sm={4}>
                      <FormControl fullWidth required error={showStepError && !step.zone_id}>
                        <InputLabel>Zone {idx + 1}</InputLabel>
                        <Select
                          label={`Zone ${idx + 1}`}
                          value={step.zone_id}
                          onChange={(e) => {
                            const zone_id = e.target.value;
                            updateStep(idx, { zone_id });
                          }}
                        >
                          {(zones || []).map((z) => (
                            <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>
                          ))}
                        </Select>
                        {showStepError && !step.zone_id && <FormHelperText>Pick a zone</FormHelperText>}
                      </FormControl>
                    </Grid>

                    <Grid item xs={5} sm={2.5}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Target By</InputLabel>
                        <Select
                          label="Target By"
                          value={isDurationMode ? 'duration' : 'volume'}
                          onChange={(e) => {
                            const nextMode = e.target.value;
                            if (nextMode === 'duration') {
                              updateStep(idx, {
                                mode: 'duration',
                                on_duration_minutes: step.on_duration_minutes || '30',
                                target_liters: '',
                              });
                            } else {
                              updateStep(idx, {
                                mode: 'volume',
                                target_liters: step.target_liters || '5000',
                                on_duration_minutes: '',
                              });
                            }
                          }}
                        >
                          <MenuItem value="duration">Minutes (Time)</MenuItem>
                          <MenuItem value="volume">Liters (Volume)</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>

                    <Grid item xs={5} sm={4.5}>
                      {isDurationMode ? (
                        <TextField
                          fullWidth
                          required
                          label={isFertigation ? "Injection Minutes" : "Run Minutes"}
                          type="number"
                          value={step.on_duration_minutes}
                          error={showStepError && !(Number(step.on_duration_minutes) > 0)}
                          helperText={estFromMinutes != null ? `~${estFromMinutes} L at ${zone?.flow_rate_lph} L/h` : 'Required'}
                          inputProps={{ min: 1, step: 1 }}
                          onChange={(e) => updateStep(idx, {
                            on_duration_minutes: e.target.value,
                            target_liters: '',
                          })}
                        />
                      ) : (
                        <TextField
                          fullWidth
                          required
                          label="Target Liters"
                          type="number"
                          value={step.target_liters}
                          error={showStepError && !(Number(step.target_liters) > 0)}
                          helperText={estFromLiters != null ? `~${formatEstimatedDuration(estFromLiters)} at ${zone?.flow_rate_lph} L/h` : 'Required'}
                          onChange={(e) => updateStep(idx, {
                            target_liters: e.target.value,
                            on_duration_minutes: '',
                          })}
                        />
                      )}
                    </Grid>

                    <Grid item xs={2} sm={1}>
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

          {isFertigation && (
            <Grid item xs={12}>
              <FormControl component="fieldset" variant="standard" fullWidth sx={fieldsetSx}>
                <FormLabel component="legend" sx={legendSx}>Fertilizer Products Recipe</FormLabel>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                  Total fertilizer mix for this program. Applied and deducted from inventory across completed zones.
                </Typography>
                {(form.products || []).map((line, idx) => {
                  const product = fertilizerProducts.find((p) => String(p.id) === String(line.product_id));
                  const stock = product?.inventory?.[0]?.current_stock ?? product?.current_stock ?? null;
                  const isDeficit = !product?.is_inhouse && stock != null && Number(line.quantity) > Number(stock);

                  return (
                    <Grid container spacing={1.5} alignItems="flex-start" key={idx} sx={{ mb: 1.5 }}>
                      <Grid item xs={12} sm={7}>
                        <FormControl fullWidth>
                          <InputLabel>Product</InputLabel>
                          <Select
                            label="Product"
                            value={line.product_id}
                            onChange={(e) => {
                              const product_id = e.target.value;
                              const pMatch = fertilizerProducts.find((p) => String(p.id) === String(product_id));
                              setForm((f) => {
                                const products = [...(f.products || [])];
                                products[idx] = {
                                  ...products[idx],
                                  product_id,
                                  unit: pMatch?.unit || products[idx].unit || 'kg',
                                };
                                return { ...f, products };
                              });
                            }}
                          >
                            <MenuItem value="">None</MenuItem>
                            {fertilizerProducts.map((p) => {
                              const s = p.inventory?.[0]?.current_stock ?? p.current_stock ?? null;
                              const tag = p.is_inhouse
                                ? ` — In-house (₹${p.default_unit_cost || 0}/${p.unit || 'L'})`
                                : (s != null ? ` — ${s} in stock` : '');
                              return (
                                <MenuItem key={p.id} value={String(p.id)}>
                                  {p.name}{p.unit ? ` (${p.unit})` : ''}{tag}
                                </MenuItem>
                              );
                            })}
                          </Select>
                          {product?.is_inhouse ? (
                            <FormHelperText sx={{ color: 'success.main', fontWeight: 600 }}>
                              🌿 In-house formulation · Direct rate: ₹{product.default_unit_cost || 0}/{product.unit} (No inventory purchase required)
                            </FormHelperText>
                          ) : (
                            stock != null && (
                              <FormHelperText sx={{ color: isDeficit ? 'error.main' : 'text.secondary' }}>
                                {isDeficit
                                  ? `⚠️ Exceeds stock! Only ${stock} ${product?.unit || ''} available`
                                  : `Available stock: ${stock} ${product?.unit || ''}`}
                              </FormHelperText>
                            )
                          )}
                        </FormControl>
                      </Grid>
                      <Grid item xs={8} sm={4}>
                        <TextField
                          fullWidth
                          label="Quantity"
                          type="number"
                          value={line.quantity}
                          error={isDeficit}
                          inputProps={{ min: 0, step: 'any' }}
                          onChange={(e) => {
                            setForm((f) => {
                              const products = [...(f.products || [])];
                              products[idx] = { ...products[idx], quantity: e.target.value };
                              return { ...f, products };
                            });
                          }}
                        />
                      </Grid>
                      <Grid item xs={4} sm={1} sx={{ pt: { sm: 1 } }}>
                        <IconButton
                          size="small"
                          aria-label="Remove product"
                          disabled={(form.products || []).length <= 1}
                          onClick={() => setForm((f) => ({
                            ...f,
                            products: (f.products || []).filter((_, i) => i !== idx),
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
                    products: [...(f.products || []), { product_id: '', quantity: '', unit: 'kg' }],
                  }))}
                >
                  Add product
                </Button>
              </FormControl>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          color={conflicts.length > 0 ? "error" : "primary"}
          disabled={saving || conflicts.length > 0}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : (editing ? 'Save' : 'Create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export { emptyStep };
