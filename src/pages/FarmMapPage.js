import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, CircularProgress, Alert, TextField, InputAdornment,
  IconButton, Chip, Grid, FormControl, InputLabel, Select, MenuItem, Button, Tooltip,
  Collapse, useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import FilterListIcon from '@mui/icons-material/FilterList';
import { supabase } from '../supabaseClient';
import { parsePositionCode, formatLocationLabel, normalizeRow } from '../utils/positionCode';
import { getActiveIrrigationLink, getActiveTreeInstance } from '../utils/schema';
import {
  EMPTY_TREE_FILTERS,
  applyFilterPatch,
  buildTreeFilterOptions,
  getPositionBlock,
  hasActiveTreeFilters,
  matchesTreeFilters,
  normalizeFilterValue,
} from '../utils/treeSearch';
import { StatusDot } from '../components/common/GpsTreeDotMap';
import { CommonBelowNutrientsSummary } from '../components/soil/CommonBelowNutrientsSummary';
import PageHeader from '../components/common/PageHeader';

const SECOND_SECTION_START_ROW = 9;
const QUICK_RESULT_LIMIT = 8;

const ROW_BANDS = [
  { key: 'upper', fallbackLabel: `Zone · rows ${SECOND_SECTION_START_ROW}+`, rowHint: `Rows ${SECOND_SECTION_START_ROW}+` },
  { key: 'lower', fallbackLabel: `Zone · rows 1–${SECOND_SECTION_START_ROW - 1}`, rowHint: `Rows 1–${SECOND_SECTION_START_ROW - 1}` },
];

const BLOCK_ACCENT = {
  B: 'info',
  A: 'primary',
};

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

function rowNumberFromCode(rowCode) {
  const n = Number(String(rowCode || '').replace(/^R/i, ''));
  return Number.isFinite(n) ? n : 0;
}

function getPositionRowNumber(pos) {
  const parsed = parsePositionCode(pos?.position_code);
  return rowNumberFromCode(parsed?.row || pos?.rowCode);
}

function getPositionRowBand(pos) {
  return getPositionRowNumber(pos) >= SECOND_SECTION_START_ROW ? 'upper' : 'lower';
}

function getPositionZoneCode(pos) {
  return getActiveIrrigationLink(pos?.activeTree)?.irrigation_zones?.zone_code || null;
}

function zoneTitleForPositions(positions, fallbackLabel) {
  const codes = [...new Set(positions.map(getPositionZoneCode).filter(Boolean))].sort();
  if (codes.length === 1) return codes[0];
  if (codes.length > 1) return codes.join(' · ');
  return fallbackLabel;
}

function positionsInSectionBand(positions, section, band) {
  return positions
    .filter((pos) => getPositionBlock(pos) === section && getPositionRowBand(pos) === band)
    .sort((a, b) => a.position_code.localeCompare(b.position_code));
}

function groupPositionsByRow(positions) {
  const map = new Map();
  positions.forEach((pos) => {
    const row = parsePositionCode(pos.position_code)?.row || pos.rowCode || '—';
    if (!map.has(row)) map.set(row, []);
    map.get(row).push(pos);
  });
  return [...map.entries()].sort(
    (a, b) => rowNumberFromCode(b[0]) - rowNumberFromCode(a[0]),
  );
}

function TreeNameLink({ pos }) {
  const theme = useTheme();
  const parsed = parsePositionCode(pos.position_code);
  const treeName = parsed?.tree || pos.position_code.split('-').pop() || pos.position_code;
  const title = [
    pos.position_code,
    pos.activeTree?.variety,
    parsed ? formatLocationLabel(parsed) : null,
  ].filter(Boolean).join(' · ');

  return (
    <Tooltip title={title} arrow>
      <Box
        component={RouterLink}
        to={`/tree/${pos.position_code}`}
        aria-label={title}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          textDecoration: 'none',
          minHeight: 40,
          px: 1,
          py: 0.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: alpha(theme.palette.success.main, 0.35),
          bgcolor: alpha(theme.palette.success.main, 0.08),
          '&:hover': {
            bgcolor: alpha(theme.palette.success.main, 0.18),
            borderColor: theme.palette.success.main,
          },
        }}
      >
        <StatusDot color={theme.palette.success.main} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary', lineHeight: 1.2 }}>
            {treeName}
          </Typography>
          {pos.activeTree?.variety ? (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 88 }}>
              {pos.activeTree.variety}
            </Typography>
          ) : null}
        </Box>
      </Box>
    </Tooltip>
  );
}

