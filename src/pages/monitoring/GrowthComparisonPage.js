import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Link as RouterLink } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/common/PageHeader';
import OrchardZoneLayout, { TreeCircleLink } from '../../components/orchard/OrchardZoneLayout';
import { formatDate, formatNumberSmart, getTreeDisplayId } from '../../utils/formatters';
import { formatLocationLabel, parsePositionCode } from '../../utils/positionCode';
import {
  ORCHARD_ROWS_SELECT,
  collectRowPositions,
} from '../../utils/orchardLayout';
import {
  GROWTH_MEASUREMENT_FIELDS,
  buildGrowthUpdatePayload,
  emptyGrowthForm,
  growthRlsHint,
  hasGrowthMeasurement,
  computeGrowthAverages,
  compareGrowthToAverage,
  pickLatestGrowthByTree,
  recordToGrowthForm,
  trunkMmToCm,
} from '../../utils/treeGrowth';
import { treeDashboardUrl } from '../../utils/treeDashboard';

const GROWTH_MAP_LAYERS = [
  { key: 'height', label: 'Height' },
  { key: 'trunk', label: 'Trunk' },
  { key: 'canopy', label: 'Canopy' },
];

function combineCanopyStatus(nsStatus, ewStatus) {
  if (nsStatus === 'low' || ewStatus === 'low') return { status: 'low', label: 'Below avg' };
  if (nsStatus === 'unknown' && ewStatus === 'unknown') return { status: 'unknown', label: '' };
  if (nsStatus === 'good' || ewStatus === 'good') return { status: 'good', label: 'Above avg' };
  return { status: 'ok', label: 'At avg' };
}

function growthLayerComparison(record, layer, averages) {
  if (layer === 'height') {
    const value = record.height_cm != null && record.height_cm !== '' ? Number(record.height_cm) : null;
    return {
      comparison: compareGrowthToAverage(value, averages.height),
      detail: value != null ? `${formatNumberSmart(value)} cm` : null,
    };
  }
  if (layer === 'trunk') {
    const value = trunkMmToCm(record.trunk_diameter_mm);
    return {
      comparison: compareGrowthToAverage(value, averages.trunk),
      detail: value != null ? `${formatNumberSmart(value)} cm` : null,
    };
  }

  const ns = record.canopy_ns_cm != null && record.canopy_ns_cm !== '' ? Number(record.canopy_ns_cm) : null;
  const ew = record.canopy_ew_cm != null && record.canopy_ew_cm !== '' ? Number(record.canopy_ew_cm) : null;
  const nsComparison = compareGrowthToAverage(ns, averages.canopyNs);
  const ewComparison = compareGrowthToAverage(ew, averages.canopyEw);
  const parts = [];
  if (ns != null) parts.push(`N-S ${formatNumberSmart(ns)} cm`);
  if (ew != null) parts.push(`E-W ${formatNumberSmart(ew)} cm`);
  return {
    comparison: combineCanopyStatus(nsComparison.status, ewComparison.status),
    detail: parts.join(' · ') || null,
  };
}

function growthDotColor(theme, status) {
  if (status === 'low') return theme.palette.warning.main;
  if (status === 'good' || status === 'ok') return theme.palette.success.main;
  return theme.palette.grey[400];
}

function formatCanopyLabel(nsCm, ewCm) {
  if (nsCm == null || ewCm == null || nsCm === '' || ewCm === '') return '—';
  return `${formatNumberSmart(Number(nsCm) / 100)} × ${formatNumberSmart(Number(ewCm) / 100)} m`;
}

function diffFromAverage(value, average) {
  if (value == null || value === '' || average == null) return '—';
  return `${formatNumberSmart(Number(value) - average)}`;
}

function isBelowAverage(value, average) {
  if (value == null || value === '' || average == null) return false;
  return Number(value) < average;
}

function TreeLink({ trees }) {
  const code = getTreeDisplayId(trees || {});
  if (!code) return '—';
  return (
    <Typography
      component={RouterLink}
      to={treeDashboardUrl(code, 'growth')}
      sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}
    >
      {code}
    </Typography>
  );
}

