import React from 'react';
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
import { alpha, useTheme } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import { formatDate, formatNumber } from '../../utils/formatters';
import {
  SATELLITE_INDEX_INFO,
  actionHintColor,
  confidenceChipColor,
  friendlyIndexStatus,
  friendlyOverallStatus,
  friendlyReason,
  friendlyStressStatus,
  formatTechnicalIndex,
  overallActionHint,
  overallStressLevel,
  reasonChipColor,
  severityToChipColor,
  stressLevelColor,
  stressPercentTextColor,
} from '../../utils/satelliteDisplay';
import SatelliteIndicatorVisual, { SatelliteOverallVisual } from './SatelliteIndicatorArt';
import {
  isRadarOnlyMode,
  monsoonDisclaimer,
  shouldShowMonsoonDisclaimer,
} from '../../utils/satelliteMonsoon';

function overallPanelSx(theme, severity, stressPercentage) {
  const level = overallStressLevel(severity, stressPercentage);
  const paletteColor = level === 'critical' || level === 'high'
    ? theme.palette.error
    : level === 'moderate'
      ? theme.palette.warning
      : theme.palette.success;

  return {
    bgcolor: alpha(paletteColor.main, 0.14),
    border: 1,
    borderColor: alpha(paletteColor.main, 0.45),
  };
}

