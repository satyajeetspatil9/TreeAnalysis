import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  IconButton,
  Paper,
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
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import {
  GROWTH_MEASUREMENT_FIELDS,
  buildGrowthUpdatePayload,
  emptyGrowthForm,
  growthRlsHint,
  hasGrowthMeasurement,
  pickLatestGrowthByTree,
  recordToGrowthForm,
  trunkMmToCm,
} from '../../utils/treeGrowth';

function computeAverages(records) {
  const heightValues = records
    .filter((r) => r.height_cm != null && r.height_cm !== '')
    .map((r) => Number(r.height_cm));
  const trunkValues = records
    .filter((r) => r.trunk_diameter_mm != null && r.trunk_diameter_mm !== '')
    .map((r) => trunkMmToCm(r.trunk_diameter_mm));
  const canopyNsValues = records
    .filter((r) => r.canopy_ns_cm != null && r.canopy_ns_cm !== '')
    .map((r) => Number(r.canopy_ns_cm));
  const canopyEwValues = records
    .filter((r) => r.canopy_ew_cm != null && r.canopy_ew_cm !== '')
    .map((r) => Number(r.canopy_ew_cm));

  const avg = (values) => (values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null);

  return {
    height: avg(heightValues),
    trunk: avg(trunkValues),
    canopyNs: avg(canopyNsValues),
    canopyEw: avg(canopyEwValues),
    count: records.length,
    heightCount: heightValues.length,
    trunkCount: trunkValues.length,
    canopyCount: records.filter((r) => r.canopy_ns_cm != null && r.canopy_ew_cm != null).length,
  };
}

function formatCanopyLabel(nsCm, ewCm) {
  if (nsCm == null || ewCm == null || nsCm === '' || ewCm === '') return '—';
  return `${formatNumber(Number(nsCm) / 100, 1)} × ${formatNumber(Number(ewCm) / 100, 1)} m`;
}

function diffFromAverage(value, average) {
  if (value == null || value === '' || average == null) return '—';
  return `${formatNumber(Number(value) - average, 1)}`;
}

function sortRecords(records) {
  return records.slice().sort((a, b) =>
    getTreeDisplayId(a.trees || {}).localeCompare(getTreeDisplayId(b.trees || {}))
  );
}

function sortAllRecords(records) {
  return records.slice().sort((a, b) => {
    const dateDiff = new Date(b.measurement_date) - new Date(a.measurement_date);
    if (dateDiff !== 0) return dateDiff;
    return getTreeDisplayId(a.trees || {}).localeCompare(getTreeDisplayId(b.trees || {}));
  });
}

function HeightTooltip({ active, payload, average }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block" sx={{ fontWeight: 600 }}>{row?.tree}</Typography>
      <Typography variant="body2">Height: {formatNumber(row?.height, 1)} cm</Typography>
      {average != null && (
        <Typography variant="caption" color="text.secondary">
          vs avg: {formatNumber(Number(row?.height) - average, 1)} cm
        </Typography>
      )}
    </Paper>
  );
}

function TrunkTooltip({ active, payload, average }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block" sx={{ fontWeight: 600 }}>{row?.tree}</Typography>
      <Typography variant="body2">Trunk: {formatNumber(row?.trunk, 1)} cm</Typography>
      {average != null && (
        <Typography variant="caption" color="text.secondary">
          vs avg: {formatNumber(Number(row?.trunk) - average, 1)} cm
        </Typography>
      )}
    </Paper>
  );
}

function CanopyTooltip({ active, payload, averages }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block" sx={{ fontWeight: 600 }}>{row?.tree}</Typography>
      <Typography variant="body2">Canopy N-S: {formatNumber(row?.canopyNs, 1)} cm</Typography>
      <Typography variant="body2">Canopy E-W: {formatNumber(row?.canopyEw, 1)} cm</Typography>
      {averages.canopyNs != null && row?.canopyNs != null && (
        <Typography variant="caption" color="text.secondary" display="block">
          N-S vs avg: {formatNumber(Number(row.canopyNs) - averages.canopyNs, 1)} cm
        </Typography>
      )}
      {averages.canopyEw != null && row?.canopyEw != null && (
        <Typography variant="caption" color="text.secondary" display="block">
          E-W vs avg: {formatNumber(Number(row.canopyEw) - averages.canopyEw, 1)} cm
        </Typography>
      )}
    </Paper>
  );
}

