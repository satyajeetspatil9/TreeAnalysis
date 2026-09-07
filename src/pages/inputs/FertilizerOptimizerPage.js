import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import { TREE_LIST_SELECT, getIrrigationZoneId, getIrrigationZoneCode } from '../../utils/schema';
import { resolveStage } from '../../utils/farmClimateLogic';
import { loadFarmClimateSnapshot } from '../../utils/farmClimateData';
import { npkTargetsForStage } from '../../utils/fertilizerStage';

function FertilizerOptimizerPage() {
  const { farm } = useFarm();
  const [message, setMessage] = useState(null);
  const [lab, setLab] = useState(null);
  const [stage, setStage] = useState('');
  const [gdd, setGdd] = useState(null);
  const [targets, setTargets] = useState(null);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!farm?.id) return;
    const { data: labRows } = await supabase
      .from('farm_soil_lab_reports')
      .select('*')
      .eq('farm_id', farm.id)
      .order('sample_date', { ascending: false })
      .limit(1);
    const latestLab = labRows?.[0] || null;
    setLab(latestLab);

    const { data: trees } = await supabase
      .from('trees')
      .select(TREE_LIST_SELECT)
      .eq('status', 'Active')
      .limit(40);
    const snapshot = await loadFarmClimateSnapshot(supabase, farm, trees || [], 'Mango');
    const nextStage = resolveStage('Mango', snapshot.gdd);
    setGdd(snapshot.gdd);
    setStage(nextStage);
    setTargets(npkTargetsForStage(nextStage, latestLab || {}));

    const { data: recs, error } = await supabase
      .from('fertilizer_recommendations')
      .select('*, trees(tree_positions(position_code))')
      .order('recommended_date', { ascending: false })
      .limit(50);
    if (error) {
      setMessage({ type: 'error', text: `${error.message} Run supabase/migrations/051_production_climate_phenology.sql` });
      setRows([]);
      return;
    }
    setRows(recs || []);
  }, [farm]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!farm) return;
    const { data: trees, error: treeError } = await supabase
      .from('trees')
      .select(TREE_LIST_SELECT)
      .eq('status', 'Active')
      .limit(40);
    if (treeError) {
      setMessage({ type: 'error', text: treeError.message });
      return;
    }
    if (!trees?.length) {
      setMessage({ type: 'error', text: 'Add active trees before generating recommendations.' });
      return;
    }
    const snapshot = await loadFarmClimateSnapshot(supabase, farm, trees, 'Mango');
    const nextStage = resolveStage('Mango', snapshot.gdd);
    const nextTargets = npkTargetsForStage(nextStage, lab || {});
    const today = new Date().toISOString().slice(0, 10);
    const seenZones = new Set();
    const payload = [];
    trees.forEach((tree) => {
      const zoneId = getIrrigationZoneId(tree);
      const key = zoneId || tree.id;
      if (seenZones.has(key)) return;
      seenZones.add(key);
      payload.push({
        tree_id: tree.id,
        recommended_date: today,
        growth_stage: nextStage,
        target_n: nextTargets.n,
        target_p: nextTargets.p,
        target_k: nextTargets.k,
        status: 'Draft',
        notes: `${nextTargets.notes} Zone ${getIrrigationZoneCode(tree)}.`,
      });
    });
    setSaving(true);
    const { error } = await supabase.from('fertilizer_recommendations').insert(payload);
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: `${error.message} Run supabase/migrations/051_production_climate_phenology.sql` });
      return;
    }
    setMessage({ type: 'success', text: `Saved ${payload.length} draft recommendation${payload.length === 1 ? '' : 's'}.` });
    await load();
  };

  return (
    <Box>
      <PageHeader
        section="Inputs"
        title="Fertilizer recommendation"
        subtitle="One draft dose per irrigation zone from the latest farm lab report and current GDD stage."
        action={(
          <Button variant="contained" onClick={generate} disabled={saving || !farm}>
            {saving ? 'Saving…' : 'Generate from lab + stage'}
          </Button>
        )}
      />
      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2">
          Stage {stage || '—'} · GDD {formatNumber(gdd, 0)}
          {lab ? ` · Lab ${formatDate(lab.sample_date)}` : ' · No farm lab report yet'}
        </Typography>
        {targets && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Targets N {formatNumber(targets.n, 1)} · P {formatNumber(targets.p, 1)} · K {formatNumber(targets.k, 1)} kg/ha. {targets.notes}
          </Typography>
        )}
        <Button component={RouterLink} to="/orchard/soil-report" size="small" sx={{ mt: 1 }}>
          Add soil lab report
        </Button>
      </Paper>
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Tree</TableCell>
              <TableCell>Stage</TableCell>
              <TableCell>N</TableCell>
              <TableCell>P</TableCell>
              <TableCell>K</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Notes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDate(row.recommended_date)}</TableCell>
                <TableCell>{getTreeDisplayId(row.trees || {})}</TableCell>
                <TableCell>{row.growth_stage}</TableCell>
                <TableCell>{formatNumber(row.target_n, 1)}</TableCell>
                <TableCell>{formatNumber(row.target_p, 1)}</TableCell>
                <TableCell>{formatNumber(row.target_k, 1)}</TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell>{row.notes}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default FertilizerOptimizerPage;
