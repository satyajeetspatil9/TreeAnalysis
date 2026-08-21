import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useFarm } from '../hooks/useFarm';
import {
  VALID_SECTIONS,
  VALID_LOT_CODES,
  formatLotRowAssignment,
  normalizeLot,
  normalizeRow,
} from '../utils/positionCode';
import { assignLotRows, createLotWithRows, deleteLot, deleteRow, fetchFarmLayout, getLotBoundaryCorners, hasMultiRowLotsSupport, updateLotBoundary, updateLotName, updateRowName } from '../utils/lotSchema';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Collapse,
  TextField,
  Button,
  CircularProgress,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Chip,
  OutlinedInput,
  Divider,
  IconButton,
  Stack,
} from '@mui/material';
import { ExpandLess, ExpandMore, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';

const SETUP_MODES = [
  { id: 'row', label: 'Row' },
  { id: 'lot', label: 'Lot' },
  { id: 'assign', label: 'Assign rows to lot' },
];

const EMPTY_PLOT_CORNERS = [
  { latitude: '', longitude: '' },
  { latitude: '', longitude: '' },
  { latitude: '', longitude: '' },
  { latitude: '', longitude: '' },
];

function clonePlotCorners(corners = EMPTY_PLOT_CORNERS) {
  return corners.map((corner) => ({ ...corner }));
}

function parsePlotCorners(corners) {
  const filled = corners.filter((corner) => corner.latitude !== '' || corner.longitude !== '');
  if (!filled.length) return { corners: null, error: null };
  if (filled.length !== corners.length) {
    return { corners: null, error: 'Enter all 4 plot corner coordinates, or leave all blank.' };
  }

  const parsed = corners.map((corner) => ({
    latitude: Number(corner.latitude),
    longitude: Number(corner.longitude),
  }));

  if (parsed.some((corner) => !Number.isFinite(corner.latitude) || !Number.isFinite(corner.longitude))) {
    return { corners: null, error: 'Each plot corner must have valid latitude and longitude.' };
  }

  return { corners: parsed, error: null };
}

async function ensureDefaultPhase(farmId) {
  const { data: existing } = await supabase.from('phases').select('id').eq('farm_id', farmId).limit(1);
  if (existing?.length) return existing[0].id;

  const { data: created, error } = await supabase
    .from('phases')
    .insert([{ farm_id: farmId, name: 'Main', status: 'Active' }])
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

async function ensureBlocksForFarm(farmId) {
  const phaseId = await ensureDefaultPhase(farmId);
  for (const name of VALID_SECTIONS) {
    const { data: existing } = await supabase
      .from('sections')
      .select('id')
      .eq('phase_id', phaseId)
      .eq('name', name)
      .maybeSingle();
    if (!existing) {
      const { error } = await supabase.from('sections').insert([{ phase_id: phaseId, name }]);
      if (error) throw error;
    }
  }
}

function getBlocksForFarm(farm) {
  return (farm?.phases || []).flatMap((p) => p.sections || []);
}

function FarmSetup() {
  const { farm: activeFarm, farms, loading: farmsLoading, refreshFarms } = useFarm();
  const [farmDetail, setFarmDetail] = useState(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [open, setOpen] = useState({});
  const [selectedFarmId, setSelectedFarmId] = useState('');
  const [selectedBlock, setSelectedBlock] = useState('');
  const [setupMode, setSetupMode] = useState('row');
  const [rowName, setRowName] = useState('');
  const [lotName, setLotName] = useState('');
  const [selectedRowIds, setSelectedRowIds] = useState([]);
  const [assignLotId, setAssignLotId] = useState('');
  const [editingRowId, setEditingRowId] = useState(null);
  const [editingLotId, setEditingLotId] = useState(null);
  const [plotCorners, setPlotCorners] = useState(clonePlotCorners());
  const [message, setMessage] = useState(null);
  const [multiRowReady, setMultiRowReady] = useState(null);

  useEffect(() => {
    hasMultiRowLotsSupport().then(setMultiRowReady);
  }, []);

  useEffect(() => {
    if (activeFarm && !selectedFarmId) {
      setSelectedFarmId(String(activeFarm.id));
    } else if (!activeFarm && farms.length && !selectedFarmId) {
      setSelectedFarmId(String(farms[0].id));
    }
  }, [activeFarm, farms, selectedFarmId]);

  const fetchHierarchy = useCallback(async (farmId) => {
    if (!farmId) {
      setFarmDetail(null);
      return;
    }

    setHierarchyLoading(true);
    setFetchError(null);

    try {
      const data = await fetchFarmLayout(farmId);
      setFarmDetail(data);
    } catch (err) {
      setFetchError(err.message);
      setFarmDetail(farms.find((f) => String(f.id) === String(farmId)) || null);
    }
    setHierarchyLoading(false);
  }, [farms]);

  useEffect(() => {
    fetchHierarchy(selectedFarmId);
  }, [selectedFarmId, fetchHierarchy]);

  const handleToggle = (id) => {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const farmBlocks = farmDetail ? getBlocksForFarm(farmDetail) : [];
  const currentBlock = farmBlocks.find((b) => String(b.id) === selectedBlock);
  const blockRows = currentBlock?.rows || [];
  const blockLots = currentBlock?.lots || [];
  const totalLots = farmBlocks.reduce((count, block) => count + (block.lots?.length || 0), 0);
  const totalRows = farmBlocks.reduce((count, block) => count + (block.rows?.length || 0), 0);

  useEffect(() => {
    if (farmBlocks.length && !selectedBlock) {
      setSelectedBlock(String(farmBlocks[0].id));
    }
  }, [farmBlocks, selectedBlock]);

  useEffect(() => {
    if (totalRows > 0 && totalLots === 0 && setupMode === 'row') {
      setSetupMode('lot');
    }
  }, [totalRows, totalLots, setupMode]);

  const reload = async () => {
    await refreshFarms();
    await fetchHierarchy(selectedFarmId);
  };

  const handleEnsureBlocks = async () => {
    if (!selectedFarmId) return;
    setMessage(null);
    try {
      await ensureBlocksForFarm(Number(selectedFarmId));
      setMessage({ type: 'success', text: 'A and B are ready.' });
      await reload();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleAddRow = async () => {
    if (!selectedBlock || !rowName.trim()) {
      setMessage({ type: 'error', text: 'Select A or B and enter a row name (e.g. R01).' });
      return;
    }
    const name = normalizeRow(rowName);
    try {
      if (editingRowId) {
        await updateRowName(editingRowId, name);
        setMessage({ type: 'success', text: `${name} updated.` });
        setEditingRowId(null);
      } else {
        const { error } = await supabase.from('rows').insert([{ name, section_id: Number(selectedBlock) }]);
        if (error) throw error;
        setMessage({ type: 'success', text: `${name} added to ${currentBlock?.name}.` });
      }
      setRowName('');
      await reload();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleEditRow = (row, blockId) => {
    setSetupMode('row');
    setEditingRowId(row.id);
    setEditingLotId(null);
    setRowName(normalizeRow(row.name));
    setSelectedBlock(String(blockId));
    setMessage(null);
  };

  const handleDeleteRow = async (row) => {
    if (!window.confirm(`Delete row ${normalizeRow(row.name)}?`)) return;
    setMessage(null);
    try {
      await deleteRow(row.id);
      if (editingRowId === row.id) {
        setEditingRowId(null);
        setRowName('');
      }
      setMessage({ type: 'success', text: `${normalizeRow(row.name)} deleted.` });
      await reload();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleAddLot = async () => {
    if (!selectedBlock || !lotName.trim() || selectedRowIds.length === 0) {
      setMessage({ type: 'error', text: 'Select A or B, lot name (L01/L02), and at least one row.' });
      return;
    }
    const name = normalizeLot(lotName);
    if (!VALID_LOT_CODES.includes(name)) {
      setMessage({ type: 'error', text: `Lot must be one of: ${VALID_LOT_CODES.join(', ')}` });
      return;
    }

    try {
      const { corners, error: cornerError } = parsePlotCorners(plotCorners);
      if (cornerError) {
        setMessage({ type: 'error', text: cornerError });
        return;
      }

      if (editingLotId) {
        await updateLotName(editingLotId, name);
        await assignLotRows(editingLotId, selectedRowIds);
        if (corners) {
          await updateLotBoundary(editingLotId, corners);
        }
        setMessage({ type: 'success', text: `${name} updated${corners ? ' with plot boundary' : ''}.` });
        setEditingLotId(null);
      } else {
        const lot = await createLotWithRows({
          name,
          sectionId: Number(selectedBlock),
          rowIds: selectedRowIds,
        });
        if (corners) {
          await updateLotBoundary(lot.id, corners);
        }
        setMessage({ type: 'success', text: `${name} created with ${selectedRowIds.length} row(s)${corners ? ' and plot boundary' : ''}.` });
      }
      setLotName('');
      setSelectedRowIds([]);
      setPlotCorners(clonePlotCorners());
      await reload();
      setMultiRowReady(await hasMultiRowLotsSupport());
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleEditLot = (lot, blockId) => {
    setSetupMode('lot');
    setEditingLotId(lot.id);
    setEditingRowId(null);
    setLotName(normalizeLot(lot.name));
    setSelectedBlock(String(blockId));
    const rowIds = (lot.lot_rows || [])
      .map((link) => link.row_id || link.rows?.id)
      .filter(Boolean)
      .map(String);
    if (!rowIds.length && lot.row_id) rowIds.push(String(lot.row_id));
    setSelectedRowIds(rowIds);
    const existingCorners = getLotBoundaryCorners(lot);
    setPlotCorners(
      existingCorners.length === 4
        ? existingCorners.map((corner) => ({
          latitude: String(corner.latitude),
          longitude: String(corner.longitude),
        }))
        : clonePlotCorners(),
    );
    setMessage(null);
  };

  const handleDeleteLot = async (lot) => {
    if (!window.confirm(`Delete lot ${normalizeLot(lot.name)}?`)) return;
    setMessage(null);
    try {
      await deleteLot(lot.id);
      if (editingLotId === lot.id) {
        setEditingLotId(null);
        setLotName('');
        setSelectedRowIds([]);
        setPlotCorners(clonePlotCorners());
      }
      setMessage({ type: 'success', text: `${normalizeLot(lot.name)} deleted.` });
      await reload();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleAssignRows = async () => {
    if (!assignLotId || selectedRowIds.length === 0) {
      setMessage({ type: 'error', text: 'Select a lot and at least one row to assign.' });
      return;
    }

    try {
      await assignLotRows(Number(assignLotId), selectedRowIds);
      setMessage({ type: 'success', text: `Updated lot with ${selectedRowIds.length} row(s).` });
      setSelectedRowIds([]);
      await reload();
      setMultiRowReady(await hasMultiRowLotsSupport());
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleSubmit = async () => {
    setMessage(null);
    if (setupMode === 'row') await handleAddRow();
    else if (setupMode === 'lot') await handleAddLot();
    else await handleAssignRows();
  };

  const renderRows = (rows, level, blockId) => {
    if (!rows?.length) {
      return (
        <ListItem sx={{ pl: level * 2 }}>
          <ListItemText primary="No rows" />
        </ListItem>
      );
    }
    return rows.map((row) => (
        <ListItem
          key={row.id}
          sx={{ pl: level * 2 }}
          secondaryAction={(
            <Stack direction="row" spacing={0.5}>
              <IconButton edge="end" aria-label="Edit row" size="small" onClick={() => handleEditRow(row, blockId)}>
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton edge="end" aria-label="Delete row" size="small" onClick={() => handleDeleteRow(row)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          )}
        >
          <ListItemText primary={`Row: ${normalizeRow(row.name)}`} />
        </ListItem>
      ));
  };

  const renderBlock = (block) => {
    const blockKey = `block-${block.id}`;
    const rows = (block.rows || []).slice().sort((a, b) => normalizeRow(a.name).localeCompare(normalizeRow(b.name)));
    const lots = (block.lots || []).slice().sort((a, b) => normalizeLot(a.name).localeCompare(normalizeLot(b.name)));

    return (
      <React.Fragment key={block.id}>
        <ListItem button onClick={() => handleToggle(blockKey)} sx={{ pl: 4 }}>
          <ListItemText primary={block.name} />
          {open[blockKey] ? <ExpandLess /> : <ExpandMore />}
        </ListItem>
        <Collapse in={open[blockKey]} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            <ListItem sx={{ pl: 6 }}>
              <ListItemText primary={`Rows: ${rows.length ? rows.map((r) => normalizeRow(r.name)).join(', ') : 'none yet'}`} />
            </ListItem>
            {lots.length === 0 ? (
              <ListItem sx={{ pl: 6 }}><ListItemText primary="No lots yet" /></ListItem>
            ) : (
              lots.map((lot) => (
                <ListItem
                  key={lot.id}
                  sx={{ pl: 6 }}
                  secondaryAction={(
                    <Stack direction="row" spacing={0.5}>
                      <IconButton edge="end" aria-label="Edit lot" size="small" onClick={() => handleEditLot(lot, block.id)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton edge="end" aria-label="Delete lot" size="small" onClick={() => handleDeleteLot(lot)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  )}
                >
                  <ListItemText primary={`${normalizeLot(lot.name)} → ${formatLotRowAssignment(lot)}`} secondary={getLotBoundaryCorners(lot).length === 4 ? 'Plot boundary set' : 'No plot boundary'} />
                </ListItem>
              ))
            )}
            {renderRows(rows, 3, block.id)}
          </List>
        </Collapse>
      </React.Fragment>
    );
  };

  const rowSelect = (
    <FormControl fullWidth margin="normal">
      <InputLabel>Rows</InputLabel>
      <Select
        multiple
        value={selectedRowIds}
        label="Rows"
        onChange={(e) => setSelectedRowIds(e.target.value)}
        input={<OutlinedInput label="Rows" />}
        renderValue={(selected) => (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {selected.map((id) => {
              const row = blockRows.find((r) => String(r.id) === String(id));
              return <Chip key={id} label={normalizeRow(row?.name)} size="small" />;
            })}
          </Box>
        )}
      >
        {blockRows.map((row) => (
          <MenuItem key={row.id} value={String(row.id)}>{normalizeRow(row.name)}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const selectedFarmRecord = farms.find((f) => String(f.id) === selectedFarmId);
  const loading = farmsLoading || hierarchyLoading;

  if (farmsLoading) return <CircularProgress />;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Farm Setup</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Layout: <strong>A or B</strong> → <strong>Row (R01…R08)</strong> →{' '}
        <strong>Lot (L01/L02)</strong>. Assign one or many rows to each lot — e.g. L01 can cover R01 through R08.
      </Typography>

      {fetchError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Could not load full farm layout: {fetchError}
        </Alert>
      )}

      {totalRows > 0 && totalLots === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No lots yet. Use <strong>Layout setup → Action: Lot</strong> below to create <strong>L01</strong> or{' '}
          <strong>L02</strong>, assign rows, and enter the 4 plot corner coordinates for satellite data.
        </Alert>
      )}

      {totalRows === 0 && farmBlocks.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Add rows first (<strong>Action: Row</strong>, e.g. R01–R08), then create lots.
        </Alert>
      )}

      {multiRowReady === false && (
        <Alert severity="info" sx={{ mb: 2 }}>
          To assign multiple rows to one lot (e.g. R01–R08 → L01), run the SQL below once in{' '}
          <strong>Supabase → SQL Editor</strong>, then reload this page.
        </Alert>
      )}

      {multiRowReady === true && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Multi-row lots are enabled. You can assign R01–R08 to L01 in one step.
        </Alert>
      )}

      {!farms.length && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No farm found. Create your farm in <strong>Settings</strong> first, then return here.
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <List>
          {(farmDetail ? [farmDetail] : selectedFarmRecord ? [selectedFarmRecord] : []).map((farm) => (
            <React.Fragment key={farm.id}>
              <ListItem button onClick={() => handleToggle(`farm-${farm.id}`)}>
                <ListItemText primary={`Farm: ${farm.name}`} secondary={`ID: ${farm.id}`} />
                {open[`farm-${farm.id}`] ? <ExpandLess /> : <ExpandMore />}
              </ListItem>
              <Collapse in={open[`farm-${farm.id}`]} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                  {getBlocksForFarm(farm).length
                    ? getBlocksForFarm(farm).map(renderBlock)
                    : (
                      <ListItem sx={{ pl: 4 }}>
                        <ListItemText primary="No A/B yet — use “Create A & B” below" />
                      </ListItem>
                    )}
                </List>
              </Collapse>
            </React.Fragment>
          ))}
        </List>
      </Paper>

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Layout setup</Typography>
        {message && <Alert severity={message.type} sx={{ mb: 2 }}>{message.text}</Alert>}

        <FormControl fullWidth margin="normal" required disabled={!farms.length}>
          <InputLabel>Farm</InputLabel>
          <Select
            value={selectedFarmId}
            label="Farm"
            onChange={(e) => {
              setSelectedFarmId(e.target.value);
              setSelectedBlock('');
              setSelectedRowIds([]);
            }}
          >
            {farms.map((f) => (
              <MenuItem key={f.id} value={String(f.id)}>{f.name}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {selectedFarmRecord && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Working on: <strong>{selectedFarmRecord.name}</strong>
          </Typography>
        )}

        <Button variant="outlined" onClick={handleEnsureBlocks} sx={{ mb: 2 }} disabled={!selectedFarmId || loading}>
          Create A &amp; B
        </Button>

        <Divider sx={{ my: 2 }} />

        <FormControl fullWidth margin="normal">
          <InputLabel>Action</InputLabel>
          <Select value={setupMode} label="Action" onChange={(e) => {
            setSetupMode(e.target.value);
            setSelectedRowIds([]);
            setAssignLotId('');
            setEditingRowId(null);
            setEditingLotId(null);
            setRowName('');
            setLotName('');
            if (e.target.value !== 'lot') {
              setPlotCorners(clonePlotCorners());
            }
          }}>
            {SETUP_MODES.map((mode) => (
              <MenuItem key={mode.id} value={mode.id}>
                {mode.id === 'lot' ? 'Lot (L01/L02 + plot boundary)' : mode.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {setupMode !== 'assign' && (
          <FormControl fullWidth margin="normal" disabled={!farmBlocks.length}>
            <InputLabel>A / B</InputLabel>
            <Select value={selectedBlock} label="A / B" onChange={(e) => { setSelectedBlock(e.target.value); setSelectedRowIds([]); }}>
              {farmBlocks.map((b) => (
                <MenuItem key={b.id} value={String(b.id)}>{b.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {setupMode === 'row' && (
          <TextField
            label="Row name"
            fullWidth
            margin="normal"
            value={rowName}
            onChange={(e) => setRowName(e.target.value)}
            placeholder="R01"
            helperText="Add rows R01 through R08 before creating lots"
          />
        )}

        {setupMode === 'lot' && (
          <>
            <Alert severity="info" sx={{ mb: 1 }}>
              Create or edit a lot here. Each lot needs a name (L01/L02), row assignment, and 4 GPS corners for
              Sentinel-2 plot fetch.
            </Alert>
            <TextField
              label="Lot name"
              fullWidth
              margin="normal"
              value={lotName}
              onChange={(e) => setLotName(e.target.value)}
              placeholder="L01 or L02"
            />
            {rowSelect}
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
              Plot boundary (4 corners)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Used for Sentinel-2 fetch across the whole lot. Enter corners in order around the plot.
            </Typography>
            {plotCorners.map((corner, index) => (
              <Stack key={`corner-${index}`} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
                <TextField
                  label={`Corner ${index + 1} latitude`}
                  fullWidth
                  value={corner.latitude}
                  onChange={(e) => {
                    const next = clonePlotCorners(plotCorners);
                    next[index].latitude = e.target.value;
                    setPlotCorners(next);
                  }}
                  placeholder="16.322310"
                />
                <TextField
                  label={`Corner ${index + 1} longitude`}
                  fullWidth
                  value={corner.longitude}
                  onChange={(e) => {
                    const next = clonePlotCorners(plotCorners);
                    next[index].longitude = e.target.value;
                    setPlotCorners(next);
                  }}
                  placeholder="73.429313"
                />
              </Stack>
            ))}
          </>
        )}

        {setupMode === 'assign' && (
          <>
            <FormControl fullWidth margin="normal">
              <InputLabel>A / B</InputLabel>
              <Select value={selectedBlock} label="A / B" onChange={(e) => { setSelectedBlock(e.target.value); setAssignLotId(''); setSelectedRowIds([]); }}>
                {farmBlocks.map((b) => (
                  <MenuItem key={b.id} value={String(b.id)}>{b.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth margin="normal">
              <InputLabel>Lot</InputLabel>
              <Select value={assignLotId} label="Lot" onChange={(e) => setAssignLotId(e.target.value)}>
                {blockLots.map((lot) => (
                  <MenuItem key={lot.id} value={String(lot.id)}>
                    {normalizeLot(lot.name)} (currently: {formatLotRowAssignment(lot)})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {rowSelect}
          </>
        )}

        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={
            !selectedFarmId
            || loading
            || (setupMode === 'row' && !rowName.trim())
            || ((setupMode === 'lot' || setupMode === 'assign') && selectedRowIds.length === 0)
            || (setupMode === 'lot' && !lotName.trim())
            || (setupMode === 'assign' && !assignLotId)
          }
        >
          {setupMode === 'row' ? (editingRowId ? 'Update Row' : 'Add Row') : setupMode === 'lot' ? (editingLotId ? 'Update Lot' : 'Create Lot') : 'Update row assignment'}
        </Button>
      </Paper>
    </Box>
  );
}

export default FarmSetup;
