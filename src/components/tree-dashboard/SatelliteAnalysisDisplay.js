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
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined';
import GrassOutlinedIcon from '@mui/icons-material/GrassOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import RadarOutlinedIcon from '@mui/icons-material/RadarOutlined';
import { formatDate, formatNumber } from '../../utils/formatters';
import { severityChipColor } from '../../utils/gpsSatelliteAnalysis';
import {
  SATELLITE_INDEX_INFO,
  friendlyIndexStatus,
  friendlyOverallStatus,
  friendlyReason,
  friendlyStressStatus,
  formatTechnicalIndex,
  overallActionHint,
  stressLevelColor,
} from '../../utils/satelliteDisplay';

function IndexCard({ icon, title, short, statusRaw, value, hint, technicalKey }) {
  const friendly = friendlyIndexStatus(statusRaw);
  const technical = formatTechnicalIndex(technicalKey, value);

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
        <Box sx={{ color: 'primary.main', mt: 0.25 }}>{icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
          <Typography variant="caption" color="text.secondary">{short}</Typography>
        </Box>
      </Box>
      <Chip
        label={friendly.label}
        size="small"
        color={stressLevelColor(friendly.label)}
        sx={{ mb: 1 }}
      />
      <Typography variant="body2" sx={{ mb: 0.5, lineHeight: 1.45 }}>
        {friendly.summary}
      </Typography>
      {friendly.action && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.4 }}>
          {friendly.action}
        </Typography>
      )}
      {technical && (
        <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 1 }}>
          {technical}
        </Typography>
      )}
      {hint && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75, fontStyle: 'italic' }}>
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

