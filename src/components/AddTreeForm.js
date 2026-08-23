import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { TREE_STATUS } from '../utils/schema';
import {
  LOT_SELECT,
  buildPositionCode,
  extractPositionCodeFromScan,
  findLotForPositionCode,
  formatLotPath,
  getLotRowNames,
  getLotSectionName,
  lotMatchesPositionCode,
  parsePositionCode,
} from '../utils/positionCode';
import {
  Box, TextField, Button, Typography, CircularProgress, Alert,
  MenuItem, Select, InputLabel, FormControl,
} from '@mui/material';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import VarietySelect from './VarietySelect';
import QrPositionScanner from './QrPositionScanner';
import { captureDeviceGps, parseTreeGps } from '../utils/treeGps';
import { useTreeVarieties } from '../hooks/useTreeVarieties';
import { fetchPublicAddTreeBootstrap, submitPublicAddTree } from '../utils/publicAddTreeApi';

const DEFAULT_PLANTING_DATE = '2026-08-08';
const DEFAULT_VARIETY_NAME = 'Alphonso';

function resolveDefaultVariety(varieties) {
  const names = (varieties || []).map((v) => v.name);
  const match = names.find((n) => n.toLowerCase() === DEFAULT_VARIETY_NAME.toLowerCase())
    || names.find((n) => n.toLowerCase() === 'alphanso');
  return match || DEFAULT_VARIETY_NAME;
}

