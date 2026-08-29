import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
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
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { supabase } from '../../supabaseClient';
import IrrigationProgramFormDialog, { emptyStep } from './IrrigationProgramFormDialog';
import {
  createAdHocVolumeJob,
  defaultStartFromWindows,
  deleteIrrigationJob,
  estimateMinutesFromLiters,
  estimateProgramMinutes,
  estimateStepMinutes,
  formatEstimatedDuration,
  isMissingScheduleTable,
  jobProgressLabel,
  programDaysLabel,
  programTimesLabel,
  scheduleTableHint,
  timeToInputValue,
  updateIrrigationJob,
} from '../../utils/irrigationSchedule';

function IrrigationProgramsPanel({
  farmId,
  zones,
  devices,
  programType = 'water',
  title = 'Programs',
}) {
  const [programs, setPrograms] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '',
    is_active: true,
    run_order: 0,
    days_of_week: [1, 2, 3, 4],
    start_times: ['06:00'],
    use_allowed_windows: true,
    motor_device_ids: [],
    steps: [emptyStep(0)],
    injector_ids: [],
  });
  const [jobForm, setJobForm] = useState({ zone_id: '', target_liters: '6000' });
  const [creatingJob, setCreatingJob] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [editJobForm, setEditJobForm] = useState({ zone_id: '', target_liters: '' });
  const [jobBusy, setJobBusy] = useState(false);

  const drivable = (devices || []).filter((d) => d.io_type !== 'input');
  const motors = drivable.filter((d) => d.kind === 'irrigation_motor');
  const injectors = drivable.filter((d) => d.kind === 'fertigation');

  const defaultMotorIds = () => (
    motors.length === 1 ? [motors[0].id] : []
  );

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    const [
      { data: progData, error: progError },
      { data: jobData, error: jobError },
      { data: windowData },
    ] = await Promise.all([
      supabase
        .from('irrigation_programs')
        .select('*, irrigation_program_steps(*), irrigation_program_devices(*)')
        .eq('farm_id', farmId)
        .eq('program_type', programType)
        .order('run_order')
        .order('id'),
      supabase
        .from('irrigation_jobs')
        .select('*')
        .eq('farm_id', farmId)
        .in(
          'job_type',
          programType === 'fertigation' ? ['fertigation'] : ['water', 'manual'],
        )
        .in('status', ['planned', 'running', 'paused_outside_window'])
        .order('created_at', { ascending: false }),
      supabase
        .from('irrigation_allowed_windows')
        .select('*')
        .eq('farm_id', farmId)
        .eq('enabled', true)
        .order('weekday')
        .order('start_time'),
    ]);

    if (progError || jobError) {
      const err = progError || jobError;
      setMessage({
        type: isMissingScheduleTable(err) ? 'warning' : 'error',
        text: isMissingScheduleTable(err)
          ? 'Run migration 039_irrigation_schedule_control.sql (and 041) in Supabase, then reload.'
          : scheduleTableHint(err.message),
      });
      setPrograms([]);
      setJobs([]);
    } else {
      setPrograms(progData || []);
      setJobs(jobData || []);
      setMessage(null);
    }
    setWindows(windowData || []);
    setLoading(false);
  }, [farmId, programType]);

  useEffect(() => {
    load();
  }, [load]);

  const nextRunOrder = () => {
    if (!programs.length) return 1;
    return Math.max(...programs.map((p) => Number(p.run_order) || 0)) + 1;
  };

  const openCreate = () => {
    const days = [1, 2, 3, 4];
    const start = defaultStartFromWindows(windows, days);
    setEditing(null);
    setForm({
      name: programType === 'fertigation'
        ? `Fertigation ${programs.length + 1}`
        : `Program ${programs.length + 1}`,
      is_active: true,
      run_order: nextRunOrder(),
      days_of_week: days,
      start_times: [start],
      use_allowed_windows: true,
      motor_device_ids: defaultMotorIds(),
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
      run_order: program.run_order ?? 0,
      days_of_week: program.days_of_week || [],
      start_times: (program.start_times || []).map((t) => timeToInputValue(t)),
      use_allowed_windows: program.use_allowed_windows !== false,
      motor_device_ids: program.motor_device_ids || [],
      steps: steps.length ? steps : [emptyStep(0)],
      injector_ids: (program.irrigation_program_devices || []).map((d) => d.device_id),
    });
    setDialogOpen(true);
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
      run_order: Number(form.run_order) || 0,
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
        if (String(error.message || '').includes('run_order')) {
          setMessage({ type: 'warning', text: 'Run migration 041_irrigation_program_run_order.sql, then try again.' });
        } else {
          setMessage({ type: 'error', text: scheduleTableHint(error.message) });
        }
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
        if (String(error.message || '').includes('run_order')) {
          setMessage({ type: 'warning', text: 'Run migration 041_irrigation_program_run_order.sql, then try again.' });
        } else {
          setMessage({ type: 'error', text: scheduleTableHint(error.message) });
        }
        setSaving(false);
        return;
      }
      programId = data.id;
    }

    const stepRows = form.steps
      .filter((s) => s.zone_id)
      .map((s, idx) => {
        const zone = (zones || []).find((z) => String(z.id) === String(s.zone_id));
        const est = estimateMinutesFromLiters(s.target_liters, zone?.flow_rate_lph);
        return {
          program_id: programId,
          seq: idx,
          zone_id: Number(s.zone_id),
          target_liters: s.target_liters === '' ? null : Number(s.target_liters),
          on_duration_minutes: s.on_duration_minutes !== ''
            ? Number(s.on_duration_minutes)
            : (est ?? null),
          is_active: s.is_active !== false,
        };
      });

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

  const moveProgram = async (program, direction) => {
    const sorted = [...programs].sort((a, b) =>
      (Number(a.run_order) || 0) - (Number(b.run_order) || 0) || a.id - b.id);
    const idx = sorted.findIndex((p) => p.id === program.id);
    const swapWith = sorted[idx + direction];
    if (!swapWith) return;

    const aOrder = Number(program.run_order) || idx + 1;
    const bOrder = Number(swapWith.run_order) || idx + direction + 1;
    const updates = [
      supabase.from('irrigation_programs').update({
        run_order: bOrder,
        updated_at: new Date().toISOString(),
      }).eq('id', program.id),
      supabase.from('irrigation_programs').update({
        run_order: aOrder,
        updated_at: new Date().toISOString(),
      }).eq('id', swapWith.id),
    ];
    const results = await Promise.all(updates);
    const err = results.find((r) => r.error)?.error;
    if (err) {
      setMessage({
        type: String(err.message || '').includes('run_order') ? 'warning' : 'error',
        text: String(err.message || '').includes('run_order')
          ? 'Run migration 041_irrigation_program_run_order.sql, then try again.'
          : scheduleTableHint(err.message),
      });
      return;
    }
    await load();
  };

  const createQuickJob = async () => {
    if (!jobForm.zone_id || !jobForm.target_liters) {
      setMessage({ type: 'error', text: 'Pick a zone and target liters.' });
      return;
    }
    setCreatingJob(true);
    const { error } = await createAdHocVolumeJob({
      farmId,
      zoneId: Number(jobForm.zone_id),
      targetLiters: Number(jobForm.target_liters),
      jobType: 'manual',
      windowMode: false,
      immediate: true,
      deviceIds: [],
    });
    setCreatingJob(false);
    if (error) {
      setMessage({
        type: isMissingScheduleTable(error) ? 'warning' : 'error',
        text: scheduleTableHint(error.message),
      });
      return;
    }
    setMessage({
      type: 'success',
      text: 'Quick job started now. Other programs were paused and will resume after this job finishes.',
    });
    await load();
  };

  const openEditJob = (job) => {
    setEditJob(job);
    setEditJobForm({
      zone_id: String(job.zone_id || ''),
      target_liters: job.target_liters != null ? String(job.target_liters) : '',
    });
  };

  const saveEditJob = async () => {
    if (!editJob) return;
    if (!editJobForm.zone_id || !editJobForm.target_liters) {
      setMessage({ type: 'error', text: 'Zone and target liters are required.' });
      return;
    }
    setJobBusy(true);
    const { error } = await updateIrrigationJob(editJob.id, {
      zoneId: Number(editJobForm.zone_id),
      targetLiters: Number(editJobForm.target_liters),
    });
    setJobBusy(false);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    setEditJob(null);
    setMessage({ type: 'success', text: 'Job updated.' });
    await load();
  };

  const removeJob = async (job) => {
    setJobBusy(true);
    const { error } = await deleteIrrigationJob(farmId, job);
    setJobBusy(false);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    setEditJob(null);
    setMessage({
      type: 'success',
      text: job.job_type === 'manual'
        ? 'Quick job cancelled. Paused programs can resume.'
        : 'Job cancelled.',
    });
    await load();
  };

  const quickJobZone = (zones || []).find((z) => String(z.id) === String(jobForm.zone_id));
  const quickJobEst = estimateMinutesFromLiters(jobForm.target_liters, quickJobZone?.flow_rate_lph);

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
          Programs run one after another (by order). Inside a program, zones run in sequence —
          next zone starts only after target liters. Estimates use zone flow rate (L/h).
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
          Starts immediately and pauses other programs. When this job finishes or is deleted, paused programs resume in order.
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
          <Grid item xs={12} sm={3}>
            <TextField
              fullWidth
              size="small"
              label="Target liters"
              type="number"
              value={jobForm.target_liters}
              onChange={(e) => setJobForm((f) => ({ ...f, target_liters: e.target.value }))}
            />
          </Grid>
          <Grid item xs={12} sm={2}>
            <Typography variant="body2" color="text.secondary">
              Est. {formatEstimatedDuration(quickJobEst) || '—'}
              {quickJobZone?.flow_rate_lph ? ` @ ${quickJobZone.flow_rate_lph} L/h` : ''}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={3}>
            <Button
              variant="contained"
              color="warning"
              startIcon={creatingJob ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
              disabled={creatingJob}
              onClick={createQuickJob}
            >
              Start now
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
              const est = estimateMinutesFromLiters(job.target_liters, zone?.flow_rate_lph);
              const isManual = job.job_type === 'manual';
              return (
                <Grid item xs={12} sm={6} key={job.id}>
                  <Paper
                    variant="outlined"
                    sx={(theme) => ({
                      p: 1.5,
                      borderColor: isManual ? theme.palette.warning.main : undefined,
                    })}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                      <Typography fontWeight={700}>
                        {zone?.zone_code || `Zone ${job.zone_id}`}
                        {isManual ? ' · Quick job' : ''}
                      </Typography>
                      <Chip
                        size="small"
                        color={isManual ? 'warning' : 'default'}
                        label={job.status}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {jobProgressLabel(job)}
                      {est != null ? ` · ~${formatEstimatedDuration(est)} est.` : ''}
                    </Typography>
                    <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                      <Button size="small" onClick={() => openEditJob(job)} disabled={jobBusy}>
                        Modify
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => removeJob(job)}
                        disabled={jobBusy}
                      >
                        Delete
                      </Button>
                    </Box>
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
          {programs.map((program, index) => {
            const steps = (program.irrigation_program_steps || []).slice().sort((a, b) => a.seq - b.seq);
            const totalMins = estimateProgramMinutes(steps, zones);
            return (
              <Grid item xs={12} md={6} key={program.id}>
                <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        Run order #{program.run_order ?? index + 1}
                        {index > 0 ? ' · starts after previous finishes' : ' · runs first'}
                      </Typography>
                      <Typography variant="h6" fontWeight={800}>{program.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {programDaysLabel(program.days_of_week)}
                        {' · '}
                        {program.use_allowed_windows
                          ? `MSEB hours${program.start_times?.length ? ` from ${programTimesLabel(program.start_times)}` : ''}`
                          : programTimesLabel(program.start_times)}
                        {totalMins > 0 ? ` · ~${formatEstimatedDuration(totalMins)} total` : ''}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <Switch
                        checked={Boolean(program.is_active)}
                        onChange={() => toggleActive(program)}
                        inputProps={{ 'aria-label': 'Active' }}
                      />
                      <Box>
                        <IconButton size="small" disabled={index === 0} onClick={() => moveProgram(program, -1)}>
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          disabled={index === programs.length - 1}
                          onClick={() => moveProgram(program, 1)}
                        >
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {steps.map((step, stepIdx) => {
                      const zone = (zones || []).find((z) => z.id === step.zone_id);
                      const stepMins = estimateStepMinutes(step, zones);
                      return (
                        <Typography key={step.id || step.seq} variant="body2">
                          {stepIdx + 1}. {zone?.zone_code || 'Zone'} —{' '}
                          {step.target_liters != null ? `${step.target_liters} L` : `${step.on_duration_minutes} min`}
                          {stepMins != null ? ` (~${formatEstimatedDuration(stepMins)})` : ''}
                          {stepIdx < steps.length - 1 ? ' → then next zone' : ''}
                        </Typography>
                      );
                    })}
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

      <IrrigationProgramFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editing={editing}
        form={form}
        setForm={setForm}
        zones={zones}
        windows={windows}
        motors={motors}
        injectors={injectors}
        programType={programType}
        saving={saving}
        onSave={saveProgram}
      />

      <Dialog open={Boolean(editJob)} onClose={() => setEditJob(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          Modify {editJob?.job_type === 'manual' ? 'quick job' : 'job'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Zone</InputLabel>
                <Select
                  label="Zone"
                  value={editJobForm.zone_id}
                  onChange={(e) => setEditJobForm((f) => ({ ...f, zone_id: e.target.value }))}
                >
                  {(zones || []).map((z) => (
                    <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Target liters"
                type="number"
                value={editJobForm.target_liters}
                onChange={(e) => setEditJobForm((f) => ({ ...f, target_liters: e.target.value }))}
                helperText={(() => {
                  const z = (zones || []).find((item) => String(item.id) === String(editJobForm.zone_id));
                  const est = estimateMinutesFromLiters(editJobForm.target_liters, z?.flow_rate_lph);
                  return est != null
                    ? `Estimated ${formatEstimatedDuration(est)} at ${z.flow_rate_lph} L/h`
                    : 'Set zone flow rate for time estimate';
                })()}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            color="error"
            disabled={jobBusy}
            onClick={() => editJob && removeJob(editJob)}
          >
            Delete job
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setEditJob(null)}>Cancel</Button>
          <Button variant="contained" disabled={jobBusy} onClick={saveEditJob}>
            {jobBusy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default IrrigationProgramsPanel;