function StressCard({ icon, title, statusRaw, score, indicator }) {
  const friendly = friendlyStressStatus(statusRaw || indicator);

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box sx={{ color: 'primary.main' }}>{icon}</Box>
        <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
      </Box>
      <Chip
        label={friendly.label}
        size="small"
        color={stressLevelColor(friendly.label)}
        sx={{ mb: 1 }}
      />
      <Typography variant="body2" sx={{ mb: 0.5, lineHeight: 1.45 }}>
        {friendly.summary}
      </Typography>
      {friendly.action && (
        <Typography variant="caption" color="text.secondary" display="block">
          {friendly.action}
        </Typography>
      )}
      {score != null && (
        <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 1 }}>
          Stress level score: {formatNumber(score, 0)} (0 = none, higher = more stress)
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

  const overallFriendly = friendlyOverallStatus(overall.status, overall.severity);
  const actionHint = overallActionHint(overall.stress_percentage);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, gap: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SatelliteAltIcon color="primary" />
            Satellite health snapshot
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Sentinel satellite view for {formatDate(period.start)} – {formatDate(period.end)}
            {latitude != null && longitude != null && (
              <> · GPS {formatNumber(latitude, 5)}, {formatNumber(longitude, 5)}</>
            )}
          </Typography>
          {(fetchedAt || weekStart) && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {weekStart && <>Week of {formatDate(weekStart)} · </>}
              {fetchedAt && <>Updated {formatDate(fetchedAt)}</>}
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
            {refreshing ? 'Reloading…' : 'Reload'}
          </Button>
        )}
      </Box>

      <Paper sx={{ p: 2.5, mb: 2, bgcolor: 'action.hover' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>Overall tree signal</Typography>
          <Chip
            label={overallFriendly.headline}
            color={severityChipColor(overall.severity || overall.status)}
          />
          {quality.confidence && (
            <Chip
              label={`Image quality: ${quality.confidence}`}
              size="small"
              variant="outlined"
            />
          )}
        </Box>
        <Typography variant="body1" sx={{ mb: 1, lineHeight: 1.5 }}>
          {overallFriendly.summary}
        </Typography>
        {overall.stress_percentage != null && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Combined stress estimate: {formatNumber(overall.stress_percentage, 0)}%
            {overall.score != null && overall.max_score != null && (
              <> · Score {overall.score} / {overall.max_score}</>
            )}
          </Typography>
        )}
        {actionHint && (
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
            {actionHint}
          </Typography>
        )}
        {Array.isArray(overall.reasons) && overall.reasons.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {overall.reasons.map((reason) => (
              <Chip key={reason} label={friendlyReason(reason)} size="small" variant="outlined" />
            ))}
          </Box>
        )}
      </Paper>

      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>What the satellite sees</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        Plain-language readings from space. Confirm important decisions with a field visit or soil test.
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <IndexCard
            icon={<GrassOutlinedIcon fontSize="small" />}
            title={SATELLITE_INDEX_INFO.NDVI.title}
            short={SATELLITE_INDEX_INFO.NDVI.short}
            statusRaw={indexStatus.NDVI}
            value={indices.NDVI}
            hint={SATELLITE_INDEX_INFO.NDVI.hint}
            technicalKey="NDVI"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <IndexCard
            icon={<WaterDropOutlinedIcon fontSize="small" />}
            title={SATELLITE_INDEX_INFO.NDMI.title}
            short={SATELLITE_INDEX_INFO.NDMI.short}
            statusRaw={indexStatus.NDMI}
            value={indices.NDMI}
            hint={SATELLITE_INDEX_INFO.NDMI.hint}
            technicalKey="NDMI"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <IndexCard
            icon={<ScienceOutlinedIcon fontSize="small" />}
            title={SATELLITE_INDEX_INFO.NDRE.title}
            short={SATELLITE_INDEX_INFO.NDRE.short}
            statusRaw={indexStatus.NDRE}
            value={indices.NDRE}
            hint={SATELLITE_INDEX_INFO.NDRE.hint}
            technicalKey="NDRE"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <IndexCard
            icon={<RadarOutlinedIcon fontSize="small" />}
            title={SATELLITE_INDEX_INFO.S1_VV.title}
            short={SATELLITE_INDEX_INFO.S1_VV.short}
            statusRaw={radar.status}
            value={indices.S1_VV}
            hint={SATELLITE_INDEX_INFO.S1_VV.hint}
            technicalKey="S1_VV"
          />
        </Grid>
      </Grid>

      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Stress summary</Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <StressCard
            icon={<WaterDropOutlinedIcon fontSize="small" />}
            title="Water stress"
            statusRaw={water.status}
            score={water.score}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <StressCard
            icon={<ScienceOutlinedIcon fontSize="small" />}
            title="Nutrient stress"
            statusRaw={nutrient.status}
            score={nutrient.score}
            indicator={nutrient.indicator}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <StressCard
            icon={<RadarOutlinedIcon fontSize="small" />}
            title="Unusual wetness (radar)"
            statusRaw={radar.status}
            score={radar.score}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>How reliable is this?</Typography>
            <DetailRow label="Quality" value={quality.status} />
            <DetailRow label="Usable reading" value={quality.valid_observation ? 'Yes' : 'No'} />
            <DetailRow label="Optical images used" value={quality.sentinel2_images} />
            <DetailRow label="Radar images used" value={quality.sentinel1_images} />
            <DetailRow label="Confidence" value={quality.confidence_score != null ? `${quality.confidence_score}/100` : quality.confidence} />
            <DetailRow label="Area averaged" value={sampling.radius_m != null ? `${sampling.radius_m} m around tree GPS` : sampling.method} />
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Satellite images used</Typography>
            {s2 && (
              <>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Optical (Sentinel-2) · {formatDate(s2.date)}
                </Typography>
                <DetailRow label="Cloud over area" value={s2.cloud_cover != null ? `${formatNumber(s2.cloud_cover, 1)}%` : null} />
                <DetailRow label="Clear view of tree" value={s2.scl_clear_percentage != null ? `${formatNumber(s2.scl_clear_percentage, 0)}%` : null} />
              </>
            )}
            {s1 && (
              <>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                  Radar (Sentinel-1) · {formatDate(s1.date)}
                </Typography>
                <DetailRow label="Radar moisture (dB)" value={formatNumber(s1.vv_db, 2)} />
              </>
            )}
            {!s2 && !s1 && (
              <Typography variant="body2" color="text.secondary">No image details available.</Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default SatelliteAnalysisDisplay;
