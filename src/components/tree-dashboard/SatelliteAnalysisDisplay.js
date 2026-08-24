import React from 'react';
import {
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
import { formatDate, formatNumber } from '../../utils/formatters';
import { severityChipColor } from '../../utils/gpsSatelliteAnalysis';

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

export function SatelliteAnalysisDisplay({
  analysis,
  latitude,
  longitude,
  fetchedAt,
  weekStart,
  onRefresh,
  refreshing = false,
  cacheNote,
}) {
  if (!analysis) return null;

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
            {latitude != null && longitude != null && (
              <> · {formatNumber(latitude, 6)}, {formatNumber(longitude, 6)}</>
            )}
          </Typography>
          {(fetchedAt || weekStart) && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {weekStart && <>Week of {formatDate(weekStart)} · </>}
              {fetchedAt && <>Cached {formatDate(fetchedAt)}</>}
            </Typography>
          )}
          {cacheNote && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {cacheNote}
            </Typography>
          )}
        </Box>
        {onRefresh && (
          <Button
            variant="outlined"
            size="small"
            startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Reloading…' : 'Reload cache'}
          </Button>
        )}
      </Box>

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
          <MetricCard label="NDVI" value={formatNumber(indices.NDVI, 3)} chipLabel={indexStatus.NDVI} />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <MetricCard label="NDMI" value={formatNumber(indices.NDMI, 3)} chipLabel={indexStatus.NDMI} />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <MetricCard label="NDRE" value={formatNumber(indices.NDRE, 3)} chipLabel={indexStatus.NDRE} />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <MetricCard label="S1 VV" value={formatNumber(indices.S1_VV, 3)} subtitle="Sentinel-1 backscatter" />
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

export default SatelliteAnalysisDisplay;
