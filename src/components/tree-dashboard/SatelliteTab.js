import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';
import { getTreeGps } from '../../utils/schema';
import {
  fetchGpsSatelliteAnalysis,
  severityChipColor,
} from '../../utils/gpsSatelliteAnalysis';

function MetricCard({ label, value, subtitle, chipLabel }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
        {value}
      </Typography>
      {chipLabel && (
        <Chip
          label={chipLabel}
          size="small"
          color={severityChipColor(chipLabel)}
          sx={{ mt: 1 }}
        />
      )}
      {subtitle && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {subtitle}
        </Typography>
      )}
    </Paper>
  );
}

function DetailRow({ label, value }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right', wordBreak: 'break-word', maxWidth: '70%' }}>
        {value ?? '—'}
      </Typography>
    </Box>
  );
}

function LoadingPanel({ hint }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
      <CircularProgress sx={{ mb: 2 }} />
      <Typography variant="body1" fontWeight={600}>Fetching satellite analysis…</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 420, mx: 'auto' }}>
        {hint || 'First request after idle can take up to 2 minutes while the API wakes up.'}
      </Typography>
    </Box>
  );
}

function SatelliteTab({ tree }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [loadHint, setLoadHint] = useState('');

  const positionCode = getTreeDisplayId(tree);
  const gps = getTreeGps(tree);
  const latitude = gps?.latitude ?? null;
  const longitude = gps?.longitude ?? null;

  const runFetch = useCallback(async ({ signal, isRefresh = false } = {}) => {
    if (latitude == null || longitude == null) {
      setLoading(false);
      return;
    }

    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setLoadHint('Connecting to satellite API…');

    const slowHintTimer = window.setTimeout(() => {
      setLoadHint('Still loading — the satellite API may take 1–2 minutes on first use.');
    }, 15000);

    try {
      const data = await fetchGpsSatelliteAnalysis({
        treeId: positionCode,
        latitude,
        longitude,
        daysBack: 10,
        signal,
      });
      setAnalysis(data);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setAnalysis(null);
      setError(err.message || 'Could not load satellite analysis.');
    } finally {
      window.clearTimeout(slowHintTimer);
      setLoadHint('');
      setLoading(false);
      setRefreshing(false);
    }
  }, [latitude, longitude, positionCode]);

  useEffect(() => {
    if (latitude == null || longitude == null) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    runFetch({ signal: controller.signal });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch when GPS or tree id changes only
  }, [latitude, longitude, positionCode]);

  const handleRefresh = () => {
    runFetch({ isRefresh: true });
  };

  if (latitude == null || longitude == null) {
    return (
      <Alert severity="warning">
        GPS coordinates are missing for this tree. Edit the tree and add latitude/longitude
        to enable satellite analysis.
      </Alert>
    );
  }

  if (loading && !analysis) {
    return <LoadingPanel hint={loadHint} />;
  }

  if (error && !analysis) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={handleRefresh}>
          Retry
        </Button>
      </Box>
    );
  }

  if (!analysis) {
    return (
      <Box>
        <Alert severity="info" sx={{ mb: 2 }}>No satellite data available.</Alert>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={handleRefresh}>
          Retry
        </Button>
      </Box>
    );
  }

  const overall = analysis.overall_condition || {};
  const indices = analysis.indices || {};
  const indexStatus = analysis.index_status || {};
  const water = analysis.water_stress || {};
  const nutrient = analysis.nutrient_stress || {};
  const radar = analysis.radar_stress || {};
  const quality = analysis.data_quality || {};
  const period = analysis.period || {};
  const s2 = analysis.selected_images?.sentinel2;
  const s1 = analysis.selected_images?.sentinel1;
  const sampling = analysis.sampling || {};

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, gap: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SatelliteAltIcon color="primary" />
            GPS satellite analysis
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {formatDate(period.start)} – {formatDate(period.end)}
            {' · '}
            {formatNumber(latitude, 6)}, {formatNumber(longitude, 6)}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Box>

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Last refresh failed: {error}. Showing previous data.
        </Alert>
      )}

      <Paper sx={{ p: 2.5, mb: 2, bgcolor: 'action.hover' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>Overall condition</Typography>
          <Chip
            label={overall.status || 'Unknown'}
            color={severityChipColor(overall.severity || overall.status)}
          />
          {quality.confidence && (
            <Chip label={`Confidence: ${quality.confidence}`} size="small" variant="outlined" />
          )}
        </Box>
        <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
          Score {overall.score ?? '—'} / {overall.max_score ?? '—'}
          {overall.stress_percentage != null && (
            <Typography component="span" variant="h6" color="text.secondary" sx={{ ml: 1 }}>
              ({formatNumber(overall.stress_percentage, 1)}% stress)
            </Typography>
          )}
        </Typography>
        {overall.severity && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {overall.severity}
          </Typography>
        )}
        {Array.isArray(overall.reasons) && overall.reasons.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {overall.reasons.map((reason) => (
              <Chip key={reason} label={reason} size="small" variant="outlined" />
            ))}
          </Box>
        )}
      </Paper>

      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Spectral indices</Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={4} md={3}>
          <MetricCard
            label="NDVI"
            value={formatNumber(indices.NDVI, 3)}
            chipLabel={indexStatus.NDVI}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <MetricCard
            label="NDMI"
            value={formatNumber(indices.NDMI, 3)}
            chipLabel={indexStatus.NDMI}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <MetricCard
            label="NDRE"
            value={formatNumber(indices.NDRE, 3)}
            chipLabel={indexStatus.NDRE}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <MetricCard
            label="S1 VV"
            value={formatNumber(indices.S1_VV, 3)}
            subtitle="Sentinel-1 backscatter"
          />
        </Grid>
      </Grid>

      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Stress indicators</Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <MetricCard
            label="Water stress"
            value={water.status || '—'}
            subtitle={water.score != null ? `Score ${formatNumber(water.score, 1)}` : null}
            chipLabel={water.status}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <MetricCard
            label="Nutrient stress"
            value={nutrient.status || '—'}
            subtitle={nutrient.indicator || null}
            chipLabel={nutrient.status}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <MetricCard
            label="Radar anomaly"
            value={radar.status || '—'}
            subtitle={radar.method || null}
            chipLabel={radar.status}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Data quality</Typography>
            <DetailRow label="Status" value={quality.status} />
            <DetailRow label="Valid observation" value={quality.valid_observation ? 'Yes' : 'No'} />
            <DetailRow label="Sentinel-2 images" value={quality.sentinel2_images} />
            <DetailRow label="Sentinel-1 images" value={quality.sentinel1_images} />
            <DetailRow label="Confidence score" value={quality.confidence_score} />
            <DetailRow label="Sampling" value={sampling.method} />
            <DetailRow label="Radius" value={sampling.radius_m != null ? `${sampling.radius_m} m` : null} />
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Selected imagery</Typography>
            {s2 && (
              <>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Sentinel-2 · {formatDate(s2.date)}
                </Typography>
                <DetailRow label="Scene ID" value={s2.id} />
                <DetailRow label="Cloud cover" value={s2.cloud_cover != null ? `${formatNumber(s2.cloud_cover, 1)}%` : null} />
                <DetailRow label="Clear pixels (SCL)" value={s2.scl_clear_percentage != null ? `${formatNumber(s2.scl_clear_percentage, 0)}%` : null} />
              </>
            )}
            {s1 && (
              <>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                  Sentinel-1 · {formatDate(s1.date)}
                </Typography>
                <DetailRow label="Scene ID" value={s1.id} />
                <DetailRow label="VV (dB)" value={formatNumber(s1.vv_db, 2)} />
              </>
            )}
            {!s2 && !s1 && (
              <Typography variant="body2" color="text.secondary">No image metadata returned.</Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default SatelliteTab;
