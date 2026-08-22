import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Button, TextField, Grid, FormControl, InputLabel, Select, MenuItem, Alert,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText, Chip, Stack,
  alpha,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { LabReportFieldRow } from '../../components/soil/LabReportFieldRow';
import {
  SENSOR_READING_FIELDS,
  LAB_NUTRIENT_FIELDS,
  emptySensorForm,
  emptyLabForm,
  buildSensorUpdatePayload,
  buildLabUpdatePayload,
  observationToForm,
  labReportToForm,
  getSoilStandard,
  fieldLabelWithUnit,
  rlsHint,
  buildTreeNutrientDeficiencyReport,
  buildFarmLabNutrientDeficiencyReport,
  getLatestObservationByTree,
  soilReadingCellSx,
} from '../../utils/soil';
import { refreshSoilNutrientAlerts } from '../../utils/soilAlerts';
import { SoilStandardsReference } from '../../components/soil/SoilNutrientDisplay';

const SENSOR_TABLE_FIELDS = SENSOR_READING_FIELDS.filter(({ key }) =>
  ['moisture_percent', 'ph', 'ec', 'nitrogen', 'phosphorus', 'potassium'].includes(key),
);

function formatSensorTableValue(field, value) {
  if (value == null) return '—';
  if (field.key === 'moisture_percent') return `${formatNumber(value, field.decimals ?? 0)}%`;
  return formatNumber(value, field.decimals ?? 2);
}

