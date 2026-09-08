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
import { GpsTreeDotMap } from '../../components/common/GpsTreeDotMap';
import { LabReportFieldRow } from '../../components/soil/LabReportFieldRow';
import { getTreeGps } from '../../utils/schema';
import { treeDashboardUrl } from '../../utils/treeDashboard';
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
  getLowNutrientsFromObservation,
  soilRangeFieldSx,
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

function observationHasSensorNutrients(observation) {
  return SENSOR_READING_FIELDS.some(({ key, standardKey }) => (
    standardKey
    && key !== 'moisture_percent'
    && observation?.[key] != null
    && observation[key] !== ''
  ));
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

function NutrientBelowPaper({ hasIssues, title, subtitle, children }) {
  return (
    <Paper
      variant="outlined"
      sx={(theme) => ({
        p: 2.5,
        height: '100%',
        border: '2px solid',
        borderColor: hasIssues
          ? theme.palette.warning.main
          : alpha(theme.palette.success.main, 0.45),
        borderLeftWidth: 8,
        borderLeftColor: hasIssues
          ? theme.palette.warning.dark
          : theme.palette.success.main,
        bgcolor: hasIssues
          ? alpha(theme.palette.warning.main, 0.16)
          : alpha(theme.palette.success.main, 0.08),
        '& .MuiTableCell-root': { fontSize: '1rem', borderColor: alpha(theme.palette.warning.main, 0.25) },
        '& .MuiTableHead-root .MuiTableCell-root': {
          bgcolor: hasIssues
            ? alpha(theme.palette.warning.main, 0.28)
            : alpha(theme.palette.success.main, 0.12),
          color: hasIssues
            ? theme.palette.warning.contrastText
            : theme.palette.text.primary,
        },
      })}
    >
      <Typography
        variant="h5"
        gutterBottom
        sx={(theme) => ({
          fontWeight: 700,
          color: hasIssues
            ? theme.palette.warning.light
            : theme.palette.success.light,
        })}
      >
        {title}
      </Typography>
      <Typography variant="body1" sx={{ mb: 2, color: 'text.primary' }}>
        {subtitle}
      </Typography>
      {children}
    </Paper>
  );
}

function SoilMonitoringPage() {
  const theme = useTheme();
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
      .select('*, trees(tree_positions(position_code, latitude, longitude))')
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
      .select('id, tree_positions(position_code, latitude, longitude)')
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

  const sensorNutrientTreeCount = useMemo(
    () => Object.values(getLatestObservationByTree(sensorObservations))
      .filter(observationHasSensorNutrients).length,
    [sensorObservations],
  );

  const sensorMapItems = useMemo(
    () => Object.values(getLatestObservationByTree(sensorObservations))
      .filter(observationHasSensorNutrients)
      .map((observation) => {
        const code = getTreeDisplayId(observation.trees || {});
        const lowNutrients = getLowNutrientsFromObservation(observation);
        return {
          id: observation.tree_id,
          label: code,
          to: treeDashboardUrl(code, 'soil'),
          color: lowNutrients.length ? theme.palette.warning.main : theme.palette.success.main,
          gps: getTreeGps(observation.trees || {}),
          tooltip: lowNutrients.length
            ? lowNutrients.map((nutrient) => nutrient.label).join(', ')
            : 'Meets required',
        };
      }),
    [sensorObservations, theme],
  );

  const labMapItems = useMemo(
    () => trees.map((tree) => {
      const code = getTreeDisplayId(tree);
      const lowNutrients = labNutrientDeficiency?.lowNutrients || [];
      return {
        id: tree.id,
        label: code,
        to: treeDashboardUrl(code, 'soil'),
        color: labNutrientDeficiency
          ? theme.palette.warning.main
          : labReports.length
            ? theme.palette.success.main
            : theme.palette.grey[400],
        gps: getTreeGps(tree),
        tooltip: labNutrientDeficiency
          ? lowNutrients.map((nutrient) => nutrient.label).join(', ')
          : labReports.length
            ? 'Meets required'
            : 'No lab report',
      };
    }),
    [trees, labNutrientDeficiency, labReports.length, theme],
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
        subtitle="Review 7-in-1 sensor readings and lab reports. Add new entries under Farm Setting → Add Soil Report."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Alert severity="info" sx={{ mb: 2 }}>
        To add readings, go to{' '}
        <Button component={RouterLink} to="/orchard/soil-report" size="small" sx={{ ml: 0.5 }}>
          Farm Setting → Add Soil Report
        </Button>
      </Alert>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <NutrientBelowPaper
            hasIssues={nutrientDeficiencies.length > 0}
            title="Nutrients Below Required for 7-in-1 Sensor Readings"
            subtitle="Latest 7-in-1 reading per tree vs required ranges. Moisture is shown on Monitoring → Moisture. Trees below required levels are added to Monitoring → Alerts automatically."
          >
            {sensorNutrientTreeCount === 0 ? (
              <Typography variant="body1" color="text.secondary">
                No 7-in-1 nutrient readings yet. Add them under Farm Setting → Add Soil Report.
              </Typography>
            ) : (
              <>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                  <Chip size="small" color="warning" label="Below required" />
                  <Chip size="small" color="success" label="Meets required" />
                </Box>
                <Box sx={{ mb: nutrientDeficiencies.length > 0 ? 2 : 0 }}>
                  <GpsTreeDotMap
                    items={sensorMapItems}
                    emptyGpsText="Trees with 7-in-1 readings need GPS on their position to appear on this layout."
                  />
                </Box>
                {nutrientDeficiencies.length === 0 ? (
                  <Alert severity="success" sx={{ mt: 2, fontSize: '1rem' }}>
                    All {sensorNutrientTreeCount} tree{sensorNutrientTreeCount === 1 ? '' : 's'} with 7-in-1 readings meet required nutrient levels.
                  </Alert>
                ) : (
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Tree</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Latest reading</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Below required</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {nutrientDeficiencies.map((row) => {
                        const code = getTreeDisplayId(row.trees || {});
                        return (
                          <TableRow
                            key={row.treeId}
                            sx={(t) => ({
                              '&:nth-of-type(odd)': {
                                bgcolor: alpha(t.palette.warning.main, 0.08),
                              },
                            })}
                          >
                            <TableCell sx={{ fontWeight: 700 }}>
                              <Typography
                                component={RouterLink}
                                to={treeDashboardUrl(code, 'soil')}
                                sx={{ color: 'warning.light', textDecoration: 'none', fontWeight: 700 }}
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
                )}
              </>
            )}
          </NutrientBelowPaper>
        </Grid>
        <Grid item xs={12}>
          <NutrientBelowPaper
            hasIssues={Boolean(labNutrientDeficiency)}
            title="Nutrients Below Required for Lab Reports"
            subtitle="Farm lab results vs required ranges. The map uses the latest merged lab values for the whole orchard."
          >
            {labReports.length === 0 ? (
              <Typography variant="body1" color="text.secondary">
                No lab reports yet. Add them under Farm Setting → Add Soil Report.
              </Typography>
            ) : (
              <>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                  <Chip size="small" color="warning" label="Below required" />
                  <Chip size="small" color="success" label="Meets required" />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <GpsTreeDotMap
                    items={labMapItems}
                    emptyGpsText="Trees need GPS on their position to appear on this layout."
                  />
                </Box>
                {labNutrientDeficiency ? (
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Lab</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Latest sample</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Below required</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow
                        sx={(t) => ({
                          bgcolor: alpha(t.palette.warning.main, 0.08),
                        })}
                      >
                        <TableCell sx={{ fontWeight: 700, color: 'warning.light' }}>
                          Farm
                          {labNutrientDeficiency.labName ? ` · ${labNutrientDeficiency.labName}` : ''}
                        </TableCell>
                        <TableCell>{formatDate(labNutrientDeficiency.sampleDate)}</TableCell>
                        <TableCell>
                          <LowNutrientChips nutrients={labNutrientDeficiency.lowNutrients} />
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                ) : (
                  <Alert severity="success" sx={{ fontSize: '1rem' }}>
                    Latest lab report meets required nutrient levels.
                  </Alert>
                )}
              </>
            )}
          </NutrientBelowPaper>
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
