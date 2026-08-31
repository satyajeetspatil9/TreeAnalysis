import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, FormControl, Grid, InputLabel, MenuItem, Paper, Select,
  TextField, Typography,
} from '@mui/material';
import SensorsIcon from '@mui/icons-material/Sensors';
import { supabase } from '../../supabaseClient';
import { getTreeDisplayId } from '../../utils/formatters';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { LabReportFieldRow } from '../../components/soil/LabReportFieldRow';
import { SoilStandardsReference } from '../../components/soil/SoilNutrientDisplay';
import {
  SENSOR_READING_FIELDS,
  LAB_NUTRIENT_FIELDS,
  emptySensorForm,
  emptyLabForm,
  buildSensorObservationPayload,
  buildLabReportPayload,
  getSoilStandard,
  rlsHint,
  soilRangeFieldSx,
} from '../../utils/soil';
import { refreshSoilNutrientAlerts } from '../../utils/soilAlerts';
import { fetchSensorReadings, isSensorDemoMode, isWebBluetoothAvailable } from '../../utils/sensorFetch';

function readingsToSensorForm(readings) {
  const form = emptySensorForm();
  form.observed_at = readings.observed_at || form.observed_at;
  SENSOR_READING_FIELDS.forEach(({ key }) => {
    form[key] = readings[key] != null && !Number.isNaN(readings[key]) ? String(readings[key]) : '';
  });
  return form;
}