function buildBelowAverageRows(records, averages) {
  return records
    .map((record) => {
      const height = record.height_cm != null && record.height_cm !== '' ? Number(record.height_cm) : null;
      const trunk = trunkMmToCm(record.trunk_diameter_mm);
      const canopyNs = record.canopy_ns_cm != null && record.canopy_ns_cm !== '' ? Number(record.canopy_ns_cm) : null;
      const canopyEw = record.canopy_ew_cm != null && record.canopy_ew_cm !== '' ? Number(record.canopy_ew_cm) : null;
      const below = [];
      if (isBelowAverage(height, averages.height)) below.push('Height');
      if (isBelowAverage(trunk, averages.trunk)) below.push('Trunk');
      if (isBelowAverage(canopyNs, averages.canopyNs) || isBelowAverage(canopyEw, averages.canopyEw)) {
        below.push('Canopy');
      }
      const heightDelta = height != null && averages.height != null ? height - averages.height : null;
      return {
        record,
        height,
        trunk,
        canopyNs,
        canopyEw,
        below,
        heightDelta,
      };
    })
    .filter((row) => row.below.length > 0)
    .sort((a, b) => {
      if (a.heightDelta != null && b.heightDelta != null) return a.heightDelta - b.heightDelta;
      if (a.heightDelta != null) return -1;
      if (b.heightDelta != null) return 1;
      return getTreeDisplayId(a.record.trees || {}).localeCompare(getTreeDisplayId(b.record.trees || {}));
    });
}

function sortAllRecords(records) {
  return records.slice().sort((a, b) => {
    const dateDiff = new Date(b.measurement_date) - new Date(a.measurement_date);
    if (dateDiff !== 0) return dateDiff;
    return getTreeDisplayId(a.trees || {}).localeCompare(getTreeDisplayId(b.trees || {}));
  });
}

