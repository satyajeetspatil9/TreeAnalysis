import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Switch,
  IconButton,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Link as RouterLink } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import { TREE_LIST_SELECT } from '../../utils/schema';
import { parsePositionCode } from '../../utils/positionCode';
import {
  EMPTY_TREE_FILTERS,
  applyFilterPatch,
  buildTreeFilterOptions,
  hasActiveTreeFilters,
  matchesTreeFilters,
  normalizeFilterValue,
} from '../../utils/treeSearch';
import { fetchGpsSatelliteStats, parseCachedAnalysis } from '../../utils/treeGpsSatelliteCache';
import {
  SATELLITE_MONITOR_COLUMNS,
  SATELLITE_STRESS_FILTER_OPTIONS,
  countSatelliteStressRows,
  extractSatelliteIndicators,
  getSatelliteRowMeta,
  matchesSatelliteStressFilter,
} from '../../utils/satelliteMonitoring';
import {
  severityToChipColor,
  stressLevelColor,
  stressPercentTextColor,
} from '../../utils/satelliteDisplay';
import { treeDashboardUrl } from '../../utils/treeDashboard';
import {
  getAnalysisSeasonDate,
  isMonsoonSeason,
  monsoonDisclaimer,
  readHideOpticalWhenCloudy,
  writeHideOpticalWhenCloudy,
} from '../../utils/satelliteMonsoon';

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

function IndicatorChip({ friendly, fallback = '—' }) {
  if (!friendly?.label) {
    return (
      <Typography variant="body2" color="text.secondary">{fallback}</Typography>
    );
  }

  return (
    <Chip
      label={friendly.label}
      size="small"
      color={stressLevelColor(friendly.label)}
      sx={{ maxWidth: '100%' }}
    />
  );
}

function treeToFilterPosition(tree) {
  const pos = tree.tree_positions;
  if (!pos?.position_code) return null;

  const sectionName = pos.lots?.sections?.name
    || pos.lots?.lot_rows?.[0]?.rows?.sections?.name
    || '';

  return {
    id: pos.id,
    position_code: pos.position_code,
    latitude: pos.latitude,
    longitude: pos.longitude,
    activeTree: { variety: tree.variety },
    sectionName,
    treeId: tree.id,
  };
}

