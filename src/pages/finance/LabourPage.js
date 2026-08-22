import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Button, TextField, Grid, FormControl, InputLabel, Select, MenuItem, Alert, Typography,
} from '@mui/material';import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatCurrency, formatDate } from '../../utils/formatters';

function rlsHint(message) {
  if (!message?.includes('row-level security')) return message;
  return `${message} Re-run supabase/migrations/016_fix_labour_rls.sql in Supabase SQL Editor.`;
}

function schemaHint(message) {
  if (!message?.includes('male_workers') && !message?.includes('female_workers')) return message;
  return `${message} Run supabase/migrations/017_labour_gender_workers.sql in Supabase SQL Editor.`;
}

function calcLabourAmount({ male_workers, female_workers, male_wage, female_wage }) {
  const maleCount = Number(male_workers) || 0;
  const femaleCount = Number(female_workers) || 0;
  const maleRate = Number(male_wage) || 0;
  const femaleRate = Number(female_wage) || 0;
  return maleCount * maleRate + femaleCount * femaleRate;
}

function formatWorkerSummary(record) {
  const parts = [];
  if (record.male_workers) parts.push(`${record.male_workers} male`);
  if (record.female_workers) parts.push(`${record.female_workers} female`);
  if (parts.length) return parts.join(', ');
  if (record.worker_name) return record.worker_name;
  return '—';
}

function labourRecordAmount(record) {
  if (record.amount != null && record.amount !== '') return Number(record.amount) || 0;
  return calcLabourAmount(record);
}

