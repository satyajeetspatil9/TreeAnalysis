import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import GrassIcon from '@mui/icons-material/Grass';
import EnergySavingsLeafIcon from '@mui/icons-material/EnergySavingsLeaf';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import UmbrellaIcon from '@mui/icons-material/Umbrella';
import AirIcon from '@mui/icons-material/Air';
import CloudIcon from '@mui/icons-material/Cloud';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import SensorCard from '../../components/farm-climate/SensorCard';
import CropStageStatus from '../../components/farm-climate/CropStageStatus';
import RiskPanel from '../../components/farm-climate/RiskPanel';
import { analyzeRisks, calculateDailyGDD, resolveStage } from '../../utils/farmClimateLogic';
import { loadFarmClimateSnapshot } from '../../utils/farmClimateData';
import { formatDate } from '../../utils/formatters';

function formatValue(val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'number') return val.toFixed(1);
  const n = Number(val);
  return Number.isFinite(n) ? n.toFixed(1) : String(val);
}

function FarmClimatePage() {
  const { farm } = useFarm();
  const [crop, setCrop] = useState('Mango');
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await loadFarmClimateSnapshot(supabase, farm?.id);
    const stage = resolveStage(crop, result.gdd);
    const warnings = analyzeRisks(result.sensors, crop, stage, result.isOverMoisture3Days);
    setSnapshot({
      ...result,
      stage,
      warnings,
    });
    setLoading(false);
  }, [farm?.id, crop]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !snapshot) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const sensors = snapshot?.sensors || {};
  const gdd = snapshot?.gdd || 0;
  const stage = snapshot?.stage || resolveStage(crop, gdd);
  const warnings = snapshot?.warnings || [];
  const isFog = sensors.Humidity > 90 && sensors.Lux < 2000 && sensors.Leaf_wetness >= 4;
  const dailyGDD = calculateDailyGDD(
    Number(sensors.Air_Temperature) + 5,
    Number(sensors.Air_Temperature) - 5,
  ).toFixed(1);

  return (
    <Box>
      <PageHeader
        section="Orchard"
        title="Farm climate"
        subtitle="GDD, field sensors, and spray / disease advisories from FarmClimateGUI."
        action={(
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={load}
            disabled={loading}
          >
            Refresh
          </Button>
        )}
      />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={crop}
          onChange={(_, next) => { if (next) setCrop(next); }}
        >
          <ToggleButton value="Mango">Mango</ToggleButton>
          <ToggleButton value="Cashew">Cashew</ToggleButton>
        </ToggleButtonGroup>
        {snapshot?.isMock && (
          <Chip size="small" color="warning" label="Demo readings — log weather in Settings" />
        )}
        {!snapshot?.isMock && snapshot?.observedAt && (
          <Typography variant="caption" color="text.secondary">
            Latest observation {formatDate(snapshot.observedAt)}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {farm?.name || 'This farm'}
        </Typography>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <Box sx={{ mb: 2 }}>
            <CropStageStatus crop={crop} gdd={gdd} stage={stage} dailyGDD={dailyGDD} />
          </Box>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={3}>
              <SensorCard
                label="Air temperature"
                value={formatValue(sensors.Air_Temperature)}
                unit="°C"
                subLabel="Soil temperature"
                subValue={formatValue(sensors.Soil_Temperature)}
                icon={ThermostatIcon}
                color={sensors.Air_Temperature > 35 || sensors.Air_Temperature < 10 ? 'red' : 'orange'}
                status={sensors.Air_Temperature > 30 ? 'warning' : 'normal'}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <SensorCard
                label="Relative humidity"
                value={formatValue(sensors.Humidity)}
                unit="%"
                icon={WaterDropIcon}
                color="blue"
                status={sensors.Humidity > 90 ? 'critical' : 'normal'}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <SensorCard
                label="Soil moisture"
                value={formatValue(sensors.Soil_Moisture)}
                unit="%"
                icon={GrassIcon}
                color="green"
                status={sensors.Soil_Moisture > 70 ? 'warning' : 'normal'}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <SensorCard
                label="Leaf wetness"
                value={formatValue(sensors.Leaf_wetness)}
                unit="hrs"
                icon={EnergySavingsLeafIcon}
                color="cyan"
                status={sensors.Leaf_wetness >= 4 ? 'warning' : 'normal'}
              />
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <SensorCard
                label="Light intensity"
                value={sensors.Lux}
                unit="lux"
                icon={WbSunnyIcon}
                color="yellow"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <SensorCard
                label="Rainfall"
                value={formatValue(sensors.Rain_mm)}
                unit="mm"
                icon={UmbrellaIcon}
                color="blue"
                status={sensors.Rain_mm > 0 ? 'critical' : 'normal'}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <SensorCard
                label="Wind speed"
                value={formatValue(sensors.Wind_speed)}
                unit="km/h"
                subLabel="Direction"
                subValue={formatValue(sensors.Wind_direction)}
                subUnit="°"
                icon={AirIcon}
                color="gray"
                status={sensors.Wind_speed > 10 ? 'critical' : 'normal'}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <SensorCard
                label="Fog status"
                value={isFog ? 'DETECTED' : 'CLEAR'}
                unit=""
                icon={CloudIcon}
                color={isFog ? 'red' : 'green'}
                status={isFog ? 'critical' : 'normal'}
              />
            </Grid>
          </Grid>
        </Grid>
        <Grid item xs={12} lg={4}>
          <RiskPanel warnings={warnings} />
        </Grid>
      </Grid>
    </Box>
  );
}

export default FarmClimatePage;
