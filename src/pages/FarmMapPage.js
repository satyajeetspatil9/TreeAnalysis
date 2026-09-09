import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, CircularProgress, Alert, TextField, InputAdornment,
  IconButton, Chip, List, ListItemButton, ListItemText, Divider, Grid,
  FormControl, InputLabel, Select, MenuItem, Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { supabase } from '../supabaseClient';
import { parsePositionCode, formatLocationLabel, normalizeRow, VALID_LOT_CODES } from '../utils/positionCode';
import { deriveHealthStatus } from '../utils/healthStatus';
import { getActiveTreeInstance } from '../utils/schema';
import {
  EMPTY_TREE_FILTERS,
  applyFilterPatch,
  buildTreeFilterOptions,
  getPositionBlock,
  hasActiveTreeFilters,
  matchesTreeFilters,
  normalizeFilterValue,
} from '../utils/treeSearch';
import PageHeader from '../components/common/PageHeader';

const HEALTH_COLORS = {
  healthy: '#4caf50',
  watch: '#ff9800',
  attention: '#f44336',
};

const QUICK_RESULT_LIMIT = 12;

function collectRowPositions(row) {
  const rowCode = normalizeRow(row.name);
  return (row.lot_rows || []).flatMap((lr) =>
    (lr.lots?.tree_positions || [])
      .filter((pos) => parsePositionCode(pos.position_code)?.row === rowCode)
      .map((pos) => {
        const activeTree = getActiveTreeInstance(pos.trees);
        return activeTree
          ? { ...pos, activeTree, rowId: row.id, rowCode, sectionName: row.sections?.name }
          : null;
      })
      .filter(Boolean),
  );
}

function getPositionLot(pos) {
  return parsePositionCode(pos?.position_code)?.lot || '';
}

function collectLotCodes(positions) {
  const fromData = [...new Set(positions.map(getPositionLot).filter(Boolean))].sort();
  return fromData.length ? fromData : [...VALID_LOT_CODES];
}

function positionsInSectionLot(positions, section, lot) {
  return positions
    .filter((pos) => getPositionBlock(pos) === section && getPositionLot(pos) === lot)
    .sort((a, b) => a.position_code.localeCompare(b.position_code));
}

function groupPositionsByRow(positions) {
  const map = new Map();
  positions.forEach((pos) => {
    const row = parsePositionCode(pos.position_code)?.row || pos.rowCode || '—';
    if (!map.has(row)) map.set(row, []);
    map.get(row).push(pos);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function TreeStatusDot({ pos, highlight }) {
  const parsed = parsePositionCode(pos.position_code);
  const health = deriveHealthStatus(pos.activeTree);

  return (
    <Box
      component={RouterLink}
      to={`/tree/${pos.position_code}`}
      sx={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        bgcolor: HEALTH_COLORS[health],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: 10,
        fontWeight: 700,
        textDecoration: 'none',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        '&:hover': {
          transform: 'scale(1.08)',
          boxShadow: 3,
        },
        ...(highlight && {
          boxShadow: '0 0 0 2px rgba(139, 195, 74, 0.8)',
        }),
      }}
      title={[
        pos.position_code,
        pos.activeTree?.variety,
        parsed ? formatLocationLabel(parsed) : null,
      ].filter(Boolean).join(' · ')}
    >
      {parsed?.tree?.replace('T', '') || pos.position_code.split('-').pop()?.replace('T', '')}
    </Box>
  );
}

function SectionLotCard({ section, lot, positions, highlight, cardRef }) {
  const rows = groupPositionsByRow(positions);

  return (
    <Paper ref={cardRef} sx={{ p: 2, mb: 2, '&:last-of-type': { mb: 0 } }} variant="outlined">
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }} gutterBottom>
        {section} · {lot}
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          ({positions.length} tree{positions.length === 1 ? '' : 's'})
        </Typography>
      </Typography>
      {positions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No trees in this section.</Typography>
      ) : (
        rows.map(([rowCode, rowPositions]) => (
          <Box key={rowCode} sx={{ mb: 1.5, '&:last-of-type': { mb: 0 } }}>
            <Typography variant="caption" color="text.secondary">{rowCode}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 0.5 }}>
              {rowPositions.map((pos) => (
                <TreeStatusDot key={pos.id} pos={pos} highlight={highlight} />
              ))}
            </Box>
          </Box>
        ))
      )}
    </Paper>
  );
}