function AddTreeForm({ onSuccess, publicAccessKey = '' }) {
  const isPublic = Boolean(publicAccessKey);
  const { varieties: hookVarieties } = useTreeVarieties();
  const [publicVarieties, setPublicVarieties] = useState([]);
  const [bootstrapLoading, setBootstrapLoading] = useState(isPublic);
  const [bootstrapError, setBootstrapError] = useState(null);
  const [farmName, setFarmName] = useState('');
  const varieties = isPublic ? publicVarieties : hookVarieties;
  const [variety, setVariety] = useState(DEFAULT_VARIETY_NAME);
  const [plantingDate, setPlantingDate] = useState(DEFAULT_PLANTING_DATE);
  const [status, setStatus] = useState('Active');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locating, setLocating] = useState(false);
  const [lots, setLots] = useState([]);
  const [selectedLot, setSelectedLot] = useState('');
  const [selectedRow, setSelectedRow] = useState('');
  const [treeNumber, setTreeNumber] = useState('01');
  const [scannedCode, setScannedCode] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [gpsWarning, setGpsWarning] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (varieties.length > 0) {
      setVariety((current) => {
        const resolved = resolveDefaultVariety(varieties);
        if (!current || current === DEFAULT_VARIETY_NAME || current.toLowerCase() === 'alphanso') {
          return resolved;
        }
        return current;
      });
    }
  }, [varieties]);

  useEffect(() => {
    if (!isPublic) return undefined;

    let cancelled = false;
    const loadBootstrap = async () => {
      setBootstrapLoading(true);
      setBootstrapError(null);
      try {
        const data = await fetchPublicAddTreeBootstrap(publicAccessKey);
        if (cancelled) return;
        setFarmName(data.farm_name || '');
        setPublicVarieties(data.varieties || []);
        setLots((data.lots || []).sort((a, b) => formatLotPath(a).localeCompare(formatLotPath(b))));
      } catch (err) {
        if (!cancelled) setBootstrapError(err.message);
      } finally {
        if (!cancelled) setBootstrapLoading(false);
      }
    };

    loadBootstrap();
    return () => { cancelled = true; };
  }, [publicAccessKey, isPublic]);

  useEffect(() => {
    if (isPublic) return undefined;

    const fetchLots = async () => {
      let { data, error: fetchError } = await supabase.from('lots').select(LOT_SELECT);
      if (fetchError) {
        const legacy = await supabase
          .from('lots')
          .select('id, name, row_id, rows ( name, sections ( name ) )');
        data = legacy.data;
      }
      setLots((data || []).sort((a, b) => formatLotPath(a).localeCompare(formatLotPath(b))));
    };
    fetchLots();
    return undefined;
  }, [isPublic]);

  const selectedLotRecord = lots.find((l) => String(l.id) === selectedLot);
  const rowOptions = useMemo(() => getLotRowNames(selectedLotRecord), [selectedLotRecord]);

  useEffect(() => {
    if (rowOptions.length === 1) setSelectedRow(rowOptions[0]);
    else if (!rowOptions.includes(selectedRow)) setSelectedRow('');
  }, [rowOptions, selectedRow]);

  const positionCode = useMemo(() => {
    if (!selectedLotRecord || !selectedRow || !treeNumber) return '';
    return buildPositionCode({
      section: getLotSectionName(selectedLotRecord),
      row: selectedRow,
      lot: selectedLotRecord.name,
      tree: treeNumber,
    });
  }, [selectedLotRecord, selectedRow, treeNumber]);

  const applyPositionCode = useCallback((code) => {
    const normalized = extractPositionCodeFromScan(code);
    if (!normalized) {
      setError('QR code does not contain a valid position code (e.g. A-R01-L01-T01).');
      return false;
    }

    const parsed = parsePositionCode(normalized);
    const lot = findLotForPositionCode(lots, normalized);
    if (!lot) {
      setError(`No matching lot for ${normalized}. Add the lot in Farm Setup first.`);
      return false;
    }

    setSelectedLot(String(lot.id));
    setSelectedRow(parsed.row);
    setTreeNumber(parsed.tree.replace(/^T/i, ''));
    setScannedCode(normalized);
    setError(null);
    return true;
  }, [lots]);

  const requestLocation = useCallback(() => {
    setLocating(true);
    setGpsWarning(null);

    const promise = captureDeviceGps().then((result) => {
      if (!result.error) {
        setLatitude(String(result.latitude));
        setLongitude(String(result.longitude));
      }
      return result;
    }).finally(() => {
      setLocating(false);
    });

    return promise;
  }, []);

  const openScanner = () => {
    setError(null);
    setGpsWarning(null);
    setScannerOpen(true);
  };

  const handleQrScan = useCallback((rawText) => {
    if (!applyPositionCode(rawText)) {
      return false;
    }

    setScannerOpen(false);
    setVariety(resolveDefaultVariety(varieties));
    setPlantingDate(DEFAULT_PLANTING_DATE);

    window.setTimeout(() => {
      requestLocation().then((gps) => {
        if (gps.error) {
          setGpsWarning(`Position filled from QR. ${gps.error}`);
        } else {
          setGpsWarning(null);
        }
      });
    }, 0);

    return true;
  }, [applyPositionCode, requestLocation, varieties]);

  const handleCaptureLocationClick = async () => {
    setError(null);
    setGpsWarning(null);
    const gps = await requestLocation();
    if (gps.error) setGpsWarning(gps.error);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    if (!variety || !plantingDate || !selectedLotRecord || !selectedRow || !positionCode) {
      setError('Select lot, row, tree number, variety, and planting date.');
      setLoading(false);
      return;
    }

    if (!parsePositionCode(positionCode)) {
      setError('Invalid position code format. Expected like A-R01-L01-T01.');
      setLoading(false);
      return;
    }

    if (!lotMatchesPositionCode(selectedLotRecord, positionCode)) {
      setError('Selected lot/row does not match the generated position code.');
      setLoading(false);
      return;
    }

    const gps = parseTreeGps(latitude, longitude);
    if (gps.error) {
      setError(gps.error);
      setLoading(false);
      return;
    }

    try {
      const lotId = selectedLotRecord.id;

      if (isPublic) {
        await submitPublicAddTree(publicAccessKey, {
          position_code: positionCode,
          lot_id: lotId,
          variety,
          planting_date: plantingDate,
          status,
          latitude: gps.latitude,
          longitude: gps.longitude,
        });
      } else {
        const { data: existingPosition } = await supabase
          .from('tree_positions')
          .select('id, trees(id, status)')
          .eq('position_code', positionCode)
          .maybeSingle();

        if (existingPosition?.trees?.some((t) => t.status === 'Active')) {
          throw new Error(`Position ${positionCode} already has an active tree. Remove or replace it first.`);
        }

        let positionId = existingPosition?.id;

        if (!positionId) {
          const { data: newPosition, error: posError } = await supabase
            .from('tree_positions')
            .insert([{
              position_code: positionCode,
              lot_id: lotId,
              latitude: gps.latitude,
              longitude: gps.longitude,
            }])
            .select()
            .single();
          if (posError) throw posError;
          positionId = newPosition.id;
        } else {
          const { error: gpsError } = await supabase
            .from('tree_positions')
            .update({ latitude: gps.latitude, longitude: gps.longitude })
            .eq('id', positionId);
          if (gpsError) throw gpsError;
        }

        const { error: treeError } = await supabase.from('trees').insert([
          {
            position_id: positionId,
            variety,
            planting_date: plantingDate,
            status,
          },
        ]);

        if (treeError) throw treeError;
      }

      setSuccess(true);
      setVariety(resolveDefaultVariety(varieties));
      setPlantingDate(DEFAULT_PLANTING_DATE);
      setStatus('Active');
      setSelectedLot('');
      setSelectedRow('');
      setTreeNumber('01');
      setScannedCode('');
      setLatitude('');
      setLongitude('');
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2, p: 3, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      {bootstrapLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {bootstrapError && (
        <Alert severity="error" sx={{ mb: 2 }}>{bootstrapError}</Alert>
      )}

      {!bootstrapLoading && !bootstrapError && (
        <>
      <Typography variant="h6" gutterBottom>Add New Tree</Typography>
      {isPublic && farmName && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Farm: {farmName}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Tap Scan QR code to fill position, variety (Alphonso), planting date, and GPS. Allow camera when prompted.
        GPS coordinates are required for each tree position.
      </Typography>

      <Button
        type="button"
        variant="outlined"
        startIcon={<QrCodeScannerIcon />}
        onClick={openScanner}
        sx={{ mb: 1 }}
      >
        Scan QR code
      </Button>

      <FormControl fullWidth margin="normal" required>
        <InputLabel>Lot</InputLabel>
        <Select
          value={selectedLot}
          label="Lot"
          onChange={(e) => {
            setSelectedLot(e.target.value);
            setSelectedRow('');
            setScannedCode('');
          }}
        >
          {lots.map((lot) => (
            <MenuItem key={lot.id} value={String(lot.id)}>
              {formatLotPath(lot)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth margin="normal" required disabled={!selectedLotRecord}>
        <InputLabel>Row</InputLabel>
        <Select value={selectedRow} label="Row" onChange={(e) => setSelectedRow(e.target.value)}>
          {rowOptions.map((row) => (
            <MenuItem key={row} value={row}>{row}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        label="Tree number"
        fullWidth
        margin="normal"
        value={treeNumber}
        onChange={(e) => {
          setTreeNumber(e.target.value.replace(/\D/g, '').slice(0, 2));
          setScannedCode('');
        }}
        helperText="01 becomes T01 in the position code"
        required
      />

      <TextField
        label="Position code"
        fullWidth
        margin="normal"
        value={positionCode}
        InputProps={{ readOnly: true }}
        helperText={
          scannedCode
            ? `Filled from QR scan: ${scannedCode}`
            : 'Auto-generated from lot, row, and tree number'
        }
      />

      <VarietySelect
        value={variety}
        onChange={setVariety}
        required
        varieties={isPublic ? publicVarieties : undefined}
        loading={isPublic ? bootstrapLoading : undefined}
      />
      <TextField label="Planting Date" type="date" fullWidth margin="normal" InputLabelProps={{ shrink: true }} value={plantingDate} onChange={(e) => setPlantingDate(e.target.value)} required />

      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>GPS location (required)</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Button type="button" variant="outlined" size="small" onClick={handleCaptureLocationClick} disabled={locating}>
          {locating ? 'Getting location…' : 'Use my current location'}
        </Button>
      </Box>
      <TextField
        label="Latitude"
        type="number"
        fullWidth
        margin="normal"
        required
        inputProps={{ step: 'any', min: -90, max: 90 }}
        value={latitude}
        onChange={(e) => setLatitude(e.target.value)}
        helperText="Decimal degrees, e.g. 16.12345"
      />
      <TextField
        label="Longitude"
        type="number"
        fullWidth
        margin="normal"
        required
        inputProps={{ step: 'any', min: -180, max: 180 }}
        value={longitude}
        onChange={(e) => setLongitude(e.target.value)}
        helperText="Decimal degrees, e.g. 73.12345"
      />

      <FormControl fullWidth margin="normal">
        <InputLabel>Status</InputLabel>
        <Select value={status} label="Status" onChange={(e) => setStatus(e.target.value)}>
          {TREE_STATUS.map((value) => (
            <MenuItem key={value} value={value}>{value}</MenuItem>
          ))}
        </Select>
      </FormControl>

      {gpsWarning && <Alert severity="warning" sx={{ mt: 2 }}>{gpsWarning}</Alert>}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 2 }}>Tree added successfully!</Alert>}

      <Button type="submit" variant="contained" fullWidth sx={{ mt: 3 }} disabled={loading || bootstrapLoading || !positionCode || !latitude || !longitude}>
        {loading ? <CircularProgress size={24} /> : 'Add Tree'}
      </Button>

      <QrPositionScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleQrScan}
      />
        </>
      )}
    </Box>
  );
}

export default AddTreeForm;