function SoilMonitoringPage() {
  const { farm, loading: farmLoading } = useFarm();
  const [observations, setObservations] = useState([]);
  const [sensorObservations, setSensorObservations] = useState([]);
  const [labReports, setLabReports] = useState([]);
  const [trees, setTrees] = useState([]);
  const [message, setMessage] = useState(null);
  const [editingObservation, setEditingObservation] = useState(null);
  const [editSensorForm, setEditSensorForm] = useState(emptySensorForm());
  const [editSensorTreeId, setEditSensorTreeId] = useState('');
  const [deletingObservation, setDeletingObservation] = useState(null);
  const [editingLabReport, setEditingLabReport] = useState(null);
  const [editLabForm, setEditLabForm] = useState(emptyLabForm());
  const [deletingLabReport, setDeletingLabReport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('soil_observations')
      .select('*, trees(tree_positions(position_code))')
      .order('observed_at', { ascending: false })
      .limit(500);
    setSensorObservations(data || []);
    setObservations((data || []).slice(0, 50));

    await refreshSoilNutrientAlerts(supabase);

    if (farm?.id) {
      const { data: labData, error: labError } = await supabase
        .from('farm_soil_lab_reports')
        .select('*')
        .eq('farm_id', farm.id)
        .order('sample_date', { ascending: false })
        .limit(20);
      if (labError) {
        setMessage({ type: 'error', text: rlsHint(labError.message, '009_farm_soil_lab_reports.sql') });
        setLabReports([]);
      } else {
        setLabReports(labData || []);
      }
    } else {
      setLabReports([]);
    }

    const { data: treeData } = await supabase
      .from('trees')
      .select('id, tree_positions(position_code)')
      .eq('status', 'Active');
    setTrees((treeData || []).sort((a, b) =>
      getTreeDisplayId(a).localeCompare(getTreeDisplayId(b)),
    ));
  }, [farm?.id]);

  useEffect(() => {
    if (farmLoading) return;
    load();
  }, [load, farmLoading]);

  const nutrientDeficiencies = useMemo(
    () => buildTreeNutrientDeficiencyReport(sensorObservations)
      .sort((a, b) => getTreeDisplayId(a.trees || {}).localeCompare(
        getTreeDisplayId(b.trees || {}),
        undefined,
        { numeric: true },
      )),
    [sensorObservations],
  );

  const labNutrientDeficiency = useMemo(
    () => buildFarmLabNutrientDeficiencyReport(labReports),
    [labReports],
  );

  const hasNutrientDeficiencies = nutrientDeficiencies.length > 0 || Boolean(labNutrientDeficiency);

  const treesWithRecentReadings = useMemo(
    () => Object.keys(getLatestObservationByTree(sensorObservations)).length,
    [sensorObservations],
  );

  const validateSensorForm = (form, treeId) => {
    if (!treeId) return 'Select a tree for this sensor reading.';
    const hasReading = SENSOR_READING_FIELDS.some(({ key }) => form[key] !== '' && form[key] != null);
    if (!hasReading) return 'Enter at least one sensor value.';
    return null;
  };

  const openEditObservation = (observation) => {
    setEditingObservation(observation);
    setEditSensorForm(observationToForm(observation));
    setEditSensorTreeId(observation.tree_id);
  };

  const closeEditObservation = () => {
    setEditingObservation(null);
    setEditSensorForm(emptySensorForm());
    setEditSensorTreeId('');
  };

  const handleSaveEditObservation = async () => {
    if (!editingObservation) return;

    const validationError = validateSensorForm(editSensorForm, editSensorTreeId);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    setSaving(true);
    const payload = buildSensorUpdatePayload(editSensorForm, editSensorTreeId);
    const { error } = await supabase
      .from('soil_observations')
      .update(payload)
      .eq('id', editingObservation.id);
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Sensor reading updated.' });
    closeEditObservation();
    load();
  };

  const handleDeleteObservation = async () => {
    if (!deletingObservation) return;

    setDeleting(true);
    const { error } = await supabase
      .from('soil_observations')
      .delete()
      .eq('id', deletingObservation.id);
    setDeleting(false);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Sensor reading deleted.' });
    if (editingObservation?.id === deletingObservation.id) closeEditObservation();
    setDeletingObservation(null);
    load();
  };

  const openEditLabReport = (report) => {
    setEditingLabReport(report);
    setEditLabForm(labReportToForm(report));
  };

  const closeEditLabReport = () => {
    setEditingLabReport(null);
    setEditLabForm(emptyLabForm());
  };

  const handleSaveEditLabReport = async () => {
    if (!editingLabReport) return;

    const payload = buildLabUpdatePayload(editLabForm);
    const hasValue = LAB_NUTRIENT_FIELDS.some(({ key }) => payload[key] != null);
    if (!hasValue) {
      setMessage({ type: 'error', text: 'Enter at least one lab result.' });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('farm_soil_lab_reports')
      .update(payload)
      .eq('id', editingLabReport.id);
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message, '009_farm_soil_lab_reports.sql') });
      return;
    }

    setMessage({ type: 'success', text: 'Lab report updated.' });
    closeEditLabReport();
    load();
  };

  const handleDeleteLabReport = async () => {
    if (!deletingLabReport) return;

    setDeleting(true);
    const { error } = await supabase
      .from('farm_soil_lab_reports')
      .delete()
      .eq('id', deletingLabReport.id);
    setDeleting(false);

    if (error) {
      setMessage({ type: 'error', text: rlsHint(error.message, '009_farm_soil_lab_reports.sql') });
      return;
    }

    setMessage({ type: 'success', text: 'Lab report deleted.' });
    if (editingLabReport?.id === deletingLabReport.id) closeEditLabReport();
    setDeletingLabReport(null);
    load();
  };

  return (
    <Box>
      <PageHeader
        section="Monitoring"
        title="Soil"
        subtitle="Review sensor readings and lab reports. Add new entries under Farm Setting → Add Soil Report."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Alert severity="info" sx={{ mb: 2 }}>
        To add readings, go to{' '}
        <Button component={RouterLink} to="/orchard/soil-report" size="small" sx={{ ml: 0.5 }}>
          Farm Setting → Add Soil Report
        </Button>
      </Alert>

      <Paper
        sx={(theme) => ({
          p: 2.5,
          mb: 3,
          border: '2px solid',
          borderColor: hasNutrientDeficiencies
            ? theme.palette.warning.main
            : alpha(theme.palette.success.main, 0.45),
          borderLeftWidth: 8,
          borderLeftColor: hasNutrientDeficiencies
            ? theme.palette.warning.dark
            : theme.palette.success.main,
          bgcolor: hasNutrientDeficiencies
            ? alpha(theme.palette.warning.main, 0.16)
            : alpha(theme.palette.success.main, 0.08),
          '& .MuiTableCell-root': { fontSize: '1rem', borderColor: alpha(theme.palette.warning.main, 0.25) },
          '& .MuiTableHead-root .MuiTableCell-root': {
            bgcolor: hasNutrientDeficiencies
              ? alpha(theme.palette.warning.main, 0.28)
              : alpha(theme.palette.success.main, 0.12),
            color: hasNutrientDeficiencies
              ? theme.palette.warning.contrastText
              : theme.palette.text.primary,
          },
        })}
        variant="outlined"
      >
        <Typography
          variant="h5"
          gutterBottom
          sx={(theme) => ({
            fontWeight: 700,
            color: hasNutrientDeficiencies
              ? theme.palette.warning.light
              : theme.palette.success.light,
          })}
        >
          Nutrients Below Required
        </Typography>
        <Typography variant="body1" sx={{ mb: 2, color: 'text.primary' }}>
          Compares each tree&apos;s latest 8-in-1 sensor reading and your farm&apos;s latest lab report
          against required ranges. Trees below required levels are added to Monitoring → Alerts automatically.
        </Typography>
        {treesWithRecentReadings === 0 && labReports.length === 0 ? (
          <Typography variant="body1" color="text.secondary">
            No sensor readings or lab reports yet. Add them under Farm Setting → Add Soil Report.
          </Typography>
        ) : !hasNutrientDeficiencies ? (
          <Alert severity="success" sx={{ mb: 0, fontSize: '1rem' }}>
            {treesWithRecentReadings > 0
              ? `All ${treesWithRecentReadings} tree${treesWithRecentReadings === 1 ? '' : 's'} with sensor readings meet required nutrient levels.`
              : 'Latest lab report meets required nutrient levels.'}
            {treesWithRecentReadings > 0 && labReports.length > 0 ? ' Latest lab report also meets required levels.' : ''}
          </Alert>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Latest reading</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Below required</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {labNutrientDeficiency && (
                <TableRow
                  key={`lab-${labNutrientDeficiency.reportId}`}
                  sx={(theme) => ({
                    '&:nth-of-type(odd)': {
                      bgcolor: alpha(theme.palette.warning.main, 0.08),
                    },
                  })}
                >
                  <TableCell sx={{ fontWeight: 700, color: 'warning.light' }}>
                    Farm (lab report)
                    {labNutrientDeficiency.labName ? ` · ${labNutrientDeficiency.labName}` : ''}
                  </TableCell>
                  <TableCell>{formatDate(labNutrientDeficiency.sampleDate)}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                      {labNutrientDeficiency.lowNutrients.map((nutrient) => (
                        <Chip
                          key={nutrient.key}
                          color="warning"
                          label={`${nutrient.label}: ${formatNumber(nutrient.value, nutrient.decimals)}${nutrient.unit ? ` ${nutrient.unit}` : ''} (target ${nutrient.rangeLabel})`}
                          sx={(theme) => ({
                            height: 'auto',
                            bgcolor: alpha(theme.palette.warning.main, 0.35),
                            color: theme.palette.warning.contrastText,
                            border: `1px solid ${theme.palette.warning.main}`,
                            '& .MuiChip-label': {
                              whiteSpace: 'normal',
                              py: 0.75,
                              px: 1,
                              fontSize: '0.95rem',
                              fontWeight: 600,
                            },
                          })}
                        />
                      ))}
                    </Stack>
                  </TableCell>
                </TableRow>
              )}
              {nutrientDeficiencies.map((row) => (
                <TableRow
                  key={row.treeId}
                  sx={(theme) => ({
                    '&:nth-of-type(odd)': {
                      bgcolor: alpha(theme.palette.warning.main, 0.08),
                    },
                  })}
                >
                  <TableCell sx={{ fontWeight: 700, color: 'warning.light' }}>
                    {getTreeDisplayId(row.trees || {})}
                  </TableCell>
                  <TableCell>{formatDate(row.observedAt)}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                      {row.lowNutrients.map((nutrient) => (
                        <Chip
                          key={nutrient.key}
                          color="warning"
                          label={`${nutrient.label}: ${formatNumber(nutrient.value, nutrient.decimals)}${nutrient.unit ? ` ${nutrient.unit}` : ''} (target ${nutrient.rangeLabel})`}
                          sx={(theme) => ({
                            height: 'auto',
                            bgcolor: alpha(theme.palette.warning.main, 0.35),
                            color: theme.palette.warning.contrastText,
                            border: `1px solid ${theme.palette.warning.main}`,
                            '& .MuiChip-label': {
                              whiteSpace: 'normal',
                              py: 0.75,
                              px: 1,
                              fontSize: '0.95rem',
                              fontWeight: 600,
                            },
                          })}
                        />
                      ))}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
          Required Nutrient Ranges
        </Typography>
        <SoilStandardsReference compact />
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Recent Sensor Readings</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Tree</TableCell>
              {SENSOR_TABLE_FIELDS.map(({ key, label, unit }) => (
                <TableCell key={key}>{unit ? `${label} (${unit})` : label}</TableCell>
              ))}
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {observations.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{formatDate(o.observed_at)}</TableCell>
                <TableCell>{getTreeDisplayId(o.trees || {})}</TableCell>
                {SENSOR_TABLE_FIELDS.map((field) => (
                  <TableCell
                    key={field.key}
                    sx={soilReadingCellSx(field.standardKey, o[field.key])}
                  >
                    {formatSensorTableValue(field, o[field.key])}
                  </TableCell>
                ))}
                <TableCell align="right">
                  <IconButton size="small" aria-label="Edit reading" onClick={() => openEditObservation(o)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label="Delete reading" onClick={() => setDeletingObservation(o)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {observations.length === 0 && (
              <TableRow><TableCell colSpan={9} align="center">No sensor readings yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 2 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Lab Reports</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Sample date</TableCell>
              <TableCell>Lab</TableCell>
              {LAB_NUTRIENT_FIELDS.map((field) => (
                <TableCell key={field.key}>{fieldLabelWithUnit(field)}</TableCell>
              ))}
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {labReports.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.sample_date)}</TableCell>
                <TableCell>{r.lab_name || '—'}</TableCell>
                {LAB_NUTRIENT_FIELDS.map(({ key, standardKey }) => {
                  const value = r[key];
                  return (
                    <TableCell
                      key={key}
                      sx={soilReadingCellSx(standardKey, value)}
                    >
                      {value != null ? formatNumber(value, 2) : '—'}
                    </TableCell>
                  );
                })}
                <TableCell align="right">
                  <IconButton size="small" aria-label="Edit lab report" onClick={() => openEditLabReport(r)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label="Delete lab report" onClick={() => setDeletingLabReport(r)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {labReports.length === 0 && (
              <TableRow><TableCell colSpan={9} align="center">No lab reports yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={Boolean(editingObservation)} onClose={closeEditObservation} maxWidth="md" fullWidth>
        <DialogTitle>Edit Sensor Reading</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel>Tree</InputLabel>
                <Select
                  value={editSensorTreeId}
                  label="Tree"
                  onChange={(e) => setEditSensorTreeId(e.target.value)}
                >
                  {trees.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{getTreeDisplayId(t)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Reading date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={editSensorForm.observed_at}
                onChange={(e) => setEditSensorForm({ ...editSensorForm, observed_at: e.target.value })}
              />
            </Grid>
            {SENSOR_READING_FIELDS.map(({ key, label, unit, standardKey }) => (
              <Grid item xs={6} md={3} key={key}>
                <TextField
                  label={unit ? `${label} (${unit})` : label}
                  fullWidth
                  value={editSensorForm[key]}
                  onChange={(e) => setEditSensorForm({ ...editSensorForm, [key]: e.target.value })}
                  helperText={standardKey ? `Target: ${getSoilStandard(standardKey)?.rangeLabel || ''}` : undefined}
                />
              </Grid>
            ))}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditObservation}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEditObservation} disabled={saving}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deletingObservation)} onClose={() => setDeletingObservation(null)}>
        <DialogTitle>Delete Sensor Reading?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete the reading from {formatDate(deletingObservation?.observed_at)} for{' '}
            {getTreeDisplayId(deletingObservation?.trees || {})}? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingObservation(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteObservation} disabled={deleting}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(editingLabReport)} onClose={closeEditLabReport} maxWidth="lg" fullWidth>
        <DialogTitle>Edit Lab Report</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <LabReportFieldRow form={editLabForm} onChange={setEditLabForm} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditLabReport}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEditLabReport} disabled={saving}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deletingLabReport)} onClose={() => setDeletingLabReport(null)}>
        <DialogTitle>Delete Lab Report?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete the lab report from {formatDate(deletingLabReport?.sample_date)}
            {deletingLabReport?.lab_name ? ` (${deletingLabReport.lab_name})` : ''}? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingLabReport(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteLabReport} disabled={deleting}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default SoilMonitoringPage;
