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
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { supabase } from '../../supabaseClient';
import IrrigationProgramFormDialog, { emptyStep } from './IrrigationProgramFormDialog';
import {
  OPEN_JOB_STATUSES,
  createAdHocVolumeJob,
  deleteIrrigationJob,
  pauseIrrigationJob,
  resumeIrrigationJob,
  estimateMinutesFromLiters,
  estimateProgramMinutes,
  formatEstimatedDuration,
  isMissingScheduleTable,
  jobProgressLabel,
  jobStatusLabel,
  programDaysLabel,
  programTimesLabel,
  scheduleTableHint,
  timeToInputValue,
  updateIrrigationJob,
  cancelUnusedProgramJobs,
  applySavedProgramToRunningJob,
} from '../../utils/irrigationSchedule';
import { emptyFertigationLineItem, formatFertilizerProductLines } from '../../utils/fertilizerEventMaintenance';

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
    run_order: 0,
    days_of_week: [1, 2, 3, 4],
    start_times: ['06:00'],
    motor_device_ids: [],
    steps: [emptyStep(0)],
    injector_ids: [],
    skip_if_rain: programType !== 'fertigation',
    products: [emptyFertigationLineItem()],
  });
  const [jobForm, setJobForm] = useState({
    zone_id: '',
    target_liters: '6000',
    motor_id: '',
    injector_id: '',
    duration_minutes: '30',
  });
  const [creatingJob, setCreatingJob] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [editJobForm, setEditJobForm] = useState({
    zone_id: '',
    target_liters: '',
    duration_minutes: '',
  });
  const [jobBusy, setJobBusy] = useState(false);
  const [fertilizerProducts, setFertilizerProducts] = useState([]);

  const drivable = (devices || []).filter((d) => d.io_type !== 'input');
  const motors = drivable.filter((d) => d.kind === 'irrigation_motor');
  const injectors = drivable.filter((d) => d.kind === 'fertigation');

  const defaultMotorIds = () => (
    motors.length === 1 ? [motors[0].id] : []
  );
  const defaultInjectorIds = () => (
    injectors.length === 1 ? [injectors[0].id] : []
  );

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    const programSelect = '*, irrigation_program_steps(*), irrigation_program_devices(*), irrigation_program_products(id, product_id, quantity, unit, products(name))';
    const programSelectBase = '*, irrigation_program_steps(*), irrigation_program_devices(*)';
    let progData = null;
    let progError = null;
    let productsHint = null;
    if (programType === 'fertigation') {
      const first = await supabase
        .from('irrigation_programs')
        .select(programSelect)
        .eq('farm_id', farmId)
        .eq('program_type', programType)
        .order('run_order')
        .order('id');
      if (first.error && /irrigation_program_products/.test(first.error.message || '')) {
        productsHint = 'Run migration 056_irrigation_program_products.sql in Supabase SQL Editor so fertigation products can be saved.';
        const retry = await supabase
          .from('irrigation_programs')
          .select(programSelectBase)
          .eq('farm_id', farmId)
          .eq('program_type', programType)
          .order('run_order')
          .order('id');
        progData = retry.data;
        progError = retry.error;
      } else {
        progData = first.data;
        progError = first.error;
      }
    } else {
      const result = await supabase
        .from('irrigation_programs')
        .select(programSelectBase)
        .eq('farm_id', farmId)
        .eq('program_type', programType)
        .order('run_order')
        .order('id');
      progData = result.data;
      progError = result.error;
    }

    const { data: jobData, error: jobError } = await supabase
      .from('irrigation_jobs')
      .select('*')
      .eq('farm_id', farmId)
      .in(
        'job_type',
        programType === 'fertigation' ? ['fertigation'] : ['water', 'manual'],
      )
      .in('status', OPEN_JOB_STATUSES)
      .order('created_at', { ascending: false });

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
      setMessage(productsHint ? { type: 'warning', text: productsHint } : null);
    }
    setLoading(false);
  }, [farmId, programType]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (programType !== 'fertigation') {
      setFertilizerProducts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, unit, category')
        .eq('active', true)
        .eq('category', 'Fertilizer')
        .order('name');
      if (!cancelled) setFertilizerProducts(data || []);
    })();
    return () => { cancelled = true; };
  }, [programType]);

  useEffect(() => {
    setJobForm((f) => ({
      ...f,
      motor_id: f.motor_id || (motors.length === 1 ? String(motors[0].id) : ''),
      injector_id: f.injector_id || (injectors.length === 1 ? String(injectors[0].id) : ''),
    }));
  }, [motors, injectors]);

  const nextRunOrder = () => {
    if (!programs.length) return 1;
    return Math.max(...programs.map((p) => Number(p.run_order) || 0)) + 1;
  };

  const openCreate = () => {
    const days = [1, 2, 3, 4];
    setEditing(null);
    setForm({
      name: programType === 'fertigation'
        ? `Fertigation ${programs.length + 1}`
        : `Program ${programs.length + 1}`,
      is_active: true,
      run_order: nextRunOrder(),
      days_of_week: days,
      start_times: ['06:00'],
      motor_device_ids: defaultMotorIds(),
      steps: [emptyStep(0)],
      injector_ids: programType === 'fertigation' ? defaultInjectorIds() : [],
      skip_if_rain: programType !== 'fertigation',
      products: [emptyFertigationLineItem()],
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
      motor_device_ids: program.motor_device_ids || [],
      steps: steps.length ? steps : [emptyStep(0)],
      injector_ids: (program.irrigation_program_devices || []).map((d) => d.device_id),
      skip_if_rain: program.skip_if_rain != null
        ? Boolean(program.skip_if_rain)
        : programType !== 'fertigation',
      products: (program.irrigation_program_products || []).length
        ? program.irrigation_program_products.map((row) => ({
          product_id: String(row.product_id),
          quantity: String(row.quantity),
          unit: row.unit || '',
        }))
        : [emptyFertigationLineItem()],
    });
    setDialogOpen(true);
  };

  const saveProgram = async () => {
    if (!farmId || !form.name.trim()) {
      setMessage({ type: 'error', text: 'Name is required.' });
      return;
    }
    if (!form.days_of_week.length) {
      setMessage({ type: 'error', text: 'Pick at least one day.' });
      return;
    }
    if (!form.start_times.filter(Boolean).length) {
      setMessage({ type: 'error', text: 'Start time is required.' });
      return;
    }
    if (!(form.motor_device_ids || []).length) {
      setMessage({ type: 'error', text: 'Select an irrigation motor.' });
      return;
    }
    if (programType === 'fertigation' && !(form.injector_ids || []).length) {
      setMessage({ type: 'error', text: 'Select a fertigation injector.' });
      return;
    }
    const hasCompleteStep = programType === 'fertigation'
      ? (form.steps || []).some((s) => s.zone_id && Number(s.on_duration_minutes) > 0)
      : (form.steps || []).some((s) => s.zone_id && Number(s.target_liters) > 0);
    if (!hasCompleteStep) {
      setMessage({
        type: 'error',
        text: programType === 'fertigation'
          ? 'Add at least one zone with duration in minutes.'
          : 'Add at least one zone with target liters.',
      });
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
      motor_device_ids: form.motor_device_ids,
      skip_if_rain: programType === 'fertigation' ? false : Boolean(form.skip_if_rain),
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
      .filter((s) => (programType === 'fertigation'
        ? s.zone_id && Number(s.on_duration_minutes) > 0
        : s.zone_id && Number(s.target_liters) > 0))
      .map((s, idx) => {
        const zone = (zones || []).find((z) => String(z.id) === String(s.zone_id));
        const est = estimateMinutesFromLiters(s.target_liters, zone?.flow_rate_lph);
        if (programType === 'fertigation') {
          return {
            program_id: programId,
            seq: idx,
            zone_id: Number(s.zone_id),
            target_liters: null,
            on_duration_minutes: Number(s.on_duration_minutes),
            is_active: s.is_active !== false,
          };
        }
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

    if (programType === 'fertigation') {
      const deviceRows = (form.injector_ids || []).map((deviceId) => ({
        program_id: programId,
        device_id: Number(deviceId),
        role: 'injector',
      }));
      if (deviceRows.length) {
        const { error: deviceError } = await supabase
          .from('irrigation_program_devices')
          .insert(deviceRows);
        if (deviceError) {
          setMessage({ type: 'error', text: scheduleTableHint(deviceError.message) });
          setSaving(false);
          return;
        }
      }
    }

    if (programType === 'fertigation' && programId) {
      await supabase.from('irrigation_program_products').delete().eq('program_id', programId);
      const productRows = (form.products || [])
        .filter((row) => row.product_id && Number(row.quantity) > 0)
        .map((row) => {
          const product = fertilizerProducts.find((p) => String(p.id) === String(row.product_id));
          return {
            program_id: programId,
            product_id: Number(row.product_id),
            quantity: Number(row.quantity),
            unit: row.unit || product?.unit || null,
          };
        });
      if (productRows.length) {
        const { error: productError } = await supabase
          .from('irrigation_program_products')
          .insert(productRows);
        if (productError) {
          setMessage({
            type: /irrigation_program_products/.test(productError.message || '') ? 'warning' : 'error',
            text: /irrigation_program_products/.test(productError.message || '')
              ? 'Run migration 056_irrigation_program_products.sql in Supabase SQL Editor, then save the products again.'
              : scheduleTableHint(productError.message),
          });
          setSaving(false);
          return;
        }
      }
    }

    if (editing && programId) {
      const applied = await applySavedProgramToRunningJob(farmId, programId);
      if (applied.error) {
        setMessage({ type: 'error', text: scheduleTableHint(applied.error.message || String(applied.error)) });
        setSaving(false);
        return;
      }
      await cancelUnusedProgramJobs(farmId, programId);
      setSaving(false);
      setDialogOpen(false);
      setMessage({
        type: 'success',
        text: applied.applied
          ? 'Program updated. The running job was paused, the new settings applied, and only this program was started again.'
          : 'Program updated. A waiting job is replaced. If it already ran today, it runs again only when a start time is still later today; otherwise it waits for the next scheduled day.',
      });
      await load();
      return;
    }

    setSaving(false);
    setDialogOpen(false);
    setMessage({ type: 'success', text: 'Program created.' });
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
    const isFertigation = programType === 'fertigation';
    if (!jobForm.zone_id) {
      setMessage({ type: 'error', text: 'Pick a zone.' });
      return;
    }
    if (!jobForm.motor_id) {
      setMessage({ type: 'error', text: 'Select equipment (irrigation motor).' });
      return;
    }
    if (isFertigation) {
      if (!jobForm.injector_id) {
        setMessage({ type: 'error', text: 'Select an injector.' });
        return;
      }
      if (!(Number(jobForm.duration_minutes) > 0)) {
        setMessage({ type: 'error', text: 'Enter duration in minutes.' });
        return;
      }
    } else if (!(Number(jobForm.target_liters) > 0)) {
      setMessage({ type: 'error', text: 'Enter target liters.' });
      return;
    }

    setCreatingJob(true);
    const { error } = await createAdHocVolumeJob({
      farmId,
      zoneId: Number(jobForm.zone_id),
      targetLiters: isFertigation ? null : Number(jobForm.target_liters),
      onDurationMinutes: isFertigation ? Number(jobForm.duration_minutes) : null,
      jobType: isFertigation ? 'fertigation' : 'manual',
      windowMode: false,
      immediate: true,
      motorDeviceId: Number(jobForm.motor_id),
      injectorDeviceIds: isFertigation && jobForm.injector_id ? [Number(jobForm.injector_id)] : [],
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
      text: isFertigation
        ? 'Fertigation started now. Other programs were paused and will resume after this finishes.'
        : 'Watering started now. Other programs were paused and will resume after this job finishes.',
    });
    await load();
  };

  const openEditJob = (job) => {
    setEditJob(job);
    setEditJobForm({
      zone_id: String(job.zone_id || ''),
      target_liters: job.target_liters != null ? String(job.target_liters) : '',
      duration_minutes: job.on_duration_minutes != null ? String(job.on_duration_minutes) : '',
    });
  };

  const saveEditJob = async () => {
    if (!editJob) return;
    const isDurationJob = Number(editJob.on_duration_minutes) > 0 && !(Number(editJob.target_liters) > 0);
    if (!editJobForm.zone_id) {
      setMessage({ type: 'error', text: 'Zone is required.' });
      return;
    }
    if (isDurationJob && !(Number(editJobForm.duration_minutes) > 0)) {
      setMessage({ type: 'error', text: 'Duration is required.' });
      return;
    }
    if (!isDurationJob && !editJobForm.target_liters) {
      setMessage({ type: 'error', text: 'Zone and target liters are required.' });
      return;
    }
    setJobBusy(true);
    const { error } = await updateIrrigationJob(editJob.id, isDurationJob
      ? { zoneId: Number(editJobForm.zone_id), onDurationMinutes: Number(editJobForm.duration_minutes) }
      : { zoneId: Number(editJobForm.zone_id), targetLiters: Number(editJobForm.target_liters) });
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

  const pauseJob = async (job) => {
    setJobBusy(true);
    const { error } = await pauseIrrigationJob(farmId, job);
    setJobBusy(false);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    setMessage({ type: 'success', text: 'Program paused. Resume when you want it to continue.' });
    await load();
  };

  const resumeJob = async (job) => {
    setJobBusy(true);
    const { error } = await resumeIrrigationJob(job);
    setJobBusy(false);
    if (error) {
      setMessage({ type: 'error', text: scheduleTableHint(error.message) });
      return;
    }
    setMessage({ type: 'success', text: 'Program queued to resume. It will start on the next scheduler tick.' });
    await load();
  };

  const formatSteps = (steps) => (
    (steps || []).map((step) => {
      const zone = (zones || []).find((z) => z.id === step.zone_id);
      const code = zone?.zone_code || 'Zone';
      if (programType === 'fertigation' || step.target_liters == null) {
        return `${code} ${step.on_duration_minutes || '—'} min`;
      }
      return `${code} ${step.target_liters} L`;
    }).join(' → ') || '—'
  );

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
      {title && (
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
          {title}
        </Typography>
      )}
      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ maxWidth: 640 }}>
          <Typography variant="body2" color="text.secondary">
            {programType === 'fertigation'
              ? 'Fertigation programs run one after another. Selected equipment terminals start and stop together for the minutes on each zone. Saving a running program pauses it, applies the new settings, and starts only that program again. After a finished run it will not start again unless you save a change and a start time is still later today.'
              : 'Water programs run one after another. Each zone finishes its liters before the next starts. Programs wait for mains; a late restore shifts remaining starts today, and a mid-run outage extends that job. Saving a running program pauses it, applies the new settings, and starts only that program again. After a finished run it will not start again unless you save a change and a start time is still later today.'}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          {programType === 'fertigation' ? 'New fertigation program' : 'New water program'}
        </Button>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          {programType === 'fertigation' ? 'Fertigation now' : 'Water now'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Starts immediately. Other programs pause until this finishes or you delete it.
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={programType === 'fertigation' ? 3 : 3}>
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
          <Grid item xs={12} sm={programType === 'fertigation' ? 3 : 3}>
            <FormControl fullWidth size="small" required>
              <InputLabel>Equipment</InputLabel>
              <Select
                label="Equipment"
                value={jobForm.motor_id}
                onChange={(e) => setJobForm((f) => ({ ...f, motor_id: e.target.value }))}
              >
                {motors.map((m) => (
                  <MenuItem key={m.id} value={String(m.id)}>
                    {m.name}{m.device_code ? ` (${m.device_code})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          {programType === 'fertigation' && (
            <Grid item xs={12} sm={2}>
              <FormControl fullWidth size="small" required>
                <InputLabel>Injector</InputLabel>
                <Select
                  label="Injector"
                  value={jobForm.injector_id}
                  onChange={(e) => setJobForm((f) => ({ ...f, injector_id: e.target.value }))}
                >
                  {injectors.map((m) => (
                    <MenuItem key={m.id} value={String(m.id)}>
                      {m.name}{m.device_code ? ` (${m.device_code})` : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          <Grid item xs={12} sm={programType === 'fertigation' ? 2 : 3}>
            {programType === 'fertigation' ? (
              <TextField
                fullWidth
                size="small"
                required
                label="Minutes"
                type="number"
                value={jobForm.duration_minutes}
                onChange={(e) => setJobForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                inputProps={{ min: 1, step: 1 }}
              />
            ) : (
              <TextField
                fullWidth
                size="small"
                required
                label="Target liters"
                type="number"
                value={jobForm.target_liters}
                onChange={(e) => setJobForm((f) => ({ ...f, target_liters: e.target.value }))}
                helperText={
                  quickJobEst
                    ? `About ${formatEstimatedDuration(quickJobEst)}${quickJobZone?.flow_rate_lph ? ` at ${quickJobZone.flow_rate_lph} L/h` : ''}`
                    : undefined
                }
              />
            )}
          </Grid>
          <Grid item xs={12} sm={2}>
            <Button
              fullWidth
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
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Zone</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Progress</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.map((job) => {
                const zone = (zones || []).find((z) => z.id === job.zone_id);
                const est = estimateMinutesFromLiters(job.target_liters, zone?.flow_rate_lph);
                const isManual = job.job_type === 'manual';
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      {zone?.zone_code || `Zone ${job.zone_id}`}
                      {isManual ? ' · Water now' : ''}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={
                          isManual
                            ? 'warning'
                            : (job.status === 'running'
                              ? 'success'
                              : (job.status === 'paused_manual' ? 'warning' : 'default'))
                        }
                        label={jobStatusLabel(job.status)}
                      />
                    </TableCell>
                    <TableCell>
                      {jobProgressLabel(job)}
                      {est != null ? ` · about ${formatEstimatedDuration(est)}` : ''}
                    </TableCell>
                    <TableCell align="right">
                      {job.status === 'running' && (
                        <Button size="small" onClick={() => pauseJob(job)} disabled={jobBusy}>Pause</Button>
                      )}
                      {job.status === 'paused_manual' && (
                        <Button size="small" onClick={() => resumeJob(job)} disabled={jobBusy}>Resume</Button>
                      )}
                      <Button size="small" onClick={() => openEditJob(job)} disabled={jobBusy}>Modify</Button>
                      <Button size="small" color="error" onClick={() => removeJob(job)} disabled={jobBusy}>Delete</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={88}>Order</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Days</TableCell>
              <TableCell>Start</TableCell>
              <TableCell>Motor</TableCell>
              {programType === 'fertigation' && <TableCell>Injector</TableCell>}
              {programType === 'fertigation' && <TableCell>Products</TableCell>}
              <TableCell>{programType === 'fertigation' ? 'Zones & minutes' : 'Zones & liters'}</TableCell>
              <TableCell>Time</TableCell>
              <TableCell>On</TableCell>
              {programType !== 'fertigation' && <TableCell>Skip rain</TableCell>}
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {programs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={programType === 'fertigation' ? 11 : 10}>
                  <Typography color="text.secondary">
                    {programType === 'fertigation'
                      ? 'No fertigation programs yet.'
                      : 'No water programs yet.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : programs.map((program, index) => {
              const steps = (program.irrigation_program_steps || []).slice().sort((a, b) => a.seq - b.seq);
              const totalMins = estimateProgramMinutes(steps, zones);
              const motor = motors.find((m) => program.motor_device_ids?.some((id) => Number(id) === Number(m.id)));
              const injector = injectors.find((m) =>
                (program.irrigation_program_devices || []).some((d) => Number(d.device_id) === Number(m.id)));
              return (
                <TableRow key={program.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <IconButton size="small" disabled={index === 0} onClick={() => moveProgram(program, -1)}>
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" disabled={index === programs.length - 1} onClick={() => moveProgram(program, 1)}>
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight={700}>{program.name}</Typography>
                  </TableCell>
                  <TableCell>{programDaysLabel(program.days_of_week)}</TableCell>
                  <TableCell>{programTimesLabel(program.start_times)}</TableCell>
                  <TableCell>{motor?.name || '—'}</TableCell>
                  {programType === 'fertigation' && (
                    <TableCell>{injector?.name || '—'}</TableCell>
                  )}
                  {programType === 'fertigation' && (
                    <TableCell>
                      {formatFertilizerProductLines(program.irrigation_program_products)}
                    </TableCell>
                  )}
                  <TableCell>{formatSteps(steps)}</TableCell>
                  <TableCell>{totalMins > 0 ? formatEstimatedDuration(totalMins) : '—'}</TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={Boolean(program.is_active)}
                      onChange={() => toggleActive(program)}
                      inputProps={{ 'aria-label': 'Active' }}
                    />
                  </TableCell>
                  {programType !== 'fertigation' && (
                  <TableCell>
                    {program.skip_if_rain != null
                      ? (program.skip_if_rain ? 'Yes' : 'No')
                      : 'Yes'}
                  </TableCell>
                  )}
                  <TableCell align="right">
                    <Button size="small" onClick={() => openEdit(program)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => deleteProgram(program)}>Delete</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <IrrigationProgramFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editing={editing}
        form={form}
        setForm={setForm}
        zones={zones}
        motors={motors}
        injectors={injectors}
        fertilizerProducts={fertilizerProducts}
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
              {Number(editJob?.on_duration_minutes) > 0 && !(Number(editJob?.target_liters) > 0) ? (
                <TextField
                  fullWidth
                  label="Minutes"
                  type="number"
                  value={editJobForm.duration_minutes}
                  onChange={(e) => setEditJobForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                  inputProps={{ min: 1, step: 1 }}
                />
              ) : (
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
              )}
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