function LabourPage() {
  const { farm } = useFarm();
  const [records, setRecords] = useState([]);
  const [zones, setZones] = useState([]);
  const [trees, setTrees] = useState([]);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    event_date: new Date().toISOString().slice(0, 10),
    work_type: 'Weeding',
    male_workers: '',
    female_workers: '',
    male_wage: '',
    female_wage: '',
    scope: 'zone',
    scope_id: '',
    notes: '',
  });

  const load = useCallback(async () => {
    if (!farm) {
      setRecords([]);
      setZones([]);
      setTrees([]);
      return;
    }

    const { data } = await supabase
      .from('labour_events')
      .select('*')
      .order('event_date', { ascending: false })
      .limit(50);
    setRecords(data || []);

    const { data: z } = await supabase
      .from('irrigation_zones')
      .select('id, zone_code')
      .eq('farm_id', farm.id)
      .order('zone_code');
    setZones(z || []);

    const { data: t } = await supabase
      .from('trees')
      .select('id, tree_positions(position_code)')
      .eq('status', 'Active');
    setTrees(t || []);
  }, [farm]);

  useEffect(() => {
    load();
  }, [load]);

  const formTotal = useMemo(() => calcLabourAmount(form), [form]);
  const formWageBreakdown = useMemo(() => {
    const parts = [
      Number(form.male_workers) > 0 && `${Number(form.male_workers)} × ${formatCurrency(Number(form.male_wage) || 0)}`,
      Number(form.female_workers) > 0 && `${Number(form.female_workers)} × ${formatCurrency(Number(form.female_wage) || 0)}`,
    ].filter(Boolean);
    return parts.length ? parts.join(' + ') : 'Enter workers and wages to calculate';
  }, [form]);
  const totalWages = useMemo(
    () => records.reduce((sum, record) => sum + labourRecordAmount(record), 0),
    [records],
  );

  const handleSave = async () => {
    if (!farm) {
      setMessage({ type: 'error', text: 'Create a farm in Settings before recording labour.' });
      return;
    }
    if (!form.scope_id) {
      setMessage({ type: 'error', text: `Select a ${form.scope === 'tree' ? 'tree' : 'zone'}.` });
      return;
    }

    const maleWorkers = Number(form.male_workers) || 0;
    const femaleWorkers = Number(form.female_workers) || 0;
    const maleWage = Number(form.male_wage) || 0;
    const femaleWage = Number(form.female_wage) || 0;

    if (maleWorkers <= 0 && femaleWorkers <= 0) {
      setMessage({ type: 'error', text: 'Enter at least one male or female worker count.' });
      return;
    }
    if (maleWorkers > 0 && maleWage <= 0) {
      setMessage({ type: 'error', text: 'Enter wage for male workers.' });
      return;
    }
    if (femaleWorkers > 0 && femaleWage <= 0) {
      setMessage({ type: 'error', text: 'Enter wage for female workers.' });
      return;
    }

    const amount = calcLabourAmount(form);
    const payload = {
      event_date: form.event_date,
      work_type: form.work_type,
      male_workers: maleWorkers || null,
      female_workers: femaleWorkers || null,
      male_wage: maleWorkers > 0 ? maleWage : null,
      female_wage: femaleWorkers > 0 ? femaleWage : null,
      amount,
      notes: form.notes.trim() || null,
      zone_id: null,
      tree_id: null,
    };

    if (form.scope === 'zone') payload.zone_id = Number(form.scope_id);
    if (form.scope === 'tree') payload.tree_id = form.scope_id;

    setSaving(true);
    setMessage(null);

    const { error } = await supabase.from('labour_events').insert([payload]);
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: schemaHint(rlsHint(error.message)) });
      return;
    }

    setMessage({ type: 'success', text: 'Labour recorded.' });
    setForm({
      ...form,
      male_workers: '',
      female_workers: '',
      male_wage: '',
      female_wage: '',
      scope_id: '',
      notes: '',
    });
    load();
  };

  return (
    <Box>
      <PageHeader
        section="Finance"
        title="Labour"
        subtitle="Record field work with male/female worker counts and wages."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Create a farm in Settings before recording labour.</Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField
              label="Date"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Work type"
              fullWidth
              value={form.work_type}
              onChange={(e) => setForm({ ...form, work_type: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth disabled={!farm}>
              <InputLabel>Apply to</InputLabel>
              <Select
                value={form.scope}
                label="Apply to"
                onChange={(e) => setForm({ ...form, scope: e.target.value, scope_id: '' })}
              >
                <MenuItem value="zone">Zone</MenuItem>
                <MenuItem value="tree">Tree</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          {form.scope === 'zone' && (
            <Grid item xs={12} md={3}>
              <FormControl fullWidth required disabled={!farm}>
                <InputLabel>Zone</InputLabel>
                <Select
                  value={form.scope_id}
                  label="Zone"
                  onChange={(e) => setForm({ ...form, scope_id: e.target.value })}
                >
                  {zones.map((z) => (
                    <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          {form.scope === 'tree' && (
            <Grid item xs={12} md={3}>
              <FormControl fullWidth required disabled={!farm}>
                <InputLabel>Tree</InputLabel>
                <Select
                  value={form.scope_id}
                  label="Tree"
                  onChange={(e) => setForm({ ...form, scope_id: e.target.value })}
                >
                  {trees.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.tree_positions?.position_code}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle2" gutterBottom>Male workers</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    label="Workers"
                    type="number"
                    fullWidth
                    inputProps={{ min: 0 }}
                    value={form.male_workers}
                    onChange={(e) => setForm({ ...form, male_workers: e.target.value })}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Wage"
                    type="number"
                    fullWidth
                    value={form.male_wage}
                    onChange={(e) => setForm({ ...form, male_wage: e.target.value })}
                    helperText="Per worker"
                  />
                </Grid>
              </Grid>
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle2" gutterBottom>Female workers</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    label="Workers"
                    type="number"
                    fullWidth
                    inputProps={{ min: 0 }}
                    value={form.female_workers}
                    onChange={(e) => setForm({ ...form, female_workers: e.target.value })}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Wage"
                    type="number"
                    fullWidth
                    value={form.female_wage}
                    onChange={(e) => setForm({ ...form, female_wage: e.target.value })}
                    helperText="Per worker"
                  />
                </Grid>
              </Grid>
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle2" gutterBottom>Total wages</Typography>
              <TextField
                label="Amount"
                fullWidth
                value={formatCurrency(formTotal)}
                InputProps={{ readOnly: true }}
                helperText={formWageBreakdown}
              />
            </Paper>
          </Grid>
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={handleSave} disabled={saving || !farm || formTotal <= 0}>
          Save Labour
        </Button>
      </Paper>

      <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
        <Typography variant="overline">Total wages</Typography>
        <Typography variant="h5">{formatCurrency(totalWages)}</Typography>
        <Typography variant="caption" color="text.secondary">
          Sum of {records.length} labour record{records.length === 1 ? '' : 's'} shown below
        </Typography>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Work</TableCell>
              <TableCell>Workers</TableCell>
              <TableCell align="right">Male wage</TableCell>
              <TableCell align="right">Female wage</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.event_date)}</TableCell>
                <TableCell>{r.work_type}</TableCell>
                <TableCell>{formatWorkerSummary(r)}</TableCell>
                <TableCell align="right">{r.male_wage != null ? formatCurrency(r.male_wage) : '—'}</TableCell>
                <TableCell align="right">{r.female_wage != null ? formatCurrency(r.female_wage) : '—'}</TableCell>
                <TableCell align="right">{formatCurrency(labourRecordAmount(r))}</TableCell>
              </TableRow>
            ))}
            {records.length === 0 && (
              <TableRow><TableCell colSpan={6}>No labour records yet.</TableCell></TableRow>
            )}
            {records.length > 0 && (
              <TableRow>
                <TableCell colSpan={5} align="right"><strong>Total wages</strong></TableCell>
                <TableCell align="right"><strong>{formatCurrency(totalWages)}</strong></TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default LabourPage;
