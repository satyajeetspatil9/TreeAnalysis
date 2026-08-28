import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { supabase } from '../../supabaseClient';
import {
  createAdHocVolumeJob,
  estimateMinutesFromLiters,
  isMissingScheduleTable,
  jobProgressLabel,
  programDaysLabel,
  programTimesLabel,
  scheduleTableHint,
  timeToInputValue,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

function emptyStep(seq = 0) {
  return { zone_id: '', target_liters: '', on_duration_minutes: '', seq, is_active: true };
}

function IrrigationProgramsPanel({
  farmId,
  zones,
  devices,
  programType = 'water',
  title = 'Programs',
}) {
  const [programs, setPrograms] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '',
    is_active: true,
    days_of_week: [1, 2, 3, 4],
    start_times: ['06:00'],
    use_allowed_windows: true,
    motor_device_ids: [],
    steps: [emptyStep(0)],
    injector_ids: [],
  });
  const [jobForm, setJobForm] = useState({ zone_id: '', target_liters: '6000' });

  const motors = (devices || []).filter((d) =>
    d.kind === 'irrigation_motor' || d.kind === 'bore_motor');
  const injectors = (devices || []).filter((d) => d.kind === 'fertigation');

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    const [{ data: progData, error: progError }, { data: jobData, error: jobError }] = await Promise.all([
      supabase
        .from('irrigation_programs')
        .select('*, irrigation_program_steps(*), irrigation_program_devices(*)')
        .eq('farm_id', farmId)
        .eq('program_type', programType)
        .order('name'),
      supabase
        .from('irrigation_jobs')
        .select('*')
        .eq('farm_id', farmId)
        .eq('job_type', programType === 'fertigation' ? 'fertigation' : 'water')
        .in('status', ['planned', 'running', 'paused_outside_window'])
        .order('created_at', { ascending: false }),
    ]);

    if (progError || jobError) {
      const err = progError || jobError;
      setMessage({
        type: isMissingScheduleTable(err) ? 'warning' : 'error',
        text: isMissingScheduleTable(err)
          ? 'Run migration 039_irrigation_schedule_control.sql in Supabase, then reload.'
          : scheduleTableHint(err.message),
      });
      setPrograms([]);
      setJobs([]);
    } else {
      setPrograms(progData || []);
      setJobs(jobData || []);
      setMessage(null);
    }
    setLoading(false);
  }, [farmId, programType]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: programType === 'fertigation' ? 'Fertigation 1' : 'Program 1',
      is_active: true,
      days_of_week: [1, 2, 3, 4],
      start_times: ['06:00'],
      use_allowed_windows: true,
      motor_device_ids: motors[0] ? [motors[0].id] : [],
      steps: [emptyStep(0)],
      injector_ids: [],
    });
    setDialogOpen(true);
  };

  const openEdit = (program) => {
    const steps = (program.irrigation_program_steps || [])
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({
        id: s.id,
        zone_id: s.zone_id || '',
        target_liters: s.target_liters ?? '',
        on_duration_minutes: s.on_duration_minutes ?? '',
        seq: s.seq,
        is_active: s.is_active !== false,
      }));
    setEditing(program);
    setForm({
      name: program.name,
      is_active: program.is_active,
      days_of_week: program.days_of_week || [],
      start_times: (program.start_times || []).map((t) => timeToInputValue(t)),
      use_allowed_windows: program.use_allowed_windows !== false,
      motor_device_ids: program.motor_device_ids || [],
      steps: steps.length ? steps : [emptyStep(0)],
      injector_ids: (program.irrigation_program_devices || []).map((d) => d.device_id),
    });
    setDialogOpen(true);
  };

  const toggleDay = (day) => {
    setForm((prev) => {
      const has = prev.days_of_week.includes(day);
      return {
        ...prev,
        days_of_week: has
          ? prev.days_of_week.filter((d) => d !== day)
          : [...prev.days_of_week, day].sort((a, b) => a - b),
      };
    });
  };

  const saveProgram = async () => {
    if (!farmId || !form.name.trim()) {
      setMessage({ type: 'error', text: 'Name is required.' });
      return;
    }
    setSaving(true);
    const payload = {
      farm_id: farmId,
      name: form.name.trim(),
      program_type: programType,
      is_active: form.is_active,
      days_of_week: form.days_of_week,
      start_times: form.start_times.filter(Boolean).map((t) => `${timeToInputValue(t)}:00`),
      use_allowed_windows: form.use_allowed_windows,
      motor_device_ids: form.motor_device_ids,
      updated_at: new Date().toISOString(),
    };

    let programId = editing?.id;
    if (editing) {
      const { error } = await supabase
        .from('irrigation_programs')
        .update(payload)
        .eq('id', editing.id);
      if (error) {
        setMessage({ type: 'error', text: scheduleTableHint(error.message) });
        setSaving(false);
        return;
      }
      await supabase.from('irrigation_program_steps').delete().eq('program_id', editing.id);
      await supabase.from('irrigation_program_devices').delete().eq('program_id', editing.id);
    } else {
      const { data, error } = await supabase
        .from('irrigation_programs')
        .insert({ ...payload, created_at: new Date().toISOString() })
        .select('id')
        .single();
      if (error) {
        setMessage({ type: 'error', text: scheduleTableHint(error.message) });
        setSaving(false);
        return;
      }
      programId = data.id;
    }

    const stepRows = form.steps
      .filter((s) => s.zone_id)
      .map((s, idx) => ({
        program_id: programId,
        seq: idx,
        zone_id: Number(s.zone_id),
        target_liters: s.target_liters === '' ? null : Number(s.target_liters),
        on_duration_minutes: s.on_duration_minutes === '' ? null : Number(s.on_duration_minutes),
        is_active: s.is_active !== false,
      }));

    if (stepRows.length) {
      const { error: stepError } = await supabase.from('irrigation_program_steps').insert(stepRows);
      if (stepError) {
        setMessage({ type: 'error', text: scheduleTableHint(stepError.message) });
        setSaving(false);
        return;
      }
    }

    if (programType === 'fertigation' && form.injector_ids.length) {
      const deviceRows = form.injector_ids.map((deviceId) => ({
        program_id: programId,
        device_id: deviceId,
        role: 'injector',
      }));
      const { error: deviceError } = await supabase
        .from('irrigation_program_devices')
        .insert(deviceRows);
      if (deviceError) {
        setMessage({ type: 'error', text: scheduleTableHint(deviceError.message) });
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setDialogOpen(false);
    setMessage({ type: 'success', text: editing ? 'Program updated.' : 'Program created.' });
    await load();
  };

  const deleteProgram = async (program) => {
    const { error } = await supabase.from('irrigation_programs').delete().eq('id', program.id);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    setMessage({ type: 'success', text: 'Program deleted.' });
    await load();
  };

  const toggleActive = async (program) => {
    const { error } = await supabase
      .from('irrigation_programs')
      .update({ is_active: !program.is_active, updated_at: new Date().toISOString() })
      .eq('id', program.id);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    await load();
  };

  const createQuickJob = async () => {
    if (!jobForm.zone_id || !jobForm.target_liters) {
      setMessage({ type: 'error', text: 'Pick a zone and target liters.' });
      return;
    }
    const { error } = await createAdHocVolumeJob({
      farmId,
      zoneId: Number(jobForm.zone_id),
      targetLiters: Number(jobForm.target_liters),
      jobType: programType === 'fertigation' ? 'fertigation' : 'water',
      windowMode: true,
      deviceIds: programType === 'fertigation' ? form.injector_ids : [],
    });
    if (error) {
      setMessage({
        type: isMissingScheduleTable(error) ? 'warning' : 'error',
        text: scheduleTableHint(error.message),
      });
      return;
    }
    setMessage({
      type: 'success',
      text: 'Volume job created. Scheduler will run it inside allowed hours.',
    });
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

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          {programType === 'fertigation'
            ? 'Fertigation runs water on the zone plus selected injectors. Stop when target liters are reached.'
            : 'Programs run sequenced zones by liters inside allowed hours (GrIno-style).'}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          New {programType === 'fertigation' ? 'fertigation' : 'program'}
        </Button>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Quick volume job
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Start a one-off target (e.g. 6000 L) without a recurring program. Runs only in allowed hours.
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Zone</InputLabel>
              <Select
                label="Zone"
                value={jobForm.zone_id}
                onChange={(e) => setJobForm((f) => ({ ...f, zone_id: e.target.value }))}
              >
                {(zones || []).map((z) => (
                  <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Target liters"
              type="number"
              value={jobForm.target_liters}
              onChange={(e) => setJobForm((f) => ({ ...f, target_liters: e.target.value }))}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <Button variant="outlined" startIcon={<PlayArrowIcon />} onClick={createQuickJob}>
              Create job
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {jobs.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Active jobs
          </Typography>
          <Grid container spacing={1.5}>
            {jobs.map((job) => {
              const zone = (zones || []).find((z) => z.id === job.zone_id);
              return (
                <Grid item xs={12} sm={6} key={job.id}>
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                      <Typography fontWeight={700}>
                        {zone?.zone_code || `Zone ${job.zone_id}`}
                      </Typography>
                      <Chip size="small" label={job.status} />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {jobProgressLabel(job)}
                      {zone?.flow_rate_lph
                        ? ` · ~${estimateMinutesFromLiters(job.target_liters, zone.flow_rate_lph) || '—'} min est.`
                        : ''}
                    </Typography>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}

      {programs.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No {title.toLowerCase()} yet.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {programs.map((program) => {
            const steps = (program.irrigation_program_steps || []).slice().sort((a, b) => a.seq - b.seq);
            return (
              <Grid item xs={12} md={6} key={program.id}>
                <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Box>
                      <Typography variant="h6" fontWeight={800}>{program.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {programDaysLabel(program.days_of_week)}
                        {' · '}
                        {program.use_allowed_windows
                          ? `Allowed windows${program.start_times?.length ? ` @ ${programTimesLabel(program.start_times)}` : ''}`
                          : programTimesLabel(program.start_times)}
                      </Typography>
                    </Box>
                    <Switch
                      checked={Boolean(program.is_active)}
                      onChange={() => toggleActive(program)}
                      inputProps={{ 'aria-label': 'Active' }}
                    />
                  </Box>
                  <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {steps.map((step) => {
                      const zone = (zones || []).find((z) => z.id === step.zone_id);
                      return (
                        <Typography key={step.id || step.seq} variant="body2">
                          {step.seq + 1}. {zone?.zone_code || 'Zone'} —{' '}
                          {step.target_liters != null ? `${step.target_liters} L` : `${step.on_duration_minutes} min`}
                        </Typography>
                      );
                    })}
                    {programType === 'fertigation' && (program.irrigation_program_devices || []).length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        Injectors: {(program.irrigation_program_devices || []).length}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                    <Button size="small" onClick={() => openEdit(program)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => deleteProgram(program)}>Delete</Button>
                  </Box>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{editing ? 'Edit program' : `New ${programType === 'fertigation' ? 'fertigation' : 'water'} program`}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={8}>
              <TextField
                fullWidth
                label="Name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControlLabel
                control={(
                  <Switch
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  />
                )}
                label="Active"
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" gutterBottom>Days</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {WEEKDAY_LABELS.map((label, day) => (
                  <Chip
                    key={label}
                    label={label}
                    clickable
                    color={form.days_of_week.includes(day) ? 'primary' : 'default'}
                    variant={form.days_of_week.includes(day) ? 'filled' : 'outlined'}
                    onClick={() => toggleDay(day)}
                  />
                ))}
              </Box>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Start times (comma-separated HH:MM)"
                value={form.start_times.join(', ')}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  start_times: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                }))}
                helperText="Leave empty to rely on allowed windows only (fires at top of hour when inside window)."
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={form.use_allowed_windows}
                    onChange={(e) => setForm((f) => ({ ...f, use_allowed_windows: e.target.checked }))}
                  />
                )}
                label="Only run inside allowed watering hours"
              />
            </Grid>
            {motors.length > 0 && (
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Irrigation motors</InputLabel>
                  <Select
                    multiple
                    label="Irrigation motors"
                    value={form.motor_device_ids}
                    onChange={(e) => setForm((f) => ({ ...f, motor_device_ids: e.target.value }))}
                    renderValue={(selected) => selected
                      .map((id) => motors.find((m) => m.id === id)?.name || id)
                      .join(', ')}
                  >
                    {motors.map((m) => (
                      <MenuItem key={m.id} value={m.id}>{m.name} ({m.device_code})</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {programType === 'fertigation' && (
              <Grid item xs={12}>
                <FormControl fullWidth>
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
                      <MenuItem key={m.id} value={m.id}>{m.name} ({m.device_code})</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="caption" color="text.secondary">
                  Water valve always starts with injectors.
                </Typography>
              </Grid>
            )}
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2">Zone sequence (liters primary)</Typography>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => setForm((f) => ({
                    ...f,
                    steps: [...f.steps, emptyStep(f.steps.length)],
                  }))}
                >
                  Add step
                </Button>
              </Box>
              {form.steps.map((step, idx) => {
                const zone = (zones || []).find((z) => String(z.id) === String(step.zone_id));
                const est = estimateMinutesFromLiters(step.target_liters, zone?.flow_rate_lph);
                return (
                  <Grid container spacing={1} key={idx} sx={{ mb: 1 }} alignItems="center">
                    <Grid item xs={12} sm={4}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Zone</InputLabel>
                        <Select
                          label="Zone"
                          value={step.zone_id}
                          onChange={(e) => setForm((f) => {
                            const steps = [...f.steps];
                            steps[idx] = { ...steps[idx], zone_id: e.target.value };
                            return { ...f, steps };
                          })}
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
                        label="Target L"
                        type="number"
                        value={step.target_liters}
                        onChange={(e) => setForm((f) => {
                          const steps = [...f.steps];
                          steps[idx] = { ...steps[idx], target_liters: e.target.value };
                          return { ...f, steps };
                        })}
                      />
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Est. min"
                        type="number"
                        value={step.on_duration_minutes || est || ''}
                        onChange={(e) => setForm((f) => {
                          const steps = [...f.steps];
                          steps[idx] = { ...steps[idx], on_duration_minutes: e.target.value };
                          return { ...f, steps };
                        })}
                        helperText={est != null ? `~${est} from flow` : ' '}
                      />
                    </Grid>
                    <Grid item xs={12} sm={2}>
                      <IconButton
                        aria-label="Remove step"
                        disabled={form.steps.length <= 1}
                        onClick={() => setForm((f) => ({
                          ...f,
                          steps: f.steps.filter((_, i) => i !== idx),
                        }))}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Grid>
                  </Grid>
                );
              })}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={saving} onClick={saveProgram}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default IrrigationProgramsPanel;
