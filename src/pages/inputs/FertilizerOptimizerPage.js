import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import { TREE_LIST_SELECT } from '../../utils/schema';
import { loadFarmTrees } from '../../utils/farmScope';
import { resolveStage } from '../../utils/farmClimateLogic';
import { loadFarmClimateSnapshot } from '../../utils/farmClimateData';
import { getLatestObservationByTree } from '../../utils/soil';
import { treeDashboardUrl } from '../../utils/treeDashboard';
import {
  lowNutrientLabels,
  mergeTreeNutrientProfile,
  suggestFertilizerInputs,
} from '../../utils/farmInputCatalog';

function sortPlans(plans) {
  return plans.slice().sort((a, b) => a.treeLabel.localeCompare(b.treeLabel, undefined, { numeric: true }));
}

function FertilizerOptimizerPage() {
  const { farm } = useFarm();
  const [lab, setLab] = useState(null);
  const [stage, setStage] = useState('');
  const [gdd, setGdd] = useState(null);
  const [plans, setPlans] = useState([]);

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

    const trees = await loadFarmTrees(supabase, farm.id, { select: TREE_LIST_SELECT });
    const treeIds = (trees || []).map((t) => t.id);
    let observations = [];
    if (treeIds.length) {
      const { data } = await supabase
        .from('soil_observations')
        .select('tree_id, nitrogen, phosphorus, potassium, ph, observed_at')
        .in('tree_id', treeIds)
        .order('observed_at', { ascending: false })
        .limit(2000);
      observations = data || [];
    }

    const snapshot = await loadFarmClimateSnapshot(supabase, farm, trees || [], 'Mango');
    const nextStage = resolveStage('Mango', snapshot.gdd);
    setGdd(snapshot.gdd);
    setStage(nextStage);

    const latestByTree = getLatestObservationByTree(observations || []);
    const nextPlans = (trees || [])
      .map((tree) => {
        const observation = latestByTree[tree.id] || null;
        if (!observation?.observed_at) return null;
        const profile = mergeTreeNutrientProfile(observation, latestLab || {});
        return {
          tree,
          treeLabel: getTreeDisplayId(tree),
          observation,
          products: suggestFertilizerInputs(profile, nextStage),
          lows: lowNutrientLabels(profile),
        };
      })
      .filter(Boolean);
    setPlans(sortPlans(nextPlans));
  }, [farm]);

  useEffect(() => { load(); }, [load]);

  const treesNeedingInputs = useMemo(
    () => plans.filter((plan) => plan.products.length > 0),
    [plans]
  );

  return (
    <Box>
      <PageHeader
        section="Inputs"
        title="Fertilizer recommendation"
        subtitle="Trees with a soil reading. Only inputs that close a low nutrient on that tree are listed."
      />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2">
          Stage {stage || '—'} · GDD {formatNumber(gdd, 0)}
          {lab ? ` · Farm lab ${formatDate(lab.sample_date)}` : ' · No farm lab report yet'}
          {` · ${treesNeedingInputs.length} of ${plans.length} tree${plans.length === 1 ? '' : 's'} with a reading need inputs`}
        </Typography>
        <Button component={RouterLink} to="/orchard/soil-report" size="small" sx={{ mt: 1, mr: 1 }}>
          Add soil lab report
        </Button>
        <Button component={RouterLink} to="/admin/farm-inputs" size="small" sx={{ mt: 1 }}>
          Available inputs
        </Button>
      </Paper>

      <Paper variant="outlined">
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
                <TableCell colSpan={4} align="center">No trees with a soil reading yet.</TableCell>
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
                  <TableCell>{formatDate(plan.observation.observed_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default FertilizerOptimizerPage;