function SatelliteMonitoringPage() {
  const { farm, loading: farmLoading } = useFarm();
  const [activeTrees, setActiveTrees] = useState([]);
  const [cacheByPositionId, setCacheByPositionId] = useState(new Map());
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_TREE_FILTERS);
  const [stressFilter, setStressFilter] = useState('all');
  const [hideOpticalWhenCloudy, setHideOpticalWhenCloudy] = useState(readHideOpticalWhenCloudy);

  const load = useCallback(async () => {
    if (!farm?.id) {
      setActiveTrees([]);
      setCacheByPositionId(new Map());
      setStats(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const [treesResult, statsResult] = await Promise.all([
        supabase
          .from('trees')
          .select(TREE_LIST_SELECT)
          .eq('status', 'Active'),
        fetchGpsSatelliteStats(supabase, farm.id).catch(() => null),
      ]);

      if (treesResult.error) throw treesResult.error;

      let cacheResult = await supabase
        .from('tree_gps_satellite_cache')
        .select('position_id, week_start, fetched_at, analysis, error_message, last_good_radar, last_good_radar_week')
        .eq('farm_id', farm.id);

      if (cacheResult.error?.message?.includes('last_good_radar')) {
        setMessage({
          type: 'warning',
          text: 'Run migration 050_tree_gps_last_good_radar.sql in Supabase so cloudy weeks can reuse the last good Sentinel-1 reading.',
        });
        cacheResult = await supabase
          .from('tree_gps_satellite_cache')
          .select('position_id, week_start, fetched_at, analysis, error_message')
          .eq('farm_id', farm.id);
      }

      if (cacheResult.error) {
        if (cacheResult.error.message?.includes('tree_gps_satellite_cache')) {
          setMessage({
            type: 'warning',
            text: 'Run migration 035_tree_gps_satellite_cache.sql in Supabase, then reload.',
          });
        } else {
          throw cacheResult.error;
        }
      }

      const sortedTrees = (treesResult.data || []).sort((a, b) =>
        getTreeDisplayId(a).localeCompare(getTreeDisplayId(b), undefined, { numeric: true }),
      );
      setActiveTrees(sortedTrees);
      setCacheByPositionId(new Map((cacheResult.data || []).map((entry) => [
        entry.position_id,
        {
          ...entry,
          analysis: parseCachedAnalysis(entry.analysis),
          last_good_radar: parseCachedAnalysis(entry.last_good_radar),
        },
      ])));
      setStats(statsResult);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      setActiveTrees([]);
      setCacheByPositionId(new Map());
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [farm?.id]);

  useEffect(() => {
    if (farmLoading) return;
    load();
  }, [load, farmLoading]);

  const allPositions = useMemo(
    () => activeTrees.map(treeToFilterPosition).filter(Boolean),
    [activeTrees],
  );

  const filterOptions = useMemo(
    () => buildTreeFilterOptions(allPositions, filters),
    [allPositions, filters],
  );

  const tableRows = useMemo(() => allPositions.map((pos) => {
    const cache = cacheByPositionId.get(pos.id) || null;
    const hasGps = pos.latitude != null && pos.longitude != null;
    const indicators = cache?.analysis
      ? extractSatelliteIndicators(cache.analysis, cache.last_good_radar, {
        hideOpticalWhenCloudy,
        lastGoodRadarWeek: cache.last_good_radar_week,
      })
      : null;
    const meta = getSatelliteRowMeta({ hasGps, cache, indicators });

    return {
      positionId: pos.id,
      positionCode: pos.position_code,
      variety: pos.activeTree?.variety || '',
      hasGps,
      cache,
      indicators,
      meta,
      parsed: parsePositionCode(pos.position_code),
    };
  }), [allPositions, cacheByPositionId, hideOpticalWhenCloudy]);

  const filteredRows = useMemo(() => tableRows
    .filter((row) => matchesTreeFilters(
      { position_code: row.positionCode, activeTree: { variety: row.variety } },
      searchQuery,
      filters,
    ))
    .filter((row) => matchesSatelliteStressFilter(row.meta.category, stressFilter))
    .sort((a, b) => {
      const rankDiff = a.meta.sortRank - b.meta.sortRank;
      if (rankDiff !== 0) return rankDiff;
      return a.positionCode.localeCompare(b.positionCode, undefined, { numeric: true });
    }), [tableRows, searchQuery, filters, stressFilter]);

  const stressCounts = useMemo(() => countSatelliteStressRows(tableRows), [tableRows]);
  const attentionCount = stressCounts.critical + stressCounts.high + stressCounts.moderate;
  const filtersActive = hasActiveTreeFilters(searchQuery, filters) || stressFilter !== 'all';
  const showMonsoonBanner = useMemo(
    () => filteredRows.some((row) => {
      if (!row.cache?.analysis) return false;
      return isMonsoonSeason(getAnalysisSeasonDate(row.cache.analysis, row.cache.week_start));
    }),
    [filteredRows],
  );

  const updateFilter = (key, value) => {
    setFilters((prev) => applyFilterPatch(prev, key, normalizeFilterValue(key, value)));
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilters(EMPTY_TREE_FILTERS);
    setStressFilter('all');
  };

  if (farmLoading || loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <PageHeader
        section="Monitoring"
        title="Satellite"
        subtitle="Weekly Sentinel signals for active trees. Filter by block, row, lot, variety, or stress level."
      />

      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 2 }}>
        Data refreshes weekly from Settings → Satellite cache.
        {stats && (
          <>
            {' '}This week: {stats.cached_this_week ?? 0} / {stats.total_with_gps ?? 0} GPS trees cached
            {stats.remaining > 0 ? ` · ${stats.remaining} remaining` : ''}.
          </>
        )}
        {' '}When cloud cover is high, optical columns stay hidden unless you turn on Show optical.
      </Alert>

      <FormControlLabel
        sx={{ mb: 2, ml: 0 }}
        control={(
          <Switch
            checked={!hideOpticalWhenCloudy}
            onChange={(e) => {
              const showOptical = e.target.checked;
              setHideOpticalWhenCloudy(!showOptical);
              writeHideOpticalWhenCloudy(!showOptical);
            }}
          />
        )}
        label="Show optical readings when cloudy"
      />

      {showMonsoonBanner && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {monsoonDisclaimer('season')}
        </Alert>
      )}

      <Paper
        sx={(theme) => ({
          p: 2.5,
          mb: 3,
          border: '2px solid',
          borderColor: attentionCount > 0
            ? theme.palette.warning.main
            : alpha(theme.palette.success.main, 0.45),
          borderLeftWidth: 8,
          borderLeftColor: attentionCount > 0
            ? theme.palette.warning.dark
            : theme.palette.success.main,
          bgcolor: attentionCount > 0
            ? alpha(theme.palette.warning.main, 0.12)
            : alpha(theme.palette.success.main, 0.08),
        })}
        variant="outlined"
      >
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
          Orchard satellite summary
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Chip label={`${stressCounts.critical} critical`} color="error" size="small" />
          <Chip label={`${stressCounts.high} high stress`} color="error" variant="outlined" size="small" />
          <Chip label={`${stressCounts.moderate} needs attention`} color="warning" size="small" />
          <Chip label={`${stressCounts.low} looking good`} color="success" size="small" />
          <Chip label={`${stressCounts.no_cache} no data`} color="default" size="small" />
          <Chip label={`${stressCounts.no_gps} missing GPS`} color="default" variant="outlined" size="small" />
        </Box>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
        <TextField
          fullWidth
          size="small"
          placeholder="Search position code or variety (e.g. A-R01-L01-T01, Alphonso)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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
          <Grid item xs={12} sm={8} md={2}>
            <FilterSelect
              label="Variety"
              value={filters.variety}
              options={filterOptions.varieties}
              onChange={(value) => updateFilter('variety', value)}
              minWidth={160}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl size="small" fullWidth>
              <InputLabel>Stress level</InputLabel>
              <Select
                value={stressFilter}
                label="Stress level"
                onChange={(e) => setStressFilter(e.target.value)}
              >
                {SATELLITE_STRESS_FILTER_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1.5, gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">
            {filtersActive
              ? `${filteredRows.length} of ${tableRows.length} trees`
              : `${tableRows.length} trees`}
          </Typography>
          {filtersActive && (
            <Button size="small" onClick={clearFilters}>Clear filters</Button>
          )}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <TableContainer sx={{ maxHeight: '70vh' }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>Tree</TableCell>
                {SATELLITE_MONITOR_COLUMNS.map((column) => (
                  <TableCell key={column.key} sx={{ fontWeight: 700, minWidth: 120 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{column.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{column.short}</Typography>
                  </TableCell>
                ))}
                <TableCell sx={{ fontWeight: 700, minWidth: 110 }}>Updated</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 48 }} align="center" />
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow
                  key={row.positionId}
                  hover
                  sx={(theme) => (
                    ['critical', 'high'].includes(row.meta.category)
                      ? { bgcolor: alpha(theme.palette.error.main, 0.06) }
                      : row.meta.category === 'moderate'
                        ? { bgcolor: alpha(theme.palette.warning.main, 0.05) }
                        : undefined
                  )}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                      <Typography
                        component={RouterLink}
                        to={treeDashboardUrl(row.positionCode, 'satellite')}
                        variant="body2"
                        display="block"
                        sx={{
                          fontWeight: 700,
                          color: 'primary.main',
                          textDecoration: 'none',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {row.positionCode}
                      </Typography>
                      {row.variety && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {row.variety}
                        </Typography>
                      )}
                      {!row.hasGps && (
                        <Chip label="No GPS" size="small" color="default" sx={{ mt: 0.25, alignSelf: 'flex-start' }} />
                      )}
                      {row.indicators?.radarOnly && (
                        <Chip
                          label={row.indicators.opticalHidden ? 'S1 only' : 'Cloudy'}
                          size="small"
                          color="warning"
                          variant="outlined"
                          sx={{ mt: 0.25, alignSelf: 'flex-start' }}
                        />
                      )}
                    </Box>
                  </TableCell>

                  <TableCell>
                    {!row.hasGps ? (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    ) : !row.indicators ? (
                      <Chip label="No data" size="small" />
                    ) : (
                      <Box>
                        <Chip
                          label={row.indicators.overall.label}
                          size="small"
                          color={row.indicators.opticalHidden ? 'warning' : severityToChipColor(row.indicators.overall.label)}
                        />
                        {!row.indicators.opticalHidden && row.indicators.overall.stressPct != null && (
                          <Typography
                            variant="caption"
                            display="block"
                            sx={{ mt: 0.5, color: stressPercentTextColor(row.indicators.overall.stressPct) }}
                          >
                            {formatNumber(row.indicators.overall.stressPct, 0)}%
                          </Typography>
                        )}
                      </Box>
                    )}
                  </TableCell>

                  {SATELLITE_MONITOR_COLUMNS.slice(1).map((column) => (
                    <TableCell key={column.key}>
                      {!row.hasGps || !row.indicators ? (
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      ) : (
                        <Box>
                          <IndicatorChip friendly={row.indicators[column.key]} />
                          {column.key === 'radar' && row.indicators.radarFromPriorWeek && (row.indicators.radarAsOf || row.cache?.last_good_radar_week) && (
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                              from {formatDate(row.indicators.radarAsOf || row.cache.last_good_radar_week)}
                            </Typography>
                          )}
                        </Box>
                      )}
                    </TableCell>
                  ))}

                  <TableCell>
                    {row.cache?.fetched_at
                      ? formatDate(row.cache.fetched_at)
                      : row.hasGps
                        ? 'Pending'
                        : '—'}
                  </TableCell>

                  <TableCell align="center">
                    <IconButton
                      size="small"
                      component={RouterLink}
                      to={treeDashboardUrl(row.positionCode, 'satellite')}
                      aria-label={`Open ${row.positionCode} satellite tab`}
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}

              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={SATELLITE_MONITOR_COLUMNS.length + 3} align="center">
                    <Box sx={{ py: 4 }}>
                      <SatelliteAltIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                      <Typography color="text.secondary">
                        No trees match the current filters.
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}

export default SatelliteMonitoringPage;