function BlockColumn({ block, lotCodes, positions, filtersActive, firstMatchKey, firstMatchRef }) {
  return (
    <Paper sx={{ p: 2, height: '100%' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        {block}
      </Typography>
      {lotCodes.map((lot) => {
        const key = `${block}-${lot}`;
        return (
          <SectionLotCard
            key={key}
            section={block}
            lot={lot}
            positions={positionsInSectionLot(positions, block, lot)}
            highlight={filtersActive}
            cardRef={firstMatchKey === key ? firstMatchRef : null}
          />
        );
      })}
    </Paper>
  );
}

function FilterSelect({
  label, value, options, onChange, disabled = false, minWidth = 120,
}) {
  return (
    <FormControl size="small" sx={{ minWidth }} disabled={disabled}>
      <InputLabel>{label}</InputLabel>
      <Select value={value} label={label} onChange={(e) => onChange(e.target.value)}>
        <MenuItem value="">All</MenuItem>
        {options.map((option) => (
          <MenuItem key={option} value={option}>{option}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function FarmMapPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_TREE_FILTERS);
  const firstMatchRef = useRef(null);

  useEffect(() => {
    async function loadMap() {
      setLoading(true);
      try {
        const { data, error: rowsError } = await supabase
          .from('rows')
          .select(`
            id, name,
            sections ( name ),
            lot_rows (
              lots (
                id, name,
                tree_positions (
                  id, position_code,
                  trees ( id, status, variety, planting_date )
                )
              )
            )
          `)
          .order('name');

        if (rowsError) throw rowsError;
        setRows(data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadMap();
  }, []);

  const allPositions = useMemo(
    () => rows.flatMap((row) => collectRowPositions(row)),
    [rows],
  );

  const filterOptions = useMemo(
    () => buildTreeFilterOptions(allPositions, filters),
    [allPositions, filters],
  );

  const filteredPositions = useMemo(
    () => allPositions.filter((pos) => matchesTreeFilters(pos, searchQuery, filters)),
    [allPositions, searchQuery, filters],
  );

  const filtersActive = hasActiveTreeFilters(searchQuery, filters);
  const previewResults = filtersActive ? filteredPositions.slice(0, QUICK_RESULT_LIMIT) : [];
  const lotCodes = useMemo(() => collectLotCodes(allPositions), [allPositions]);
  const mapPositions = filtersActive ? filteredPositions : allPositions;
  const firstMatchKey = filtersActive && filteredPositions[0]
    ? `${getPositionBlock(filteredPositions[0])}-${getPositionLot(filteredPositions[0])}`
    : null;
  const singleMatch = filteredPositions.length === 1 ? filteredPositions[0] : null;

  const updateFilter = (key, value) => {
    setFilters((prev) => applyFilterPatch(prev, key, normalizeFilterValue(key, value)));
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilters(EMPTY_TREE_FILTERS);
  };

  const openSingleMatch = () => {
    if (singleMatch?.position_code) {
      navigate(`/tree/${singleMatch.position_code}`);
    }
  };

  useEffect(() => {
    if (filtersActive && firstMatchRef.current) {
      firstMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchQuery, filters, filtersActive, filteredPositions.length]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      <PageHeader
        section="Orchard"
        title="Tree Dashboard"
        subtitle="Block B on the left, Block A on the right. Each lot shows its trees."
      />

      <Paper sx={{ p: 2, mb: 3 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search position code or variety (e.g. A-R01-L01-T01, Alphonso, R03, T12)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && singleMatch) openSingleMatch();
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
            endAdornment: searchQuery ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearchQuery('')} aria-label="Clear search">
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />

        <Grid container spacing={1.5} sx={{ mt: 1.5 }}>
          <Grid item xs={6} sm={4} md={2}>
            <FilterSelect
              label="Block"
              value={filters.block}
              options={filterOptions.blocks}
              onChange={(value) => updateFilter('block', value)}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <FilterSelect
              label="Row"
              value={filters.row}
              options={filterOptions.rows}
              onChange={(value) => updateFilter('row', value)}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <FilterSelect
              label="Lot"
              value={filters.lot}
              options={filterOptions.lots}
              onChange={(value) => updateFilter('lot', value)}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <FilterSelect
              label="Tree #"
              value={filters.tree}
              options={filterOptions.trees}
              onChange={(value) => updateFilter('tree', value)}
            />
          </Grid>
          <Grid item xs={12} sm={8} md={3}>
            <FilterSelect
              label="Variety"
              value={filters.variety}
              options={filterOptions.varieties}
              onChange={(value) => updateFilter('variety', value)}
              minWidth={160}
            />
          </Grid>
          <Grid item xs={12} sm={4} md={1} sx={{ display: 'flex', alignItems: 'center' }}>
            <Button
              size="small"
              onClick={clearFilters}
              disabled={!filtersActive}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Clear
            </Button>
          </Grid>
        </Grid>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={filtersActive
              ? `${filteredPositions.length} of ${allPositions.length} trees`
              : `${allPositions.length} trees on map`}
            color={filtersActive && filteredPositions.length === 0 ? 'warning' : 'default'}
            variant="outlined"
          />
          {singleMatch && (
            <Button
              size="small"
              variant="contained"
              startIcon={<OpenInNewIcon />}
              onClick={openSingleMatch}
            >
              Open {singleMatch.position_code}
            </Button>
          )}
          {filtersActive && filteredPositions.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No trees match these filters.
            </Typography>
          )}
        </Box>

        {previewResults.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
              Quick results — click to open tree
            </Typography>
            <List dense disablePadding>
              {previewResults.map((pos) => {
                const parsed = parsePositionCode(pos.position_code);
                return (
                  <ListItemButton
                    key={pos.id}
                    component={RouterLink}
                    to={`/tree/${pos.position_code}`}
                    sx={{ borderRadius: 1 }}
                  >
                    <ListItemText
                      primary={pos.position_code}
                      secondary={[
                        pos.activeTree?.variety,
                        parsed ? formatLocationLabel(parsed) : null,
                      ].filter(Boolean).join(' · ')}
                    />
                  </ListItemButton>
                );
              })}
            </List>
            {filteredPositions.length > previewResults.length && (
              <Typography variant="caption" color="text.secondary" sx={{ px: 1, pt: 0.5, display: 'block' }}>
                +{filteredPositions.length - previewResults.length} more on the map below
              </Typography>
            )}
          </>
        )}
      </Paper>

      {allPositions.length === 0 && !filtersActive && (
        <Alert severity="info">No tree positions found. Add trees in Farm Setup and Trees first.</Alert>
      )}

      {allPositions.length > 0 && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <BlockColumn
              block="B"
              lotCodes={lotCodes}
              positions={mapPositions}
              filtersActive={filtersActive}
              firstMatchKey={firstMatchKey}
              firstMatchRef={firstMatchRef}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <BlockColumn
              block="A"
              lotCodes={lotCodes}
              positions={mapPositions}
              filtersActive={filtersActive}
              firstMatchKey={firstMatchKey}
              firstMatchRef={firstMatchRef}
            />
          </Grid>
        </Grid>
      )}
    </Box>
  );
}

export default FarmMapPage;
