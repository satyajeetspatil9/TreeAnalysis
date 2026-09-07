import React, { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Chip, Stack } from '@mui/material';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import { TREE_LIST_SELECT } from '../../utils/schema';
import { analyzeRisks, resolveStage } from '../../utils/farmClimateLogic';
import { loadFarmClimateSnapshot } from '../../utils/farmClimateData';
import { fetchGpsSatelliteStats } from '../../utils/treeGpsSatelliteCache';

function ProductionCockpit() {
  const { farm } = useFarm();
  const [chips, setChips] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!farm) return;
      const { data: trees } = await supabase
        .from('trees')
        .select(TREE_LIST_SELECT)
        .eq('status', 'Active')
        .limit(40);
      const snapshot = await loadFarmClimateSnapshot(supabase, farm, trees || [], 'Mango');
      const stage = resolveStage('Mango', snapshot.gdd);
      const warnings = analyzeRisks(snapshot.sensors, 'Mango', stage, snapshot.isOverMoisture3Days);
      const spray = warnings.find((w) => w.type === 'SPRAY' || w.type === 'SPRAY_WINDOW');
      const irrigate = warnings.find((w) => w.type === 'IRRIGATION' || w.type === 'ROOT_STRESS');
      let satelliteLabel = 'Satellite: cache';
      try {
        const stats = await fetchGpsSatelliteStats(supabase, farm.id);
        if (stats?.remaining > 0) satelliteLabel = `Satellite: ${stats.remaining} trees still this week`;
        else if (stats?.cached != null) satelliteLabel = `Satellite: ${stats.cached} trees cached`;
      } catch {
        satelliteLabel = 'Satellite: see Monitoring';
      }
      if (cancelled) return;
      setChips([
        spray
          ? { color: spray.type === 'SPRAY' ? 'error' : 'success', label: spray.type === 'SPRAY' ? 'Do not spray today' : 'Spray window', to: '/orchard/climate' }
          : { color: 'default', label: 'No spray advisory', to: '/orchard/climate' },
        irrigate
          ? { color: 'warning', label: 'Irrigation caution', to: '/orchard/irrigation' }
          : { color: 'default', label: 'Irrigation: no climate flag', to: '/orchard/irrigation' },
        { color: 'info', label: satelliteLabel, to: '/monitoring/satellite' },
      ]);
    }
    load();
    return () => { cancelled = true; };
  }, [farm]);

  if (!chips.length) return null;

  return (
    <Alert
      severity="info"
      sx={{ mb: 3 }}
      action={(
        <Button component={RouterLink} to="/orchard/climate" color="inherit" size="small">
          Climate
        </Button>
      )}
    >
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {chips.map((chip) => (
          <Chip
            key={chip.label}
            component={RouterLink}
            to={chip.to}
            clickable
            size="small"
            color={chip.color}
            label={chip.label}
          />
        ))}
      </Stack>
    </Alert>
  );
}

export default ProductionCockpit;
