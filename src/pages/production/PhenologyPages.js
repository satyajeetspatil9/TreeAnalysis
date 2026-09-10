import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, FormControl, Grid, InputLabel, MenuItem, Paper, Select,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import { TREE_LIST_SELECT } from '../../utils/schema';
import { loadFarmTrees } from '../../utils/farmScope';
import { resolveStage } from '../../utils/farmClimateLogic';
import { loadFarmClimateSnapshot } from '../../utils/farmClimateData';

function PhenologyPage({ kind }) {
  const isFlowering = kind === 'flowering';
  const table = isFlowering ? 'flowering_events' : 'fruit_set_observations';
  const { farm } = useFarm();
  const [trees, setTrees] = useState([]);
  const [records, setRecords] = useState([]);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState('');
  const [gdd, setGdd] = useState(null);
  const [form, setForm] = useState({
    tree_id: '',
    observed_on: new Date().toISOString().slice(0, 10),
    notes: '',
    fruit_count: '',
  });

  const treeIds = useMemo(() => trees.map((t) => t.id), [trees]);

  const loadMeta = useCallback(async () => {
    if (!farm) {
      setTrees([]);
      return;
    }
    try {
      const data = await loadFarmTrees(supabase, farm.id, { select: TREE_LIST_SELECT });
      setTrees(data || []);
      const snapshot = await loadFarmClimateSnapshot(supabase, farm, data || [], 'Mango');
      setGdd(snapshot.gdd);
      setStage(resolveStage('Mango', snapshot.gdd));
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      setTrees([]);
    }
  }, [farm]);

  const loadRecords = useCallback(async () => {
    if (!treeIds.length) {
      setRecords([]);
      return;
    }
    const { data, error } = await supabase
      .from(table)
      .select('*, trees(tree_positions(position_code))')
      .in('tree_id', treeIds)
      .order('observed_on', { ascending: false });
    if (error) {
      setMessage({ type: 'error', text: `${error.message} Run supabase/migrations/051_production_climate_phenology.sql` });
      setRecords([]);
      return;
    }
    setRecords(data || []);
  }, [table, treeIds]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { loadRecords(); }, [loadRecords]);

  const handleSave = async () => {
    if (!form.tree_id) {
      setMessage({ type: 'error', text: 'Select a tree.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    const payload = {
      tree_id: form.tree_id,
      observed_on: form.observed_on,
      notes: form.notes || null,
      gdd_total: gdd,
      growth_stage: stage,
    };
    if (!isFlowering) {
      payload.fruit_count = form.fruit_count !== '' ? Number(form.fruit_count) : null;
    }
    const { error } = await supabase.from(table).insert([payload]);
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: `${error.message} Run supabase/migrations/051_production_climate_phenology.sql` });
      return;
    }
    setForm({
      tree_id: '',
      observed_on: new Date().toISOString().slice(0, 10),
      notes: '',
      fruit_count: '',
    });
    await loadRecords();
    setMessage({ type: 'success', text: isFlowering ? 'Flowering recorded.' : 'Fruit set recorded.' });
  };

  return (
    <Box>
      <PageHeader
        section="Production"
        title={isFlowering ? 'Flowering' : 'Fruit set'}
        subtitle={isFlowering
          ? 'Mark bloom against this season’s GDD so harvest can be compared later.'
          : 'Record fruit set while GDD stage is stored with the observation.'}
      />
      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
      {(stage || gdd != null) && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Current climate stage: {stage || '—'} · GDD {formatNumber(gdd, 0)}
        </Typography>
      )}
      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth required>
              <InputLabel>Tree</InputLabel>
              <Select
                value={form.tree_id}
                label="Tree"
                onChange={(e) => setForm({ ...form, tree_id: e.target.value })}
              >
                {trees.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{getTreeDisplayId(t)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Date"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={form.observed_on}
              onChange={(e) => setForm({ ...form, observed_on: e.target.value })}
            />
          </Grid>
          {!isFlowering && (
            <Grid item xs={12} md={2}>
              <TextField
                label="Fruit count"
                type="number"
                fullWidth
                value={form.fruit_count}
                onChange={(e) => setForm({ ...form, fruit_count: e.target.value })}
              />
            </Grid>
          )}
          <Grid item xs={12} md={isFlowering ? 5 : 3}>
            <TextField
              label="Notes"
              fullWidth
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Grid>
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={handleSave} disabled={saving || !farm}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Paper>
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Tree</TableCell>
              <TableCell>Date</TableCell>
              {!isFlowering && <TableCell>Fruit count</TableCell>}
              <TableCell>Stage / GDD</TableCell>
              <TableCell>Notes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.trees?.tree_positions?.position_code}</TableCell>
                <TableCell>{formatDate(row.observed_on)}</TableCell>
                {!isFlowering && <TableCell>{row.fruit_count ?? '—'}</TableCell>}
                <TableCell>{row.growth_stage || '—'} · {formatNumber(row.gdd_total, 0)}</TableCell>
                <TableCell>{row.notes || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export function FloweringPage() {
  return <PhenologyPage kind="flowering" />;
}

export function FruitSetPage() {
  return <PhenologyPage kind="fruit-set" />;
}

export default FloweringPage;