function GrowthComparisonPage() {
  const [allRecords, setAllRecords] = useState([]);
  const [message, setMessage] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState(emptyGrowthForm());
  const [deletingRecord, setDeletingRecord] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadRecords = useCallback(async () => {
    const { data, error } = await supabase
      .from('tree_growth')
      .select('*, trees(tree_positions(position_code), variety)')
      .order('measurement_date', { ascending: false });

    if (error) {
      setMessage({ type: 'error', text: growthRlsHint(error.message) });
      setAllRecords([]);
      return;
    }

    setAllRecords(data || []);
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const latestRecords = useMemo(() => pickLatestGrowthByTree(allRecords), [allRecords]);
  const averages = useMemo(() => computeAverages(latestRecords), [latestRecords]);

  const heightChartData = useMemo(
    () => sortRecords(latestRecords)
      .filter((r) => r.height_cm != null && r.height_cm !== '')
      .map((r) => ({
        tree: getTreeDisplayId(r.trees || {}),
        height: Number(r.height_cm),
      })),
    [latestRecords]
  );

  const trunkChartData = useMemo(
    () => sortRecords(latestRecords)
      .filter((r) => r.trunk_diameter_mm != null && r.trunk_diameter_mm !== '')
      .map((r) => ({
        tree: getTreeDisplayId(r.trees || {}),
        trunk: trunkMmToCm(r.trunk_diameter_mm),
      })),
    [latestRecords]
  );

  const canopyChartData = useMemo(
    () => sortRecords(latestRecords)
      .filter((r) => r.canopy_ns_cm != null && r.canopy_ew_cm != null)
      .map((r) => ({
        tree: getTreeDisplayId(r.trees || {}),
        canopyNs: Number(r.canopy_ns_cm),
        canopyEw: Number(r.canopy_ew_cm),
      })),
    [latestRecords]
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

  const xAxisProps = {
    dataKey: 'tree',
    interval: 0,
    angle: -35,
    textAnchor: 'end',
    height: 72,
    tick: { fontSize: 11 },
  };

  return (
    <Box>
      <PageHeader
        title="Growth Comparison"
        subtitle="Charts compare the latest measurement per tree. Edit or delete any recorded measurement below."
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
              {averages.height != null ? `${formatNumber(averages.height, 1)} cm` : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {averages.heightCount} tree{averages.heightCount === 1 ? '' : 's'}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">Average trunk</Typography>
            <Typography variant="h6">
              {averages.trunk != null ? `${formatNumber(averages.trunk, 1)} cm` : '—'}
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

      {latestRecords.length > 0 && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} lg={4}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Height by Tree</Typography>
              {heightChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={heightChartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis {...xAxisProps} />
                    <YAxis tickFormatter={(value) => `${value} cm`} width={52} />
                    <Tooltip content={<HeightTooltip average={averages.height} />} />
                    {averages.height != null && (
                      <ReferenceLine
                        y={averages.height}
                        stroke="#ef6c00"
                        strokeDasharray="4 4"
                        label={{ value: 'Avg', position: 'insideTopRight', fill: '#ef6c00', fontSize: 12 }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="height"
                      stroke="#2e7d32"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Height (cm)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Typography color="text.secondary">No height measurements yet.</Typography>
              )}
            </Paper>
          </Grid>
          <Grid item xs={12} lg={4}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Trunk by Tree</Typography>
              {trunkChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trunkChartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis {...xAxisProps} />
                    <YAxis tickFormatter={(value) => `${value} cm`} width={52} />
                    <Tooltip content={<TrunkTooltip average={averages.trunk} />} />
                    {averages.trunk != null && (
                      <ReferenceLine
                        y={averages.trunk}
                        stroke="#ef6c00"
                        strokeDasharray="4 4"
                        label={{ value: 'Avg', position: 'insideTopRight', fill: '#ef6c00', fontSize: 12 }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="trunk"
                      stroke="#1565c0"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Trunk (cm)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Typography color="text.secondary">No trunk measurements yet.</Typography>
              )}
            </Paper>
          </Grid>
          <Grid item xs={12} lg={4}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Canopy by Tree</Typography>
              {canopyChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={canopyChartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis {...xAxisProps} />
                    <YAxis tickFormatter={(value) => `${value} cm`} width={52} />
                    <Tooltip content={<CanopyTooltip averages={averages} />} />
                    {averages.canopyNs != null && (
                      <ReferenceLine
                        y={averages.canopyNs}
                        stroke="#ef6c00"
                        strokeDasharray="4 4"
                        label={{ value: 'Avg N-S', position: 'insideTopRight', fill: '#ef6c00', fontSize: 11 }}
                      />
                    )}
                    {averages.canopyEw != null && (
                      <ReferenceLine
                        y={averages.canopyEw}
                        stroke="#8e24aa"
                        strokeDasharray="2 6"
                        label={{ value: 'Avg E-W', position: 'insideBottomRight', fill: '#8e24aa', fontSize: 11 }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="canopyNs"
                      stroke="#6a1b9a"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Canopy N-S (cm)"
                    />
                    <Line
                      type="monotone"
                      dataKey="canopyEw"
                      stroke="#ab47bc"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Canopy E-W (cm)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Typography color="text.secondary">No canopy measurements yet.</Typography>
              )}
            </Paper>
          </Grid>
        </Grid>
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
                  <TableCell>{getTreeDisplayId(r.trees || {})}</TableCell>
                  <TableCell>{formatDate(r.measurement_date)}</TableCell>
                  <TableCell>{formatNumber(r.height_cm, 1)}</TableCell>
                  <TableCell>{formatNumber(trunkMmToCm(r.trunk_diameter_mm), 1)}</TableCell>
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
