import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import { TREE_LIST_SELECT } from '../../utils/schema';
import { resolveStage } from '../../utils/farmClimateLogic';
import { loadFarmClimateSnapshot } from '../../utils/farmClimateData';
import { npkTargetsForStage } from '../../utils/fertilizerStage';
import { getLatestObservationByTree } from '../../utils/soil';
import { treeDashboardUrl } from '../../utils/treeDashboard';
import {
  formatSuggestedInputNames,
  lowNutrientLabels,
  mergeTreeNutrientProfile,
  suggestFertilizerInputs,
} from '../../utils/farmInputCatalog';

function sortPlans(plans) {
  return plans.slice().sort((a, b) => a.treeLabel.localeCompare(b.treeLabel, undefined, { numeric: true }));
}

function FertilizerOptimizerPage() {
  const { farm } = useFarm();
  const [message, setMessage] = useState(null);
  const [lab, setLab] = useState(null);
  const [stage, setStage] = useState('');
  const [gdd, setGdd] = useState(null);
  const [plans, setPlans] = useState([]);
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
      .eq('status', 'Active');

    const { data: observations } = await supabase
      .from('soil_observations')
      .select('tree_id, nitrogen, phosphorus, potassium, ph, observed_at')
      .order('observed_at', { ascending: false })
      .limit(2000);

    const snapshot = await loadFarmClimateSnapshot(supabase, farm, trees || [], 'Mango');
    const nextStage = resolveStage('Mango', snapshot.gdd);
    setGdd(snapshot.gdd);
    setStage(nextStage);

    const latestByTree = getLatestObservationByTree(observations || []);
    const nextPlans = (trees || []).map((tree) => {
      const observation = latestByTree[tree.id] || null;
      const profile = mergeTreeNutrientProfile(observation, latestLab || {});
      const products = suggestFertilizerInputs(profile, nextStage);
      const targets = npkTargetsForStage(nextStage, profile);
      const treeLabel = getTreeDisplayId(tree);
      const lows = lowNutrientLabels(profile);
      return {
        tree,
        treeLabel,
        observation,
        profile,
        products,
        targets,
        lows,
      };
    });
    setPlans(sortPlans(nextPlans));

    const { data: recs, error } = await supabase
      .from('fertilizer_recommendations')
      .select('*, trees(tree_positions(position_code))')
      .order('recommended_date', { ascending: false })
      .limit(200);
    if (error) {
      setMessage({ type: 'error', text: `${error.message} Run supabase/migrations/051_production_climate_phenology.sql` });
      setRows([]);
      return;
    }
    setRows(recs || []);
  }, [farm]);

  useEffect(() => { load(); }, [load]);

  const treesNeedingInputs = useMemo(
    () => plans.filter((plan) => plan.products.length > 0),
    [plans]
  );

  const generate = async () => {
    if (!farm) return;
    if (!plans.length) {
      setMessage({ type: 'error', text: 'Add active trees before generating recommendations.' });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const payload = plans.map((plan) => {
      const productNote = formatSuggestedInputNames(plan.products);
      const gapNote = plan.lows.length
        ? `Low: ${plan.lows.join(', ')}.`
        : 'No nutrient gaps on the latest tree reading.';
      return {
        tree_id: plan.tree.id,
        recommended_date: today,
        growth_stage: stage,
        target_n: plan.targets.n,
        target_p: plan.targets.p,
        target_k: plan.targets.k,
        recommended_products: plan.products,
        status: 'Draft',
        notes: `${gapNote} ${plan.targets.notes}${productNote !== '—' ? ` Inputs: ${productNote}.` : ''}`,
      };
    });
    setSaving(true);
    const { error } = await supabase.from('fertilizer_recommendations').insert(payload);
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: `${error.message} Run supabase/migrations/051_production_climate_phenology.sql` });
      return;
    }
    setMessage({
      type: 'success',
      text: `Saved ${payload.length} tree draft${payload.length === 1 ? '' : 's'} (${treesNeedingInputs.length} with inputs).`,
    });
    await load();
  };

  return (
    <Box>
      <PageHeader
        section="Inputs"
        title="Fertilizer recommendation"
        subtitle="One draft per tree from that tree’s latest soil reading. Only inputs that close a low nutrient are listed."
        action={(
          <Button variant="contained" onClick={generate} disabled={saving || !farm || !plans.length}>
            {saving ? 'Saving…' : 'Generate per tree'}
          </Button>
        )}
      />
      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2">
          Stage {stage || '—'} · GDD {formatNumber(gdd, 0)}
          {lab ? ` · Farm lab ${formatDate(lab.sample_date)}` : ' · No farm lab report yet'}
          {` · ${treesNeedingInputs.length} of ${plans.length} tree${plans.length === 1 ? '' : 's'} need inputs`}
        </Typography>
        <Button component={RouterLink} to="/orchard/soil-report" size="small" sx={{ mt: 1, mr: 1 }}>
          Add soil lab report
        </Button>
        <Button component={RouterLink} to="/admin/farm-inputs" size="small" sx={{ mt: 1 }}>
          Available inputs
        </Button>
      </Paper>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="h6">Per-tree nutrient needs</Typography>
          <Typography variant="body2" color="text.secondary">
            Tree 7-in-1 N, P, K, and pH first. Farm lab fills OC, S, Zn, and B when the tree has no value.
          </Typography>
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Tree</TableCell>
              <TableCell>Low nutrients</TableCell>
              <TableCell>Inputs</TableCell>
              <TableCell>Last soil reading</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">No active trees.</TableCell>
              </TableRow>
            ) : (
              plans.map((plan) => (
                <TableRow key={plan.tree.id} hover>
                  <TableCell>
                    <Typography
                      component={RouterLink}
                      to={treeDashboardUrl(plan.treeLabel, 'soil')}
                      sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}
                    >
                      {plan.treeLabel}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {plan.lows.length ? (
                      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                        {plan.lows.map((label) => (
                          <Chip key={label} size="small" color="warning" label={label} />
                        ))}
                      </Stack>
                    ) : (
                      'None'
                    )}
                  </TableCell>
                  <TableCell>
                    {plan.products.length
                      ? plan.products.map((item) => item.name).join(', ')
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {plan.observation?.observed_at ? formatDate(plan.observation.observed_at) : 'No tree reading'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined">
        <Box sx={{ p: 2, pb: 0 }}>
          <Typography variant="h6" gutterBottom>Saved drafts</Typography>
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Tree</TableCell>
              <TableCell>Stage</TableCell>
              <TableCell>N</TableCell>
              <TableCell>P</TableCell>
              <TableCell>K</TableCell>
              <TableCell>Inputs</TableCell>
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
                <TableCell>{formatSuggestedInputNames(row.recommended_products)}</TableCell>
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
