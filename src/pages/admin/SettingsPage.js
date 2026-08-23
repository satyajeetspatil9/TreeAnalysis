import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, TextField, Button, FormControl, InputLabel, Select, MenuItem,
  Alert, Divider, Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useFarm } from '../../hooks/useFarm';
import { useTreeVarieties } from '../../hooks/useTreeVarieties';
import { formatDate, formatNumber } from '../../utils/formatters';
import {
  buildIngestSampleJson,
  generateIngestKey,
  getIngestFunctionUrl,
  hashIngestKey,
  ingestKeyPrefix,
} from '../../utils/ingestApiKeys';
import { buildPublicAddTreePageUrl } from '../../utils/publicAddTreeApi';

const emptyFarmForm = {
  name: '',
  location: '',
  area_acres: '',
  latitude: '',
  longitude: '',
};

function SettingsPage() {
  const { user, signOut } = useAuth();
  const { farm, farms, loading: farmLoading, setFarm, refreshFarms } = useFarm();
  const { varieties, refreshVarieties } = useTreeVarieties();
  const [message, setMessage] = useState(null);
  const [farmForm, setFarmForm] = useState(emptyFarmForm);
  const [newVariety, setNewVariety] = useState('');
  const [sensors, setSensors] = useState([]);
  const [weather, setWeather] = useState([]);
  const [sensorForm, setSensorForm] = useState({ device_code: '', sensor_type: 'SOIL_7IN1', manufacturer: 'ESP32' });
  const [weatherForm, setWeatherForm] = useState({ temperature_c: '', humidity_percent: '', rainfall_mm: '' });
  const [ingestKeys, setIngestKeys] = useState([]);
  const [ingestKeyLabel, setIngestKeyLabel] = useState('ESP32');
  const [newIngestKey, setNewIngestKey] = useState(null);
  const [generatingKey, setGeneratingKey] = useState(false);

  useEffect(() => {
    if (farm) {
      setFarmForm({
        name: farm.name || '',
        location: farm.location || '',
        area_acres: farm.area_acres ?? '',
        latitude: farm.latitude ?? '',
        longitude: farm.longitude ?? '',
      });
    } else {
      setFarmForm(emptyFarmForm);
    }
  }, [farm]);

  const load = useCallback(async () => {
    if (!farm) return;
    const { data: s } = await supabase.from('sensors').select('*').eq('farm_id', farm.id);
    const { data: w } = await supabase.from('weather_observations').select('*').eq('farm_id', farm.id).order('observed_at', { ascending: false }).limit(10);
    const { data: keys } = await supabase
      .from('farm_ingest_keys')
      .select('id, label, key_prefix, created_at, last_used_at, revoked_at')
      .eq('farm_id', farm.id)
      .order('created_at', { ascending: false });
    setSensors(s || []);
    setWeather(w || []);
    setIngestKeys(keys || []);
  }, [farm]);

  useEffect(() => { load(); }, [load]);

  const addSensor = async () => {
    if (!farm || !sensorForm.device_code) return;
    const { error } = await supabase.from('sensors').insert([{ farm_id: farm.id, ...sensorForm }]);
    if (error) setMessage({ type: 'error', text: error.message });
    else { setMessage({ type: 'success', text: 'Sensor registered.' }); load(); }
  };

  const generateIngestApiKey = async () => {
    if (!farm) return;
    setGeneratingKey(true);
    setMessage(null);

    const fullKey = generateIngestKey();
    const keyHash = await hashIngestKey(fullKey);

    const { error } = await supabase.from('farm_ingest_keys').insert([{
      farm_id: farm.id,
      label: ingestKeyLabel.trim() || 'ESP32',
      key_prefix: ingestKeyPrefix(fullKey),
      key_hash: keyHash,
    }]);

    setGeneratingKey(false);

    if (error) {
      const hint = error.message.includes('farm_ingest_keys')
        ? `${error.message} Run migration 031_farm_ingest_keys.sql in Supabase SQL Editor.`
        : error.message;
      setMessage({ type: 'error', text: hint });
      return;
    }

    setNewIngestKey(fullKey);
    setIngestKeyLabel('ESP32');
    await load();
    setMessage({ type: 'success', text: 'Ingest API key created. Copy it now — it will not be shown again.' });
  };

  const revokeIngestKey = async (id) => {
    const { error } = await supabase
      .from('farm_ingest_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) setMessage({ type: 'error', text: error.message });
    else {
      await load();
      setMessage({ type: 'success', text: 'Ingest API key revoked.' });
    }
  };

  const addWeather = async () => {
    if (!farm) return;
    const { error } = await supabase.from('weather_observations').insert([{
      farm_id: farm.id,
      temperature_c: weatherForm.temperature_c ? Number(weatherForm.temperature_c) : null,
      humidity_percent: weatherForm.humidity_percent ? Number(weatherForm.humidity_percent) : null,
      rainfall_mm: weatherForm.rainfall_mm ? Number(weatherForm.rainfall_mm) : null,
      source: 'MANUAL',
    }]);
    if (error) setMessage({ type: 'error', text: error.message });
    else { setMessage({ type: 'success', text: 'Weather recorded.' }); load(); }
  };

  const saveFarm = async () => {
    if (!user || !farmForm.name.trim()) {
      setMessage({ type: 'error', text: 'Farm name is required.' });
      return;
    }

    const payload = {
      name: farmForm.name.trim(),
      location: farmForm.location.trim() || null,
      area_acres: farmForm.area_acres !== '' ? Number(farmForm.area_acres) : null,
      latitude: farmForm.latitude !== '' ? Number(farmForm.latitude) : null,
      longitude: farmForm.longitude !== '' ? Number(farmForm.longitude) : null,
    };

    if (farm) {
      const { data, error } = await supabase
        .from('farms')
        .update({ ...payload, user_id: user.id })
        .eq('id', farm.id)
        .select()
        .single();
      if (error) setMessage({ type: 'error', text: error.message });
      else {
        setFarm(data);
        await refreshFarms();
        setMessage({ type: 'success', text: 'Farm updated.' });
      }
      return;
    }

    const { data, error } = await supabase
      .from('farms')
      .insert([{ ...payload, user_id: user.id }])
      .select()
      .single();

    if (error) setMessage({ type: 'error', text: error.message });
    else {
      setFarm(data);
      await refreshFarms();
      setMessage({ type: 'success', text: 'Farm created. Continue with Farm Setup to add A/B, rows, and lots.' });
    }
  };

  const addVariety = async () => {
    const name = newVariety.trim();
    if (!farm || !name) return;
    const { error } = await supabase.from('tree_varieties').insert([{ farm_id: farm.id, name }]);
    if (error) {
      setMessage({
        type: 'error',
        text: error.message.includes('tree_varieties')
          ? `${error.message} Run migration 007_tree_varieties.sql in Supabase SQL Editor.`
          : error.message,
      });
    } else {
      setNewVariety('');
      await refreshVarieties();
      setMessage({ type: 'success', text: `Variety "${name}" added.` });
    }
  };

  const removeVariety = async (id, name) => {
    const { error } = await supabase.from('tree_varieties').delete().eq('id', id);
    if (error) setMessage({ type: 'error', text: error.message });
    else {
      await refreshVarieties();
      setMessage({ type: 'success', text: `Variety "${name}" removed.` });
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Settings</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Signed in as {user?.email}
      </Typography>
      {message && <Alert severity={message.type} sx={{ mb: 2 }}>{message.text}</Alert>}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Farm</Typography>
        {farmLoading ? (
          <Typography variant="body2" color="text.secondary">Loading farm…</Typography>
        ) : (
          <>
            {farms.length > 1 && (
              <FormControl fullWidth margin="normal">
                <InputLabel>Active farm</InputLabel>
                <Select
                  value={farm ? String(farm.id) : ''}
                  label="Active farm"
                  onChange={(e) => setFarm(farms.find((f) => String(f.id) === e.target.value) || null)}
                >
                  {farms.map((f) => (
                    <MenuItem key={f.id} value={String(f.id)}>{f.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {!farm && (
              <Alert severity="info" sx={{ mb: 2 }}>
                No farm yet. Create one below, then open Farm Setup to add A/B, rows, and lots.
              </Alert>
            )}

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Farm name"
                  fullWidth
                  required
                  value={farmForm.name}
                  onChange={(e) => setFarmForm({ ...farmForm, name: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Location"
                  fullWidth
                  value={farmForm.location}
                  onChange={(e) => setFarmForm({ ...farmForm, location: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Area (acres)"
                  type="number"
                  fullWidth
                  value={farmForm.area_acres}
                  onChange={(e) => setFarmForm({ ...farmForm, area_acres: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Latitude"
                  type="number"
                  fullWidth
                  value={farmForm.latitude}
                  onChange={(e) => setFarmForm({ ...farmForm, latitude: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Longitude"
                  type="number"
                  fullWidth
                  value={farmForm.longitude}
                  onChange={(e) => setFarmForm({ ...farmForm, longitude: e.target.value })}
                />
              </Grid>
            </Grid>

            <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={saveFarm} disabled={!farmForm.name.trim()}>
                {farm ? 'Save Farm' : 'Create Farm'}
              </Button>
              {farm && (
                <Button component={RouterLink} to="/orchard/setup" variant="outlined">
                  Open Farm Setup
                </Button>
              )}
            </Box>
          </>
        )}
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Tree varieties</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Varieties listed here appear in Add Tree, Replace Tree, and Edit Tree dropdowns.
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={8}>
            <TextField
              label="New variety"
              fullWidth
              value={newVariety}
              onChange={(e) => setNewVariety(e.target.value)}
              placeholder="e.g. Alphonso, Kesar, Banganapalli"
              disabled={!farm}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <Button variant="contained" onClick={addVariety} disabled={!farm || !newVariety.trim()}>
              Add variety
            </Button>
          </Grid>
        </Grid>
        <Table size="small" sx={{ mt: 2 }}>
          <TableHead>
            <TableRow>
              <TableCell>Variety</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {varieties.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2}>No varieties yet — add at least one before planting trees.</TableCell>
              </TableRow>
            ) : (
              varieties.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{v.name}</TableCell>
                  <TableCell align="right">
                    <Button size="small" color="error" onClick={() => removeVariety(v.id, v.name)} disabled={!farm}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      {!farm && !farmLoading && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Sensors and weather below need a farm first.
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Field access key (ESP32 + public Add Tree)</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          One key for ESP32 sensor POSTs and the public Add Tree page (no login). Share the Add Tree link with field staff.
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          Sensor POST: <strong>{getIngestFunctionUrl() || '(set REACT_APP_SUPABASE_URL)'}</strong>
          <br />
          Header: <strong>x-api-key: ta_…</strong>
          <br />
          Public Add Tree: <strong>{typeof window !== 'undefined' ? `${window.location.origin}/add-tree?key=ta_…` : '/add-tree?key=ta_…'}</strong>
        </Alert>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={8}>
            <TextField
              label="Key label"
              fullWidth
              value={ingestKeyLabel}
              onChange={(e) => setIngestKeyLabel(e.target.value)}
              placeholder="ESP32 row A"
              disabled={!farm}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <Button variant="contained" onClick={generateIngestApiKey} disabled={!farm || generatingKey}>
              {generatingKey ? 'Generating…' : 'Generate ingest key'}
            </Button>
          </Grid>
        </Grid>
        <Table size="small" sx={{ mt: 2 }}>
          <TableHead>
            <TableRow>
              <TableCell>Label</TableCell>
              <TableCell>Key prefix</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Last used</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ingestKeys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>No ingest keys yet.</TableCell>
              </TableRow>
            ) : (
              ingestKeys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell>{key.label}</TableCell>
                  <TableCell>{key.key_prefix}…</TableCell>
                  <TableCell>{formatDate(key.created_at)}</TableCell>
                  <TableCell>{key.last_used_at ? formatDate(key.last_used_at) : '—'}</TableCell>
                  <TableCell>{key.revoked_at ? 'Revoked' : 'Active'}</TableCell>
                  <TableCell align="right">
                    {!key.revoked_at && (
                      <Button size="small" color="error" onClick={() => revokeIngestKey(key.id)}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary" component="pre" sx={{ mt: 2, display: 'block', whiteSpace: 'pre-wrap' }}>
          Sample JSON body:
          {'\n'}
          {buildIngestSampleJson()}
        </Typography>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Sensors</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}><TextField label="Device code" fullWidth value={sensorForm.device_code} onChange={(e) => setSensorForm({ ...sensorForm, device_code: e.target.value })} /></Grid>
          <Grid item xs={12} md={4}><TextField label="Type" fullWidth value={sensorForm.sensor_type} onChange={(e) => setSensorForm({ ...sensorForm, sensor_type: e.target.value })} /></Grid>
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={addSensor} disabled={!farm}>Register Sensor</Button>
        <Table size="small" sx={{ mt: 2 }}>
          <TableHead><TableRow><TableCell>Code</TableCell><TableCell>Type</TableCell><TableCell>Status</TableCell></TableRow></TableHead>
          <TableBody>
            {sensors.map((s) => <TableRow key={s.id}><TableCell>{s.device_code}</TableCell><TableCell>{s.sensor_type}</TableCell><TableCell>{s.status}</TableCell></TableRow>)}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Weather</Typography>
        <Grid container spacing={2}>
          <Grid item xs={4}><TextField label="Temp °C" fullWidth value={weatherForm.temperature_c} onChange={(e) => setWeatherForm({ ...weatherForm, temperature_c: e.target.value })} /></Grid>
          <Grid item xs={4}><TextField label="Humidity %" fullWidth value={weatherForm.humidity_percent} onChange={(e) => setWeatherForm({ ...weatherForm, humidity_percent: e.target.value })} /></Grid>
          <Grid item xs={4}><TextField label="Rain mm" fullWidth value={weatherForm.rainfall_mm} onChange={(e) => setWeatherForm({ ...weatherForm, rainfall_mm: e.target.value })} /></Grid>
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={addWeather} disabled={!farm}>Record Weather</Button>
        <Divider sx={{ my: 2 }} />
        {weather.map((w) => (
          <Typography key={w.id} variant="body2">
            {formatDate(w.observed_at)} — {formatNumber(w.temperature_c, 1)}°C, {formatNumber(w.humidity_percent, 0)}% RH, {formatNumber(w.rainfall_mm, 1)} mm
          </Typography>
        ))}
      </Paper>

      <Button variant="outlined" color="error" onClick={signOut}>Sign Out</Button>

      <Dialog open={Boolean(newIngestKey)} onClose={() => setNewIngestKey(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Copy your ingest API key</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Store this key on your ESP32 or share the Add Tree link below. Shown once only.
          </DialogContentText>
          <TextField
            fullWidth
            multiline
            minRows={2}
            value={newIngestKey || ''}
            InputProps={{ readOnly: true }}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Public Add Tree link"
            value={newIngestKey ? buildPublicAddTreePageUrl(newIngestKey) : ''}
            InputProps={{ readOnly: true }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (newIngestKey) navigator.clipboard?.writeText(newIngestKey);
            }}
          >
            Copy
          </Button>
          <Button variant="contained" onClick={() => setNewIngestKey(null)}>Done</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default SettingsPage;
