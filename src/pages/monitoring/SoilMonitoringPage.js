import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Button, TextField, Grid, FormControl, InputLabel, Select, MenuItem, Alert,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText, Chip, Stack,
  alpha,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import OrchardZoneLayout, { TreeCircleLink } from '../../components/orchard/OrchardZoneLayout';
import { LabReportFieldRow } from '../../components/soil/LabReportFieldRow';
import { treeDashboardUrl } from '../../utils/treeDashboard';
import { filterByTreeIds, loadFarmRows, loadFarmTreeIds, loadFarmTrees } from '../../utils/farmScope';
import {
  ORCHARD_ROWS_SELECT,
  collectRowPositions,
} from '../../utils/orchardLayout';
import { formatLocationLabel, parsePositionCode } from '../../utils/positionCode';
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
  evaluateSoilStandard,
  buildTreeNutrientDeficiencyReport,
  buildFarmLabNutrientDeficiencyReport,
  getLatestObservationByTree,
  getMergedLatestLabNutrients,
  soilRangeFieldSx,
  soilReadingCellSx,
} from '../../utils/soil';
import { refreshSoilNutrientAlerts } from '../../utils/soilAlerts';
import { SoilStandardsReference } from '../../components/soil/SoilNutrientDisplay';
import { CommonBelowNutrientsSummary } from '../../components/soil/CommonBelowNutrientsSummary';

const SENSOR_TABLE_FIELDS = SENSOR_READING_FIELDS.filter(({ key }) =>
  ['moisture_percent', 'ph', 'ec', 'nitrogen', 'phosphorus', 'potassium'].includes(key),
);

const SENSOR_MAP_FIELDS = SENSOR_READING_FIELDS.filter(({ key }) =>
  ['ph', 'ec', 'nitrogen', 'phosphorus', 'potassium'].includes(key),
);

function formatSensorTableValue(field, value) {
  if (value == null) return '—';
  if (field.key === 'moisture_percent') return `${formatNumber(value, field.decimals ?? 0)}%`;
  return formatNumber(value, field.decimals ?? 2);
}

function formatNutrientValue(field, value) {
  if (value == null || value === '') return null;
  const text = formatNumber(value, field.decimals ?? 2);
  return field.unit ? `${text} ${field.unit}` : text;
}

function soilMapDotColor(theme, status) {
  if (status === 'good' || status === 'ok') return theme.palette.success.main;
  if (status === 'low') return theme.palette.warning.main;
  if (status === 'high') return theme.palette.error.main;
  return theme.palette.grey[400];
}

function nutrientChipLabel(nutrient) {
  return `${nutrient.label}: ${formatNumber(nutrient.value, nutrient.decimals)}${nutrient.unit ? ` ${nutrient.unit}` : ''} (target ${nutrient.rangeLabel})`;
}

const lowNutrientChipSx = (theme) => ({
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
});

function LowNutrientChips({ nutrients }) {
  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
      {nutrients.map((nutrient) => (
        <Chip
          key={nutrient.key}
          color="warning"
          label={nutrientChipLabel(nutrient)}
          sx={lowNutrientChipSx}
        />
      ))}
    </Stack>
  );
}

function NutrientLayerChips({ fields, value, onChange }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
      {fields.map((field) => (
        <Chip
          key={field.key}
          clickable
          label={fieldLabelWithUnit(field)}
          variant={value === field.key ? 'filled' : 'outlined'}
          color={value === field.key ? 'primary' : 'default'}
          onClick={() => onChange(field.key)}
        />
      ))}
    </Box>
  );
}

function SoilStatusLegend() {
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
      <Chip size="small" color="warning" label="Low" />
      <Chip size="small" color="success" label="OK" />
      <Chip size="small" color="error" label="High" />
      <Chip size="small" label="No data" />
    </Box>
  );
}