function GrowthComparisonPage() {
  const theme = useTheme();
  const [allRecords, setAllRecords] = useState([]);
  const [orchardRows, setOrchardRows] = useState([]);
  const [mapLayer, setMapLayer] = useState('height');
  const [message, setMessage] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState(emptyGrowthForm());
  const [deletingRecord, setDeletingRecord] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadRecords = useCallback(async () => {
    const [{ data, error }, { data: rowsData, error: rowsError }] = await Promise.all([
      supabase
        .from('tree_growth')
        .select('*, trees(tree_positions(position_code, latitude, longitude), variety)')
        .order('measurement_date', { ascending: false }),
      supabase
        .from('rows')
        .select(ORCHARD_ROWS_SELECT)
        .order('name'),
    ]);

    if (error || rowsError) {
      setMessage({ type: 'error', text: growthRlsHint((error || rowsError).message) });
      setAllRecords([]);
      setOrchardRows([]);
      return;
    }

    setAllRecords(data || []);
    setOrchardRows(rowsData || []);
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const latestRecords = useMemo(() => pickLatestGrowthByTree(allRecords), [allRecords]);
  const averages = useMemo(() => computeGrowthAverages(latestRecords), [latestRecords]);
  const mapLayerMeta = GROWTH_MAP_LAYERS.find((layer) => layer.key === mapLayer) || GROWTH_MAP_LAYERS[0];

  const belowAverageRows = useMemo(
    () => buildBelowAverageRows(latestRecords, averages),
    [latestRecords, averages]
  );

  const readingByTreeId = useMemo(() => {
    const map = new Map();
    latestRecords.forEach((record) => map.set(record.tree_id, record));
    return map;
  }, [latestRecords]);

  const positions = useMemo(
    () => orchardRows.flatMap((row) => collectRowPositions(row)),
    [orchardRows],
  );

  const openEditRecord = (record) => {
    setEditingRecord(record);
    setEditForm(recordToGrowthForm(record));
  };

  const closeEditRecord = () => {
    setEditingRecord(null);
    setEditForm(emptyGrowthForm());
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;

    if (!editForm.measurement_date) {
      setMessage({ type: 'error', text: 'Measurement date is required.' });
      return;
    }
    if (!hasGrowthMeasurement(editForm)) {
      setMessage({ type: 'error', text: 'Enter at least one measurement value.' });
      return;
    }

    setSaving(true);
    const payload = buildGrowthUpdatePayload(editForm);
    const { error } = await supabase
      .from('tree_growth')
      .update(payload)
      .eq('id', editingRecord.id);
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: growthRlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Growth measurement updated.' });
    closeEditRecord();
    loadRecords();
  };

  const handleDelete = async () => {
    if (!deletingRecord) return;

    setDeleting(true);
    const { error } = await supabase
      .from('tree_growth')
      .delete()
      .eq('id', deletingRecord.id);
    setDeleting(false);

    if (error) {
      setMessage({ type: 'error', text: growthRlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Growth measurement deleted.' });
    if (editingRecord?.id === deletingRecord.id) closeEditRecord();
    setDeletingRecord(null);
    loadRecords();
  };

  return (
    <Box>
      <PageHeader
        title="Growth Comparison"
        subtitle="Latest measurement per tree vs farm average. Switch Height, Trunk, or Canopy on the orchard layout. Edit or delete any recorded measurement below."
      />

      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
        <Grid container spacing={2}>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">Average height</Typography>
            <Typography variant="h6">
              {averages.height != null ? `${formatNumberSmart(averages.height)} cm` : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {averages.heightCount} tree{averages.heightCount === 1 ? '' : 's'}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">Average trunk</Typography>
            <Typography variant="h6">
              {averages.trunk != null ? `${formatNumberSmart(averages.trunk)} cm` : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {averages.trunkCount} tree{averages.trunkCount === 1 ? '' : 's'}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">Average canopy</Typography>
            <Typography variant="h6">
              {formatCanopyLabel(averages.canopyNs, averages.canopyEw)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {averages.canopyCount} tree{averages.canopyCount === 1 ? '' : 's'}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">Trees measured</Typography>
            <Typography variant="h6">{averages.count}</Typography>
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
          <Box>
            <Typography variant="h6">{mapLayerMeta.label} by tree</Typography>
            <Typography variant="body2" color="text.secondary">
              Same orchard layout as Moisture. Yellow is below farm average; green is at or above.
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {latestRecords.length} tree{latestRecords.length === 1 ? '' : 's'} with a measurement
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
          {GROWTH_MAP_LAYERS.map((layer) => (
            <Chip
              key={layer.key}
              clickable
              label={layer.label}
              variant={mapLayer === layer.key ? 'filled' : 'outlined'}
              color={mapLayer === layer.key ? 'primary' : 'default'}
              onClick={() => setMapLayer(layer.key)}
            />
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Chip size="small" color="warning" label="Below avg" />
          <Chip size="small" color="success" label="At or above avg" />
          <Chip size="small" label="No reading" />
        </Box>
        {positions.length > 0 ? (
          <OrchardZoneLayout
            positions={positions}
            renderTree={(pos) => {
              const record = readingByTreeId.get(pos.activeTree?.id);
              const parsed = parsePositionCode(pos.position_code);
              const { comparison, detail } = record
                ? growthLayerComparison(record, mapLayer, averages)
                : { comparison: { status: 'unknown', label: '' }, detail: null };
              const tooltip = record && comparison.status !== 'unknown'
                ? [
                  pos.position_code,
                  comparison.label,
                  detail,
                ].filter(Boolean).join(' · ')
                : [
                  pos.position_code,
                  parsed ? formatLocationLabel(parsed) : null,
                  `No ${mapLayerMeta.label.toLowerCase()} reading`,
                ].filter(Boolean).join(' · ');
              return (
                <TreeCircleLink
                  pos={pos}
                  to={treeDashboardUrl(pos.position_code, 'growth')}
                  color={growthDotColor(theme, comparison.status)}
                  tooltip={tooltip}
                />
              );
            }}
          />
        ) : (
          <Typography color="text.secondary">
            No tree positions found. Add trees in Farm Setup and Trees first.
          </Typography>
        )}
      </Paper>

      {latestRecords.length > 0 && (
        <Paper sx={{ mb: 3 }} variant="outlined">
          <Box sx={{ p: 2, pb: 1 }}>
            <Typography variant="h6">Trees below average</Typography>
            <Typography variant="body2" color="text.secondary">
              Latest measurement vs farm average. A tree is listed if height, trunk, or canopy is below average.
            </Typography>
          </Box>
          {belowAverageRows.length === 0 ? (
            <Box sx={{ px: 2, pb: 2 }}>
              <Typography color="text.secondary">No trees are below the current averages.</Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tree</TableCell>
                  <TableCell>Height</TableCell>
                  <TableCell>vs Avg Height</TableCell>
                  <TableCell>Trunk</TableCell>
                  <TableCell>vs Avg Trunk</TableCell>
                  <TableCell>Canopy (N-S × E-W)</TableCell>
                  <TableCell>Below on</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {belowAverageRows.map((row) => (
                  <TableRow key={row.record.tree_id} hover>
                    <TableCell>
                      <TreeLink trees={row.record.trees} />
                    </TableCell>
                    <TableCell>
                      {row.height != null ? `${formatNumberSmart(row.height)} cm` : '—'}
                    </TableCell>
                    <TableCell>
                      {row.height != null && averages.height != null
                        ? `${formatNumberSmart(row.height - averages.height)} cm`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {row.trunk != null ? `${formatNumberSmart(row.trunk)} cm` : '—'}
                    </TableCell>
                    <TableCell>
                      {row.trunk != null && averages.trunk != null
                        ? `${formatNumberSmart(row.trunk - averages.trunk)} cm`
                        : '—'}
                    </TableCell>
                    <TableCell>{formatCanopyLabel(row.canopyNs, row.canopyEw)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {row.below.map((label) => (
                          <Chip key={label} size="small" color="warning" label={label} />
                        ))}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      )}

      <Paper variant="outlined">
        <Box sx={{ p: 2, pb: 0 }}>
          <Typography variant="h6" gutterBottom>All Growth Measurements</Typography>
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Tree</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Height (cm)</TableCell>
              <TableCell>Trunk (cm)</TableCell>
              <TableCell>Canopy (N-S × E-W)</TableCell>
              <TableCell>vs Avg Height</TableCell>
              <TableCell>vs Avg Trunk</TableCell>
              <TableCell>vs Avg Canopy N-S</TableCell>
              <TableCell>vs Avg Canopy E-W</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {allRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center">No growth measurements recorded yet.</TableCell>
              </TableRow>
            ) : (
              sortAllRecords(allRecords).map((r) => (
                <TableRow key={r.id}>
                  <TableCell><TreeLink trees={r.trees} /></TableCell>
                  <TableCell>{formatDate(r.measurement_date)}</TableCell>
                  <TableCell>{formatNumberSmart(r.height_cm)}</TableCell>
                  <TableCell>{formatNumberSmart(trunkMmToCm(r.trunk_diameter_mm))}</TableCell>
                  <TableCell>{formatCanopyLabel(r.canopy_ns_cm, r.canopy_ew_cm)}</TableCell>
                  <TableCell>
                    {diffFromAverage(r.height_cm, averages.height)}
                    {r.height_cm != null && averages.height != null ? ' cm' : ''}
                  </TableCell>
                  <TableCell>
                    {diffFromAverage(trunkMmToCm(r.trunk_diameter_mm), averages.trunk)}
                    {r.trunk_diameter_mm != null && averages.trunk != null ? ' cm' : ''}
                  </TableCell>
                  <TableCell>
                    {diffFromAverage(r.canopy_ns_cm, averages.canopyNs)}
                    {r.canopy_ns_cm != null && averages.canopyNs != null ? ' cm' : ''}
                  </TableCell>
                  <TableCell>
                    {diffFromAverage(r.canopy_ew_cm, averages.canopyEw)}
                    {r.canopy_ew_cm != null && averages.canopyEw != null ? ' cm' : ''}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" aria-label="Edit measurement" onClick={() => openEditRecord(r)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label="Delete measurement" onClick={() => setDeletingRecord(r)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={Boolean(editingRecord)} onClose={closeEditRecord} maxWidth="md" fullWidth>
        <DialogTitle>Edit Growth Measurement</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {editingRecord ? getTreeDisplayId(editingRecord.trees || {}) : ''}
          </Typography>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {GROWTH_MEASUREMENT_FIELDS.map(({ key, label, unit }) => (
              <Grid item xs={6} sm={6} md={3} key={key}>
                <TextField
                  label={unit ? `${label} (${unit})` : label}
                  fullWidth
                  type="number"
                  inputProps={{ min: 0, step: 'any' }}
                  value={editForm[key]}
                  onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
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
                value={editForm.measurement_date}
                onChange={(e) => setEditForm({ ...editForm, measurement_date: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditRecord}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deletingRecord)} onClose={() => setDeletingRecord(null)}>
        <DialogTitle>Delete Growth Measurement?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete the measurement for{' '}
            <strong>{deletingRecord ? getTreeDisplayId(deletingRecord.trees || {}) : ''}</strong>
            {' '}on{' '}
            <strong>{deletingRecord ? formatDate(deletingRecord.measurement_date) : ''}</strong>?
            This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingRecord(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default GrowthComparisonPage;
