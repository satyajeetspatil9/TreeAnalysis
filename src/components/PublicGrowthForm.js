import React, { useCallback, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Grid, TextField, Typography,
} from '@mui/material';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import QrPositionScanner from './QrPositionScanner';
import { extractPositionCodeFromScan } from '../utils/positionCode';
import {
  GROWTH_MEASUREMENT_FIELDS,
  buildGrowthPayload,
  emptyGrowthForm,
  hasGrowthMeasurement,
} from '../utils/treeGrowth';
import { submitPublicGrowthMeasurement } from '../utils/publicGrowthApi';

function PublicGrowthForm({ publicAccessKey }) {
  const [positionCode, setPositionCode] = useState('');
  const [form, setForm] = useState(emptyGrowthForm);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleQrScan = useCallback((rawText) => {
    const normalized = extractPositionCodeFromScan(rawText);
    if (!normalized) {
      setError('QR code does not contain a valid position code (e.g. A-R01-L01-T01).');
      return false;
    }

    setPositionCode(normalized);
    setError(null);
    setSuccess(false);
    setScannerOpen(false);
    return true;
  }, []);

  const handleSubmit = async () => {
    if (!positionCode) {
      setError('Scan the tree QR code first.');
      return;
    }
    if (!form.measurement_date) {
      setError('Measurement date is required.');
      return;
    }
    if (!hasGrowthMeasurement(form)) {
      setError('Enter at least one measurement value.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await submitPublicGrowthMeasurement(publicAccessKey, {
        position_code: positionCode,
        ...buildGrowthPayload(form),
      });

      setSuccess(true);
      setForm(emptyGrowthForm());
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
        Scan the tree QR tag, record growth measurements, then save to the tree dashboard.
      </Typography>

      <Button
        type="button"
        variant="contained"
        startIcon={<QrCodeScannerIcon />}
        onClick={() => { setError(null); setScannerOpen(true); }}
        sx={{ mb: 2 }}
      >
        Scan QR code
      </Button>

      <Box sx={{ mb: 2, p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Position code
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
          {positionCode || '—'}
        </Typography>
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        Record measurement
      </Typography>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {GROWTH_MEASUREMENT_FIELDS.map(({ key, label, unit }) => (
          <Grid item xs={6} sm={6} md={3} key={key}>
            <TextField
              label={unit ? `${label} (${unit})` : label}
              fullWidth
              type="number"
              inputProps={{ min: 0, step: 'any' }}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </Grid>
        ))}
        <Grid item xs={12} sm={6} md={3}>
          <TextField
            label="Measurement date"
            type="date"
            fullWidth
            required
            InputLabelProps={{ shrink: true }}
            value={form.measurement_date}
            onChange={(e) => setForm({ ...form, measurement_date: e.target.value })}
          />
        </Grid>
      </Grid>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Growth measurement saved. View it on the tree dashboard under Growth.
        </Alert>
      )}

      <Button
        type="button"
        variant="contained"
        fullWidth
        onClick={handleSubmit}
        disabled={saving || !positionCode}
      >
        {saving ? <CircularProgress size={24} /> : 'Save measurement'}
      </Button>

      <QrPositionScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleQrScan}
      />
    </Box>
  );
}

export default PublicGrowthForm;