function SoilMonitoringPage() {
  const theme = useTheme();
  const { farm, loading: farmLoading } = useFarm();
  const [observations, setObservations] = useState([]);
  const [sensorObservations, setSensorObservations] = useState([]);
  const [labReports, setLabReports] = useState([]);
  const [trees, setTrees] = useState([]);
  const [orchardRows, setOrchardRows] = useState([]);
  const [sensorLayer, setSensorLayer] = useState('ph');
  const [labLayer, setLabLayer] = useState('ph');
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
    if (!farm?.id) {
      setSensorObservations([]);
      setObservations([]);
      setOrchardRows([]);
      setLabReports([]);
      setTrees([]);
      return;
    }
    const treeIds = await loadFarmTreeIds(supabase, farm.id);
    const [{ data }, orchardRowsData] = await Promise.all([
      supabase
        .from('soil_observations')
        .select('*, trees(tree_positions(position_code, latitude, longitude))')
        .order('observed_at', { ascending: false })
        .limit(500),
      loadFarmRows(supabase, farm.id, ORCHARD_ROWS_SELECT),
    ]);
    const farmSoil = filterByTreeIds(data || [], treeIds);
    setSensorObservations(farmSoil);
    setObservations(farmSoil.slice(0, 50));
    setOrchardRows(orchardRowsData || []);

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

    const treeData = await loadFarmTrees(supabase, farm.id, {
      select: 'id, tree_positions(position_code, latitude, longitude)',
    });
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

  const mergedLabNutrients = useMemo(
    () => getMergedLatestLabNutrients(labReports),
    [labReports],
  );

  const sensorLayerField = SENSOR_MAP_FIELDS.find((field) => field.key === sensorLayer) || SENSOR_MAP_FIELDS[0];
  const labLayerField = LAB_NUTRIENT_FIELDS.find((field) => field.key === labLayer) || LAB_NUTRIENT_FIELDS[0];

  const sensorLayerDeficiencies = useMemo(
    () => nutrientDeficiencies
      .map((row) => ({
        ...row,
        lowNutrients: row.lowNutrients.filter((nutrient) => nutrient.key === sensorLayerField.key),
      }))
      .filter((row) => row.lowNutrients.length > 0),
    [nutrientDeficiencies, sensorLayerField.key],
  );

  const labLayerValue = mergedLabNutrients?.values?.[labLayerField.key];
  const labLayerEvaluation = evaluateSoilStandard(getSoilStandard(labLayerField.standardKey), labLayerValue);
  const labLayerLowNutrients = labNutrientDeficiency?.lowNutrients.filter(
    (nutrient) => nutrient.key === labLayerField.key,
  ) || [];

  const latestByTreeId = useMemo(
    () => getLatestObservationByTree(sensorObservations),
    [sensorObservations],
  );

  const positions = useMemo(
    () => orchardRows.flatMap((row) => collectRowPositions(row)),
    [orchardRows],
  );

  const sensorTreesWithLayer = useMemo(
    () => Object.values(latestByTreeId).filter((observation) => {
      const value = observation?.[sensorLayerField.key];
      return value != null && value !== '';
    }).length,
    [latestByTreeId, sensorLayerField.key],
  );

  const labLayerValueText = formatNutrientValue(labLayerField, labLayerValue);

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
        subtitle="Review 7-in-1 sensor readings and lab reports. Add new entries under Farm Setting → Add Soil Report."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Alert severity="info" sx={{ mb: 2 }}>
        To add readings, go to{' '}
        <Button component={RouterLink} to="/orchard/soil-report" size="small" sx={{ ml: 0.5 }}>
          Farm Setting → Add Soil Report
        </Button>
      </Alert>

      <CommonBelowNutrientsSummary
        observations={sensorObservations}
        sourceText="Each tree's latest 7-in-1 reading (not moisture)."
      />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }} variant="outlined">
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
              <Box>
                <Typography variant="h6">Nutrients Below Required for 7-in-1 Sensor Readings</Typography>
                <Typography variant="body2" color="text.secondary">
                  {fieldLabelWithUnit(sensorLayerField)} from each tree&apos;s latest 7-in-1 reading. Moisture is on Monitoring → Moisture.
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {sensorTreesWithLayer} tree{sensorTreesWithLayer === 1 ? '' : 's'} with this reading
              </Typography>
            </Box>
            <NutrientLayerChips fields={SENSOR_MAP_FIELDS} value={sensorLayerField.key} onChange={setSensorLayer} />
            <SoilStatusLegend />
            {positions.length === 0 ? (
              <Typography color="text.secondary">
                No tree positions found. Add trees in Farm Setup and Trees first.
              </Typography>
            ) : (
              <OrchardZoneLayout
                positions={positions}
                renderTree={(pos) => {
                  const observation = latestByTreeId[pos.activeTree?.id];
                  const parsed = parsePositionCode(pos.position_code);
                  const value = observation?.[sensorLayerField.key];
                  const evaluation = evaluateSoilStandard(getSoilStandard(sensorLayerField.standardKey), value);
                  const tooltip = value != null && value !== ''
                    ? [
                      pos.position_code,
                      evaluation.label,
                      formatNutrientValue(sensorLayerField, value),
                    ].filter(Boolean).join(' · ')
                    : [
                      pos.position_code,
                      parsed ? formatLocationLabel(parsed) : null,
                      `No ${fieldLabelWithUnit(sensorLayerField)} reading`,
                    ].filter(Boolean).join(' · ');
                  return (
                    <TreeCircleLink
                      pos={pos}
                      to={treeDashboardUrl(pos.position_code, 'soil')}
                      color={soilMapDotColor(theme, evaluation.status)}
                      tooltip={tooltip}
                    />
                  );
                }}
              />
            )}
            {sensorTreesWithLayer > 0 && (
              sensorLayerDeficiencies.length === 0 ? (
                <Alert severity="success" sx={{ mt: 2 }}>
                  No trees are below required {fieldLabelWithUnit(sensorLayerField)}.
                </Alert>
              ) : (
                <Table size="small" sx={{ mt: 2 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Tree</TableCell>
                      <TableCell>Latest reading</TableCell>
                      <TableCell>Below required</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sensorLayerDeficiencies.map((row) => {
                      const code = getTreeDisplayId(row.trees || {});
                      return (
                        <TableRow key={row.treeId} hover>
                          <TableCell>
                            <Typography
                              component={RouterLink}
                              to={treeDashboardUrl(code, 'soil')}
                              sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}
                            >
                              {code}
                            </Typography>
                          </TableCell>
                          <TableCell>{formatDate(row.observedAt)}</TableCell>
                          <TableCell>
                            <LowNutrientChips nutrients={row.lowNutrients} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )
            )}
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }} variant="outlined">
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
              <Box>
                <Typography variant="h6">Nutrients Below Required for Lab Reports</Typography>
                <Typography variant="body2" color="text.secondary">
                  {fieldLabelWithUnit(labLayerField)} from the farm&apos;s latest lab values. Same orchard layout as Moisture; switch nutrients below.
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {positions.length} tree{positions.length === 1 ? '' : 's'}
              </Typography>
            </Box>
            <NutrientLayerChips fields={LAB_NUTRIENT_FIELDS} value={labLayerField.key} onChange={setLabLayer} />
            <SoilStatusLegend />
            {labReports.length === 0 ? (
              <Typography color="text.secondary">
                No lab reports yet. Add them under Farm Setting → Add Soil Report.
              </Typography>
            ) : positions.length === 0 ? (
              <Typography color="text.secondary">
                No tree positions found. Add trees in Farm Setup and Trees first.
              </Typography>
            ) : (
              <OrchardZoneLayout
                positions={positions}
                renderTree={(pos) => {
                  const parsed = parsePositionCode(pos.position_code);
                  const tooltip = [
                    pos.position_code,
                    parsed ? formatLocationLabel(parsed) : null,
                    labLayerEvaluation.label || 'No data',
                    labLayerValueText,
                    mergedLabNutrients?.labName,
                  ].filter(Boolean).join(' · ');
                  return (
                    <TreeCircleLink
                      pos={pos}
                      to={treeDashboardUrl(pos.position_code, 'soil')}
                      color={soilMapDotColor(theme, labLayerEvaluation.status)}
                      tooltip={tooltip}
                    />
                  );
                }}
              />
            )}
            {labReports.length > 0 && (
              labLayerEvaluation.status === 'low' ? (
                <Table size="small" sx={{ mt: 2 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Lab</TableCell>
                      <TableCell>Latest sample</TableCell>
                      <TableCell>Below required</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow hover>
                      <TableCell>
                        Farm
                        {mergedLabNutrients?.labName ? ` · ${mergedLabNutrients.labName}` : ''}
                      </TableCell>
                      <TableCell>{formatDate(mergedLabNutrients?.sampleDate)}</TableCell>
                      <TableCell>
                        <LowNutrientChips nutrients={labLayerLowNutrients} />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <Alert
                  severity={labLayerEvaluation.status === 'high' ? 'warning' : labLayerEvaluation.status === 'unknown' ? 'info' : 'success'}
                  sx={{ mt: 2 }}
                >
                  {labLayerEvaluation.status === 'unknown'
                    ? `No lab value for ${fieldLabelWithUnit(labLayerField)} yet.`
                    : `${fieldLabelWithUnit(labLayerField)} is ${labLayerEvaluation.label.toLowerCase()} (${formatNutrientValue(labLayerField, labLayerValue)}).`}
                </Alert>
              )
            )}
          </Paper>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
          Required Nutrient Ranges
        </Typography>
        <SoilStandardsReference compact />
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Recent 7-in-1 Sensor Readings</Typography>
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
                {LAB_NUTRIENT_FIELDS.map(({ key, standardKey, decimals }) => {
                  const value = r[key];
                  return (
                    <TableCell
                      key={key}
                      sx={soilReadingCellSx(standardKey, value)}
                    >
                      {value != null ? formatNumber(value, decimals ?? 2) : '—'}
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
              <TableRow><TableCell colSpan={3 + LAB_NUTRIENT_FIELDS.length} align="center">No lab reports yet.</TableCell></TableRow>
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
                  sx={soilRangeFieldSx(standardKey, editSensorForm[key])}
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
