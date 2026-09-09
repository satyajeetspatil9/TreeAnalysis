import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, CircularProgress, Alert, TextField, InputAdornment,
  IconButton, Chip, Grid, FormControl, InputLabel, Select, MenuItem, Button,
  Collapse, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import FilterListIcon from '@mui/icons-material/FilterList';
import { supabase } from '../supabaseClient';
import {
  EMPTY_TREE_FILTERS,
  applyFilterPatch,
  buildTreeFilterOptions,
  getPositionBlock,
  hasActiveTreeFilters,
  matchesTreeFilters,
  normalizeFilterValue,
} from '../utils/treeSearch';
import {
  ORCHARD_ROWS_SELECT,
  collectRowPositions,
  getPositionBandKey,
  positionsInBlock,
} from '../utils/orchardLayout';
import OrchardZoneLayout, { useIrrigationZones } from '../components/orchard/OrchardZoneLayout';
import { CommonBelowNutrientsSummary } from '../components/soil/CommonBelowNutrientsSummary';
import PageHeader from '../components/common/PageHeader';

const QUICK_RESULT_LIMIT = 8;

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
  const irrigationZones = useIrrigationZones();

  useEffect(() => {
    async function loadMap() {
      setLoading(true);
      try {
        const [{ data, error: rowsError }, { data: soilData }] = await Promise.all([
          supabase
            .from('rows')
            .select(ORCHARD_ROWS_SELECT)
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
    ? `${getPositionBlock(filteredPositions[0])}-${getPositionBandKey(
      filteredPositions[0],
      positionsInBlock(mapPositions, getPositionBlock(filteredPositions[0])),
      {
        block: getPositionBlock(filteredPositions[0]),
        allZones: irrigationZones,
        allPositions: mapPositions,
      },
    )}`
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
        <OrchardZoneLayout
          positions={mapPositions}
          firstMatchKey={firstMatchKey}
          firstMatchRef={firstMatchRef}
          blockBRef={blockBRef}
          blockARef={blockARef}
        />
      )}
    </Box>
  );
}

export default FarmMapPage;
