import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { formatNextMonday, getWeekMonday } from '../../utils/treeSatelliteCache';
import { loadCachedGpsAnalysis } from '../../utils/treeGpsSatelliteCache';
import SatelliteAnalysisDisplay from './SatelliteAnalysisDisplay';
import { getTreeGps } from '../../utils/schema';

class SatelliteTabErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Alert severity="error">
          Could not display satellite data: {this.state.error.message || 'Unknown error'}.
          {' '}Try Reload on this tab, or refresh the page.
        </Alert>
      );
    }
    return this.props.children;
  }
}

function SatelliteTab({ tree }) {
  const [analysis, setAnalysis] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const positionId = tree?.tree_positions?.id ?? null;
  const gps = getTreeGps(tree);
  const latitude = gps?.latitude ?? null;
  const longitude = gps?.longitude ?? null;

  const loadCache = useCallback(async () => {
    if (latitude == null || longitude == null) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const result = await loadCachedGpsAnalysis(supabase, positionId);

    if (result.error && !result.analysis) {
      setError(result.error);
      setAnalysis(null);
      setMeta(null);
    } else if (result.empty) {
      setAnalysis(null);
      setMeta({
        empty: true,
        weekStart: result.weekStart || getWeekMonday(),
        nextFetchLabel: result.nextFetchLabel || formatNextMonday(),
      });
      setError(null);
    } else {
      setAnalysis(result.analysis);
      setMeta({
        fetchedAt: result.fetchedAt,
        weekStart: result.weekStart,
        cacheError: result.error,
      });
      setError(null);
    }

    setLoading(false);
  }, [latitude, longitude, positionId]);

  useEffect(() => {
    loadCache();
  }, [loadCache]);

  if (latitude == null || longitude == null) {
    return (
      <Alert severity="warning">
        GPS coordinates are missing for this tree. Edit the tree and add latitude/longitude
        to enable satellite analysis.
      </Alert>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!analysis) {
    return (
      <Box>
        <Alert severity="info" sx={{ mb: 2 }}>
          No satellite data cached for this tree yet
          {meta?.weekStart ? ` (week of ${meta.weekStart})` : ''}.
          {' '}An admin can run the weekly batch refresh from{' '}
          <RouterLink to="/admin/settings">Settings → Satellite cache</RouterLink>.
          {meta?.nextFetchLabel && (
            <> Next scheduled week starts {meta.nextFetchLabel}.</>
          )}
        </Alert>
        <Typography variant="body2" color="text.secondary">
          Satellite analysis is fetched once per week for all trees and stored in the database
          so each tree opens instantly.
        </Typography>
      </Box>
    );
  }

  return (
    <SatelliteTabErrorBoundary>
      <Box>
        {meta?.cacheError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Last batch refresh recorded an error for this tree: {meta.cacheError}
          </Alert>
        )}
        <SatelliteAnalysisDisplay
          analysis={analysis}
          latitude={latitude}
          longitude={longitude}
          fetchedAt={meta?.fetchedAt}
          weekStart={meta?.weekStart}
          onRefresh={loadCache}
          cacheNote="Data is refreshed weekly via pg_cron (or manual batch in Settings). Reload reads the latest cache."
        />
      </Box>
    </SatelliteTabErrorBoundary>
  );
}

export default SatelliteTab;