function ZoneCard({ section, band, positions, cardRef }) {
  const theme = useTheme();
  const rows = groupPositionsByRow(positions);
  const zoneTitle = zoneTitleForPositions(positions, band.fallbackLabel);

  return (
    <Paper
      ref={cardRef}
      sx={{
        p: 1.5,
        flex: 1,
        bgcolor: alpha(theme.palette.background.paper, 0.6),
      }}
      variant="outlined"
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            {zoneTitle}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Block {section} · {band.rowHint}
          </Typography>
        </Box>
        <Chip size="small" variant="outlined" label={`${positions.length} tree${positions.length === 1 ? '' : 's'}`} />
      </Box>
      {positions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No trees in this zone.</Typography>
      ) : (
        rows.map(([rowCode, rowPositions]) => (
          <Box
            key={rowCode}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1,
              py: 0.75,
              px: 0.75,
              mb: 0.5,
              borderRadius: 1,
              '&:last-of-type': { mb: 0 },
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Chip
              size="small"
              label={rowCode}
              sx={{ fontWeight: 700, mt: 0.5, minWidth: 56 }}
            />
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, flex: 1 }}>
              {rowPositions.map((pos) => (
                <TreeNameLink key={pos.id} pos={pos} />
              ))}
            </Box>
          </Box>
        ))
      )}
    </Paper>
  );
}

function BlockColumn({ block, positions, firstMatchKey, firstMatchRef, blockRef }) {
  const theme = useTheme();
  const accent = theme.palette[BLOCK_ACCENT[block]]?.main || theme.palette.primary.main;

  return (
    <Paper
      ref={blockRef}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid',
        borderColor: alpha(accent, 0.45),
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: alpha(accent, 0.16),
          borderBottom: '1px solid',
          borderColor: alpha(accent, 0.28),
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Block {block}
        </Typography>
        <Chip
          size="small"
          label={`${positionsInSectionBand(positions, block, 'upper').length
            + positionsInSectionBand(positions, block, 'lower').length} trees`}
        />
      </Box>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
        {ROW_BANDS.map((band) => {
          const key = `${block}-${band.key}`;
          return (
            <ZoneCard
              key={key}
              section={block}
              band={band}
              positions={positionsInSectionBand(positions, block, band.key)}
              cardRef={firstMatchKey === key ? firstMatchRef : null}
            />
          );
        })}
      </Box>
    </Paper>
  );
}

