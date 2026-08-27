import React, { useCallback, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Grid, Typography,
} from '@mui/material';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import SensorsIcon from '@mui/icons-material/Sensors';
import QrPositionScanner from './QrPositionScanner';
import { extractPositionCodeFromScan } from '../utils/positionCode';
import {
  SENSOR_READING_FIELDS,
  fieldLabelWithUnit,
  getSoilStandard,
  soilValueColor,
} from '../utils/soil';
import { fetchSensorReadings, isSensorDemoMode, isWebBluetoothAvailable } from '../utils/sensorFetch';
import { submitPublicSoilReport } from '../utils/publicSoilReportApi';

function PublicSoilReportForm({ publicAccessKey }) {
  const [positionCode, setPositionCode] = useState('');
  const [readings, setReadings] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sensorDeviceName, setSensorDeviceName] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleQrScan = useCallback((rawText) => {
    const normalized = extractPositionCodeFromScan(rawText);
    if (!normalized) {
      setError('QR code does not contain a valid position code (e.g. A-R01-L01-T01).');
      return false;
    }

    setPositionCode(normalized);
    setReadings(null);
    setError(null);
    setSuccess(false);
    setScannerOpen(false);
    return true;
  }, []);

  const handleFetchSensor = async () => {
    setFetching(true);
    setError(null);
    setSuccess(false);
    setSensorDeviceName(null);

    try {
      const data = await fetchSensorReadings();
      setReadings(data);
      if (data._deviceName) {
        setSensorDeviceName(data._deviceName);
      }
    } catch (err) {
      setError(err.message || 'Could not fetch sensor data.');
    } finally {
      setFetching(false);
    }
  };

  const handleSubmit = async () => {
    if (!positionCode) {
      setError('Scan the tree QR code first.');
      return;
    }
    if (!readings) {
      setError('Fetch sensor data before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await submitPublicSoilReport(publicAccessKey, {
        position_code: positionCode,
        observed_at: readings.observed_at,
        moisture_percent: readings.moisture_percent,
        ph: readings.ph,
        ec: readings.ec,
        temperature_c: readings.temperature_c,
        nitrogen: readings.nitrogen,
        phosphorus: readings.phosphorus,
        potassium: readings.potassium,
      });

      setSuccess(true);
      setReadings(null);
      setPositionCode('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ mt: 2, p: 3, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Scan the tree QR tag, then tap Connect & fetch from sensor (RDL908 / SoilSensor-XXXX).
        {!isSensorDemoMode() && !isWebBluetoothAvailable() && (
          <> Live fetch needs <strong>Chrome on Android</strong> with location allowed.</>
        )}
        {isSensorDemoMode() && (
          <> Demo mode is on — set <code>REACT_APP_SENSOR_DEMO=false</code> and restart npm to use BLE.</>
        )}
      </Typography>

      <Button
        type="button"
        variant="contained"
        startIcon={<QrCodeScannerIcon />}
        onClick={() => { setError(null); setScannerOpen(true); }}
        sx={{ mb: 2, mr: 1 }}
      >
        Scan QR code
      </Button>

      <Button
        type="button"
        variant="outlined"
        startIcon={fetching ? <CircularProgress size={18} /> : <SensorsIcon />}
        onClick={handleFetchSensor}
        disabled={fetching}
        sx={{ mb: 2 }}
      >
        {fetching ? 'Reading sensor…' : 'Connect & fetch from sensor'}
      </Button>

      {sensorDeviceName && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          Connected to {sensorDeviceName}
        </Typography>
      )}

      {readings?._raw && (
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ mb: 2, fontFamily: 'monospace' }}
        >
          Raw registers: {Object.entries(readings._raw).map(([key, value]) => `${key}=${value}`).join('  ')}
        </Typography>
      )}

      <Box sx={{ mb: 2, p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Position code
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
          {positionCode || '—'}
        </Typography>
      </Box>

      {readings && (
        <>
          <Box sx={{ mb: 2, p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Reading date
            </Typography>
            <Typography variant="body1" fontWeight={600} sx={{ mt: 0.5 }}>
              {readings.observed_at}
            </Typography>
          </Box>

          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            7-in-1 sensor readings
          </Typography>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            {SENSOR_READING_FIELDS.map((field) => {
              const standard = field.standardKey ? getSoilStandard(field.standardKey) : null;
              return (
                <Grid item xs={6} sm={4} md={3} key={field.key} sx={{ display: 'flex' }}>
                  <Box
                    sx={{
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                      width: '100%',
                      minHeight: 104,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ minHeight: 32, lineHeight: 1.25, display: 'block' }}
                    >
                      {fieldLabelWithUnit(field)}
                    </Typography>
                    <Typography
                      variant="h6"
                      fontWeight={600}
                      sx={{ my: 0.5, lineHeight: 1.2, color: soilValueColor(field.standardKey, readings[field.key]) }}
                    >
                      {readings[field.key] ?? '—'}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ minHeight: 32, lineHeight: 1.25, display: 'block', mt: 'auto' }}
                    >
                      {standard?.rangeLabel ? `Target: ${standard.rangeLabel}` : '\u00A0'}
                    </Typography>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        </>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          7-in-1 soil report saved. View it on the tree dashboard under Soil.
        </Alert>
      )}

      <Button
        type="button"
        variant="contained"
        fullWidth
        onClick={handleSubmit}
        disabled={saving || !positionCode || !readings}
      >
        {saving ? <CircularProgress size={24} /> : 'Add soil report'}
      </Button>

      <QrPositionScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleQrScan}
      />
    </Box>
  );
}

export default PublicSoilReportForm;
