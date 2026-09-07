import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
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
import PageHeader from '../../components/common/PageHeader';
import SensorCard from '../../components/farm-climate/SensorCard';
import CropStageStatus from '../../components/farm-climate/CropStageStatus';
import RiskPanel from '../../components/farm-climate/RiskPanel';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import { TREE_LIST_SELECT, getIrrigationZoneId } from '../../utils/schema';
import { analyzeRisks, resolveStage } from '../../utils/farmClimateLogic';
import { dailyGddFromSensors, loadFarmClimateSnapshot } from '../../utils/farmClimateData';
import { createClimateWorkItem } from '../../utils/climateWork';
import { formatDate, formatNumber } from '../../utils/formatters';

function formatValue(val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'number') return val.toFixed(1);
  const n = Number(val);
  return Number.isFinite(n) ? n.toFixed(1) : String(val);
}

function FarmClimatePage() {
  const { farm } = useFarm();
  const navigate = useNavigate();
  const [crop, setCrop] = useState('Mango');
  const [snapshot, setSnapshot] = useState(null);
  const [trees, setTrees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [workMessage, setWorkMessage] = useState(null);
  const [creatingType, setCreatingType] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    let orchardTrees = [];
    if (farm?.id) {
      const { data } = await supabase
        .from('trees')
        .select(TREE_LIST_SELECT)
        .eq('status', 'Active')
        .limit(80);
      orchardTrees = data || [];
      setTrees(orchardTrees);
    }
    const result = await loadFarmClimateSnapshot(supabase, farm, orchardTrees, crop);
    const stage = resolveStage(crop, result.gdd);
    const warnings = analyzeRisks(result.sensors, crop, stage, result.isOverMoisture3Days);
    setSnapshot({
      ...result,
      stage,
      warnings,
    });
    setLastUpdated(new Date());
    setLoading(false);
  }, [farm, crop]);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => { load(); }, 60000);
    return () => window.clearInterval(interval);
  }, [load]);

  const handleCreateWork = async (warning) => {
    const tree = trees[0];
    setCreatingType(warning.type);
    setWorkMessage(null);
    const result = await createClimateWorkItem(supabase, {
      treeId: tree?.id || null,
      zoneId: tree ? getIrrigationZoneId(tree) : null,
      warning,
    });
    setCreatingType(null);
    if (result.error) {
      setWorkMessage({ type: 'error', text: `${result.error} Run supabase/migrations/051_production_climate_phenology.sql if this is an RLS error.` });
      return;
    }
    setWorkMessage({ type: 'success', text: 'Work item saved to Alerts. Opening the related page.' });
    if (result.path) navigate(result.path);
  };

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
  const dailyGDD = dailyGddFromSensors(sensors);

  return (
    <Box>
      <PageHeader
        section="Orchard"
        title="Farm climate"
        subtitle="This orchard’s weather, soil, Open-Meteo forecast, and GDD stage — then turn advisories into work."
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

      {workMessage && (
        <Alert severity={workMessage.type} sx={{ mb: 2 }} onClose={() => setWorkMessage(null)}>
          {workMessage.text}
        </Alert>
      )}

      {!snapshot?.gps && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Set farm latitude/longitude in Settings (or add tree GPS) so Climate can pull Open-Meteo for this orchard.
        </Alert>
      )}

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
        <Chip size="small" color={snapshot?.isMock ? 'warning' : 'success'} label={snapshot?.source || 'Climate'} />
        {snapshot?.seasonStart && (
          <Typography variant="caption" color="text.secondary">
            GDD from {formatDate(snapshot.seasonStart)}
          </Typography>
        )}
        {lastUpdated && (
          <Typography variant="caption" color="text.secondary">
            Updated {lastUpdated.toLocaleTimeString()}
          </Typography>
        )}
        {snapshot?.observedAt && (
          <Typography variant="caption" color="text.secondary">
            Reading {formatDate(snapshot.observedAt)}
          </Typography>
        )}
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
          <Grid container spacing={2} sx={{ mb: 2 }}>
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
          {snapshot?.forecast?.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Next 7 days (Open-Meteo)</Typography>
              <Grid container spacing={1}>
                {snapshot.forecast.map((day) => (
                  <Grid item xs={6} sm={3} md={true} key={day.date} sx={{ flex: { md: 1 } }}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {formatDate(day.date)}
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {formatNumber(day.tmax, 0)}° / {formatNumber(day.tmin, 0)}°
                    </Typography>
                    <Typography variant="caption" display="block">
                      Rain {formatNumber(day.rain, 1)} mm
                    </Typography>
                    <Typography variant="caption" display="block">
                      Wind {formatNumber(day.wind, 0)} km/h
                    </Typography>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          )}
        </Grid>
        <Grid item xs={12} lg={4}>
          <RiskPanel
            warnings={warnings}
            onCreateWork={handleCreateWork}
            creatingType={creatingType}
          />
        </Grid>
      </Grid>
    </Box>
  );
}

export default FarmClimatePage;