function FilterSelect({
  label, value, options, onChange, disabled = false,
}) {
  return (
    <FormControl size="small" fullWidth disabled={disabled}>
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
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [rows, setRows] = useState([]);
  const [sensorObservations, setSensorObservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_TREE_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const firstMatchRef = useRef(null);
  const blockBRef = useRef(null);
  const blockARef = useRef(null);

  useEffect(() => {
    async function loadMap() {
      setLoading(true);
      try {
        const [{ data, error: rowsError }, { data: soilData }] = await Promise.all([
          supabase
            .from('rows')
            .select(`
            id, name,
            sections ( name ),
            lot_rows (
              lots (
                id, name,
                tree_positions (
                  id, position_code,
                  trees (
                    id, status, variety, planting_date,
                    tree_irrigation_zones (
                      zone_id,
                      end_date,
                      irrigation_zones ( id, zone_code )
                    )
                  )
                )
              )
            )
          `)
            .order('name'),
          supabase
            .from('soil_observations')
            .select('*')
            .order('observed_at', { ascending: false })
            .limit(2000),
        ]);

        if (rowsError) throw rowsError;
        setRows(data || []);
        setSensorObservations(soilData || []);
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
  const filtersOpen = isDesktop || showFilters || filtersActive;
  const previewResults = filtersActive ? filteredPositions.slice(0, QUICK_RESULT_LIMIT) : [];
  const mapPositions = filtersActive ? filteredPositions : allPositions;
  const firstMatchKey = filtersActive && filteredPositions[0]
    ? `${getPositionBlock(filteredPositions[0])}-${getPositionRowBand(filteredPositions[0])}`
    : null;
  const singleMatch = filteredPositions.length === 1 ? filteredPositions[0] : null;

  const updateFilter = (key, value) => {
    setFilters((prev) => applyFilterPatch(prev, key, normalizeFilterValue(key, value)));
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilters(EMPTY_TREE_FILTERS);
    setShowFilters(false);
  };

  const openSingleMatch = () => {
    if (singleMatch?.position_code) {
      navigate(`/tree/${singleMatch.position_code}`);
    }
  };

  const scrollToBlock = (block) => {
    const node = block === 'B' ? blockBRef.current : blockARef.current;
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        subtitle="Search or filter, then tap a tree. Block B is on the left, Block A on the right."
      />

      <CommonBelowNutrientsSummary
        observations={sensorObservations}
        sourceText="From Monitoring → Soil, using each tree's latest 7-in-1 reading (not moisture)."
        linkTo="/monitoring/soil"
        linkLabel="Open Soil monitoring"
      />

      <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
          Find a tree
        </Typography>
        <TextField
          fullWidth
          placeholder="Search code or variety — A-R01-L01-T01, Alphonso, R03"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && singleMatch) openSingleMatch();
          }}
          helperText={singleMatch ? 'Press Enter to open this tree' : ' '}
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

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, mb: 1, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            color={filtersActive && filteredPositions.length === 0 ? 'warning' : 'primary'}
            variant={filtersActive ? 'filled' : 'outlined'}
            label={filtersActive
              ? `${filteredPositions.length} of ${allPositions.length} trees`
              : `${allPositions.length} trees`}
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
          {!isDesktop && (
            <Button
              size="small"
              startIcon={<FilterListIcon />}
              onClick={() => setShowFilters((open) => !open)}
            >
              {filtersOpen ? 'Hide filters' : 'Filters'}
            </Button>
          )}
          {filtersActive && (
            <Button size="small" onClick={clearFilters}>Clear</Button>
          )}
        </Box>

        <Collapse in={filtersOpen}>
          <Grid container spacing={1.5}>
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
            <Grid item xs={12} sm={8} md={4}>
              <FilterSelect
                label="Variety"
                value={filters.variety}
                options={filterOptions.varieties}
                onChange={(value) => updateFilter('variety', value)}
              />
            </Grid>
          </Grid>
        </Collapse>

        {filtersActive && filteredPositions.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            No trees match. Try a shorter search or clear filters.
          </Typography>
        )}

        {previewResults.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Quick open
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {previewResults.map((pos) => (
                <Chip
                  key={pos.id}
                  clickable
                  component={RouterLink}
                  to={`/tree/${pos.position_code}`}
                  label={`${pos.position_code}${pos.activeTree?.variety ? ` · ${pos.activeTree.variety}` : ''}`}
                  sx={{ textDecoration: 'none' }}
                />
              ))}
              {filteredPositions.length > previewResults.length && (
                <Chip
                  variant="outlined"
                  label={`+${filteredPositions.length - previewResults.length} on the map`}
                />
              )}
            </Box>
          </Box>
        )}
      </Paper>

      {allPositions.length === 0 && !filtersActive && (
        <Alert severity="info">No tree positions found. Add trees in Farm Setup and Trees first.</Alert>
      )}

      {allPositions.length > 0 && (
        <>
          <Box sx={{ display: { xs: 'flex', md: 'none' }, gap: 1, mb: 2 }}>
            <Button fullWidth variant="outlined" onClick={() => scrollToBlock('B')}>Block B</Button>
            <Button fullWidth variant="outlined" onClick={() => scrollToBlock('A')}>Block A</Button>
          </Box>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <BlockColumn
                block="B"
                positions={mapPositions}
                firstMatchKey={firstMatchKey}
                firstMatchRef={firstMatchRef}
                blockRef={blockBRef}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <BlockColumn
                block="A"
                positions={mapPositions}
                firstMatchKey={firstMatchKey}
                firstMatchRef={firstMatchRef}
                blockRef={blockARef}
              />
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  );
}

export default FarmMapPage;