function IndexCard({ indicatorId, short, statusRaw, value, hint, technicalKey, useStressLabels = false }) {
  const friendly = useStressLabels
    ? friendlyStressStatus(statusRaw)
    : friendlyIndexStatus(statusRaw);
  const technical = formatTechnicalIndex(technicalKey, value);
  const chipColor = stressLevelColor(friendly.label);

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%', overflow: 'hidden' }}>
      <SatelliteIndicatorVisual
        indicatorId={indicatorId}
        statusColor={chipColor}
        statusLabel={friendly.label}
      />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        {short}
      </Typography>
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

function StressCard({ indicatorId, statusRaw, score, indicator }) {
  const friendly = friendlyStressStatus(statusRaw || indicator);
  const chipColor = stressLevelColor(friendly.label);

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%', overflow: 'hidden' }}>
      <SatelliteIndicatorVisual
        indicatorId={indicatorId}
        statusColor={chipColor}
        statusLabel={friendly.label}
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
  const theme = useTheme();

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
  const severityLabel = overall.severity || overall.status;
  const showSeverityChip = overall.severity
    && String(overall.severity).toLowerCase() !== String(overallFriendly.headline).toLowerCase();
  const overallVisualColor = severityToChipColor(severityLabel);
  const radarOnly = isRadarOnlyMode(analysis);
  const showMonsoonNote = shouldShowMonsoonDisclaimer(analysis, weekStart);

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

      {radarOnly && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {monsoonDisclaimer('radar-only')}
        </Alert>
      )}
      {showMonsoonNote && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {monsoonDisclaimer('season')}
        </Alert>
      )}

      {!radarOnly && (
      <Paper sx={{ p: 2.5, mb: 2, ...overallPanelSx(theme, severityLabel, overall.stress_percentage) }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, mb: 1.5 }}>
          <SatelliteOverallVisual
            statusColor={overallVisualColor}
            statusLabel={overallFriendly.headline}
            stressPercentage={overall.stress_percentage}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={700}>Overall tree signal</Typography>
              <Chip
                label={overallFriendly.headline}
                color={severityToChipColor(overallFriendly.headline)}
              />
              {showSeverityChip && (
                <Chip
                  label={overall.severity}
                  color={severityToChipColor(overall.severity)}
                />
              )}
              {quality.confidence && (
                <Chip
                  label={`Image quality: ${quality.confidence}`}
                  size="small"
                  color={confidenceChipColor(quality.confidence)}
                />
              )}
            </Box>
            <Typography variant="body1" sx={{ mb: 1, lineHeight: 1.5 }}>
              {overallFriendly.summary}
            </Typography>
            {overall.stress_percentage != null && (
              <Typography
                variant="body2"
                sx={{ mb: 1, fontWeight: 600, color: stressPercentTextColor(overall.stress_percentage) }}
              >
                Combined stress estimate: {formatNumber(overall.stress_percentage, 0)}%
                {overall.score != null && overall.max_score != null && (
                  <> · Score {overall.score} / {overall.max_score}</>
                )}
              </Typography>
            )}
            {actionHint && (
              <Typography
                variant="body2"
                sx={{ mb: 1, fontWeight: 600, color: actionHintColor(overall.stress_percentage) }}
              >
                {actionHint}
              </Typography>
            )}
            {Array.isArray(overall.reasons) && overall.reasons.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {overall.reasons.map((reason) => (
                  <Chip
                    key={reason}
                    label={friendlyReason(reason)}
                    size="small"
                    color={reasonChipColor(reason)}
                  />
                ))}
              </Box>
            )}
          </Box>
        </Box>
      </Paper>
      )}

      {radarOnly && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Radar-only week — overall score not shown because optical data was skipped due to high cloud cover.
          </Typography>
        </Paper>
      )}

      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {radarOnly ? 'Radar readings (Sentinel-1)' : 'What the satellite sees'}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        {radarOnly
          ? 'Ground wetness from radar that works through cloud. Confirm important decisions with a field visit or soil test.'
          : 'Plain-language readings from space. Confirm important decisions with a field visit or soil test.'}
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {!radarOnly && (
          <>
            <Grid item xs={12} sm={6} md={3}>
              <IndexCard
                indicatorId="NDVI"
                short={SATELLITE_INDEX_INFO.NDVI.short}
                statusRaw={indexStatus.NDVI}
                value={indices.NDVI}
                hint={SATELLITE_INDEX_INFO.NDVI.hint}
                technicalKey="NDVI"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <IndexCard
                indicatorId="NDMI"
                short={SATELLITE_INDEX_INFO.NDMI.short}
                statusRaw={indexStatus.NDMI}
                value={indices.NDMI}
                hint={SATELLITE_INDEX_INFO.NDMI.hint}
                technicalKey="NDMI"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <IndexCard
                indicatorId="NDRE"
                short={SATELLITE_INDEX_INFO.NDRE.short}
                statusRaw={indexStatus.NDRE}
                value={indices.NDRE}
                hint={SATELLITE_INDEX_INFO.NDRE.hint}
                technicalKey="NDRE"
              />
            </Grid>
          </>
        )}
        <Grid item xs={12} sm={6} md={radarOnly ? 6 : 3}>
          <IndexCard
            indicatorId="S1_VV"
            short={SATELLITE_INDEX_INFO.S1_VV.short}
            statusRaw={radar.status || indexStatus.S1_VV}
            value={indices.S1_VV}
            hint={SATELLITE_INDEX_INFO.S1_VV.hint}
            technicalKey="S1_VV"
            useStressLabels
          />
        </Grid>
      </Grid>

      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Stress summary</Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {!radarOnly && (
          <>
            <Grid item xs={12} md={4}>
              <StressCard
                indicatorId="water_stress"
                statusRaw={water.status}
                score={water.score}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <StressCard
                indicatorId="nutrient_stress"
                statusRaw={nutrient.status}
                score={nutrient.score}
                indicator={nutrient.indicator}
              />
            </Grid>
          </>
        )}
        <Grid item xs={12} md={radarOnly ? 12 : 4}>
          <StressCard
            indicatorId="radar_stress"
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
                  {radarOnly && ' · skipped (high cloud)'}
                </Typography>
                <DetailRow label="Cloud over area" value={s2.cloud_cover != null ? `${formatNumber(s2.cloud_cover, 1)}%` : null} />
                {!radarOnly && (
                  <DetailRow label="Clear view of tree" value={s2.scl_clear_percentage != null ? `${formatNumber(s2.scl_clear_percentage, 0)}%` : null} />
                )}
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