function AddSoilReportPage() {
  const { farm } = useFarm();
  const [trees, setTrees] = useState([]);
  const [message, setMessage] = useState(null);
  const [sensorForm, setSensorForm] = useState(emptySensorForm());
  const [labForm, setLabForm] = useState(emptyLabForm());
  const [selectedTreeId, setSelectedTreeId] = useState('');
  const [savingSensor, setSavingSensor] = useState(false);
  const [savingLab, setSavingLab] = useState(false);
  const [fetchingSensor, setFetchingSensor] = useState(false);
  const [sensorDeviceName, setSensorDeviceName] = useState(null);

  useEffect(() => {
    async function loadTrees() {
      const { data: treeData } = await supabase
        .from('trees')
        .select('id, tree_positions(position_code)')
        .eq('status', 'Active');
      setTrees((treeData || []).sort((a, b) =>
        getTreeDisplayId(a).localeCompare(getTreeDisplayId(b)),
      ));
    }
    loadTrees();
  }, []);

  const validateSensorForm = (form, treeId) => {
    if (!treeId) return 'Select a tree for this sensor reading.';
    const hasReading = SENSOR_READING_FIELDS.some(({ key }) => form[key] !== '' && form[key] != null);
    if (!hasReading) return 'Enter at least one sensor value.';
    return null;
  };

  const handleFetchSensor = async () => {
    setFetchingSensor(true);
    setMessage(null);
    setSensorDeviceName(null);

    try {
      const data = await fetchSensorReadings();
      setSensorForm(readingsToSensorForm(data));
      if (data._deviceName) {
        setSensorDeviceName(data._deviceName);
      }
      setMessage({ type: 'success', text: 'Sensor readings loaded from BLE. Review values, then save.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Could not fetch sensor data.' });
    } finally {
      setFetchingSensor(false);
    }
  };

  const handleSaveSensor = async () => {
    const validationError = validateSensorForm(sensorForm, selectedTreeId);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    setSavingSensor(true);
    setMessage(null);
    const payload = buildSensorObservationPayload(selectedTreeId, sensorForm);
    const { error } = await supabase.from('soil_observations').insert([payload]);
    setSavingSensor(false);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: '7-in-1 sensor reading saved.' });
    setSensorForm(emptySensorForm());
    await refreshSoilNutrientAlerts(supabase);
  };

  const handleSaveLab = async () => {
    if (!farm?.id) {
      setMessage({ type: 'error', text: 'Create a farm in Settings before saving a lab report.' });
      return;
    }

    const payload = buildLabReportPayload(farm.id, labForm);
    const hasValue = LAB_NUTRIENT_FIELDS.some(({ key }) => payload[key] != null);
    if (!hasValue) {
      setMessage({ type: 'error', text: 'Enter at least one lab result.' });
      return;
    }

    setSavingLab(true);
    setMessage(null);
    const { error } = await supabase.from('farm_soil_lab_reports').insert([payload]);
    setSavingLab(false);

    if (error) {
      const migration = error.message.includes('ph') || error.message.includes('nitrogen')
        ? '048_farm_soil_lab_ph_ec_npk.sql'
        : error.message.includes('copper')
          ? '011_soil_lab_nutrients_update.sql'
          : error.message.includes('farm_soil_lab_reports')
            ? '009_farm_soil_lab_reports.sql'
            : '010_fix_soil_observations_rls.sql';
      setMessage({ type: 'error', text: rlsHint(error.message, migration) });
      return;
    }

    setMessage({ type: 'success', text: 'Farm lab report saved. Micronutrients will show on all tree dashboards.' });
    setLabForm(emptyLabForm());
  };

  return (
    <Box>
      <PageHeader
        section="Farm Setting"
        title="Add Soil Report"
        subtitle="Record per-tree 7-in-1 sensor readings and farm-wide laboratory micronutrients."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Farm-wide lab reports need a farm in Settings. Sensor readings can still be saved per tree.
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
          Required Nutrient Ranges
        </Typography>
        <SoilStandardsReference compact />
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>7-in-1 Sensor — Per Tree</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Monthly field tests with your 7-in-1 sensor. Connect via Bluetooth (RDL908 / SoilSensor-XXXX) or enter values manually.
          {!isSensorDemoMode() && !isWebBluetoothAvailable() && (
            <> Live BLE fetch needs <strong>Chrome on Android</strong> with location allowed.</>
          )}
          {isSensorDemoMode() && (
            <> Demo mode is on — set <code>REACT_APP_SENSOR_DEMO=false</code> on Vercel for live BLE.</>
          )}
        </Typography>
        <Button
          type="button"
          variant="outlined"
          startIcon={fetchingSensor ? <CircularProgress size={18} /> : <SensorsIcon />}
          onClick={handleFetchSensor}
          disabled={fetchingSensor}
          sx={{ mb: 2 }}
        >
          {fetchingSensor ? 'Reading sensor…' : 'Connect & fetch from sensor'}
        </Button>
        {sensorDeviceName && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
            Connected to {sensorDeviceName}
          </Typography>
        )}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth required>
              <InputLabel>Tree</InputLabel>
              <Select
                value={selectedTreeId}
                label="Tree"
                onChange={(e) => setSelectedTreeId(e.target.value)}
              >
                {trees.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{getTreeDisplayId(t)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <TextField
              label="Reading date"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={sensorForm.observed_at}
              onChange={(e) => setSensorForm({ ...sensorForm, observed_at: e.target.value })}
            />
          </Grid>
        </Grid>
        <Grid container spacing={2} sx={{ mt: 0 }}>
          {SENSOR_READING_FIELDS.map(({ key, label, unit, standardKey }) => (
            <Grid item xs={6} sm={4} md={3} key={key}>
              <TextField
                label={unit ? `${label} (${unit})` : label}
                fullWidth
                value={sensorForm[key]}
                onChange={(e) => setSensorForm({ ...sensorForm, [key]: e.target.value })}
                helperText={standardKey ? `Target: ${getSoilStandard(standardKey)?.rangeLabel || ''}` : ' '}
                sx={soilRangeFieldSx(standardKey, sensorForm[key])}
              />
            </Grid>
          ))}
        </Grid>
        <Button
          variant="contained"
          sx={{ mt: 2 }}
          onClick={handleSaveSensor}
          disabled={!selectedTreeId || savingSensor}
        >
          Save Sensor Reading
        </Button>
      </Paper>

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Lab Report — Farm-wide</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Laboratory pH, EC, NPK, and micronutrients apply to the whole farm and appear on every tree&apos;s Soil tab.
        </Typography>
        <LabReportFieldRow form={labForm} onChange={setLabForm} />
        <Button
          variant="contained"
          sx={{ mt: 2 }}
          onClick={handleSaveLab}
          disabled={!farm || savingLab}
        >
          Save Lab Report
        </Button>
      </Paper>
    </Box>
  );
}

export default AddSoilReportPage;
