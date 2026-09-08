import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Grid,
  Paper,
  Switch,
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
  friendlyRadarWetnessStatus,
  radarWetnessChipColor,
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
  getCloudCoverPercent,
  getRadarDisplayModel,
  isRadarOnlyMode,
  monsoonDisclaimer,
  readHideOpticalWhenCloudy,
  shouldShowMonsoonDisclaimer,
  writeHideOpticalWhenCloudy,
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

function IndexCard({
  indicatorId,
  short,
  statusRaw,
  value,
  hint,
  technicalKey,
  useStressLabels = false,
  emphasizeValue = false,
}) {
  const radarWetness = indicatorId === 'S1_VV';
  const friendly = radarWetness
    ? friendlyRadarWetnessStatus(statusRaw)
    : useStressLabels
      ? friendlyStressStatus(statusRaw)
      : friendlyIndexStatus(statusRaw);
  const technical = formatTechnicalIndex(technicalKey, value);
  const chipColor = radarWetness
    ? radarWetnessChipColor(friendly.label)
    : stressLevelColor(friendly.label);

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
        <Typography
          variant={emphasizeValue ? 'h6' : 'body2'}
          fontWeight={700}
          display="block"
          sx={{ mt: 1.25 }}
        >
          {technical}
        </Typography>
      )}
      {hint && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

function StressCard({ indicatorId, statusRaw, score, indicator, extra }) {
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
      {extra && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {extra}
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
  lastGoodRadar = null,
  lastGoodRadarWeek = null,
  latitude,
  longitude,
  fetchedAt,
  weekStart,
  onRefresh,
  refreshing = false,
  cacheNote,
}) {
  const theme = useTheme();
  const [hideOpticalWhenCloudy, setHideOpticalWhenCloudy] = useState(readHideOpticalWhenCloudy);

  if (!analysis) return null;

  const radarModel = getRadarDisplayModel(analysis, lastGoodRadar, lastGoodRadarWeek);
  const overall = analysis.overall_condition || {};
  const indices = analysis.indices || {};
  const indexStatus = analysis.index_status || {};
  const water = analysis.water_stress || {};
  const nutrient = analysis.nutrient_stress || {};
  const radarIndices = radarModel.indices;
  const quality = analysis.data_quality || {};
  const period = analysis.period || {};
  const s2 = analysis.selected_images?.sentinel2;
  const s1 = radarModel.s1 || analysis.selected_images?.sentinel1;
  const sampling = analysis.sampling || {};

  const overallFriendly = friendlyOverallStatus(overall.status, overall.severity);
  const actionHint = overallActionHint(overall.stress_percentage);
  const severityLabel = overall.severity || overall.status;
  const showSeverityChip = overall.severity
    && String(overall.severity).toLowerCase() !== String(overallFriendly.headline).toLowerCase();
  const overallVisualColor = severityToChipColor(severityLabel);
  const radarOnly = isRadarOnlyMode(analysis);
  const hideOptical = radarOnly && hideOpticalWhenCloudy;
  const showMonsoonNote = shouldShowMonsoonDisclaimer(analysis, weekStart);
  const radarAsOf = radarModel.asOf;
  const wetnessStatus = radarModel.wetnessStatus || radarModel.statusRaw;
  const anomalyStatus = radarModel.anomalyStatus || radarModel.statusRaw;
  const cloudPct = getCloudCoverPercent(analysis);
  const radarDbHint = [
    radarModel.vvDb != null ? `${formatNumber(radarModel.vvDb, 2)} dB` : null,
    radarAsOf ? `pass of ${formatDate(radarAsOf)}` : null,
  ].filter(Boolean).join(' · ');

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
              {weekStart && <>Week of {formatDate(weekStart)}</>}
              {fetchedAt && <>{weekStart ? ' · ' : ''}Updated {formatDate(fetchedAt)}</>}
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
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              alignItems: { sm: 'center' },
              justifyContent: 'space-between',
              gap: 1.5,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                {cloudPct != null
                  ? `High cloud (${formatNumber(cloudPct, 0)}%)`
                  : 'High cloud this week'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {monsoonDisclaimer('radar-only')}
                {radarModel.fromPriorWeek && radarAsOf
                  ? ` Last radar pass ${formatDate(radarAsOf)} — none this week.`
                  : radarModel.fromPriorWeek
                    ? ' Last stored radar is shown — none this week.'
                    : ''}
              </Typography>
            </Box>
            <FormControlLabel
              sx={{ ml: 0, flexShrink: 0 }}
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
              label="Show optical"
            />
          </Box>
        </Paper>
      )}
      {showMonsoonNote && (
        <Alert severity="info" sx={{ mb: 2, '& .MuiAlert-message': { whiteSpace: 'normal' } }}>
          {monsoonDisclaimer('season')}
        </Alert>
      )}

      {!hideOptical && (
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

      {hideOptical && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1, mb: 1.5 }}>
          <Typography variant="subtitle2">
            {radarModel.fromPriorWeek ? 'Ground wetness from last radar pass' : 'Ground wetness (radar)'}
          </Typography>
          {radarModel.fromPriorWeek && (
            <Chip label={radarAsOf ? `Pass of ${formatDate(radarAsOf)}` : 'Earlier pass'} size="small" />
          )}
        </Box>
      )}
      {!hideOptical && (
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          What the satellite sees
        </Typography>
      )}
      {hideOptical ? (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
            <IndexCard
              indicatorId="S1_VV"
              short={SATELLITE_INDEX_INFO.S1_VV.short}
              statusRaw={wetnessStatus}
              value={radarModel.vvLinear}
              hint={radarModel.hasValues ? radarDbHint : SATELLITE_INDEX_INFO.S1_VV.hint}
              technicalKey="S1_VV"
              emphasizeValue
            />
          </Grid>
          <Grid item xs={12} md={6} sx={{ display: 'flex' }}>
            <StressCard
              indicatorId="radar_stress"
              statusRaw={anomalyStatus}
              score={radarModel.score}
            />
          </Grid>
        </Grid>
      ) : (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
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
            <Grid item xs={12} sm={6} md={3}>
              <IndexCard
                indicatorId="S1_VV"
                short={SATELLITE_INDEX_INFO.S1_VV.short}
                statusRaw={wetnessStatus}
                value={radarModel.vvLinear ?? radarIndices.S1_VV ?? indices.S1_VV}
                hint={radarModel.hasValues
                  ? radarDbHint || SATELLITE_INDEX_INFO.S1_VV.hint
                  : SATELLITE_INDEX_INFO.S1_VV.hint}
                technicalKey="S1_VV"
              />
            </Grid>
          </Grid>

          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Stress summary</Typography>
          <Grid container spacing={2} sx={{ mb: 3 }}>
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
            <Grid item xs={12} md={4}>
              <StressCard
                indicatorId="radar_stress"
                statusRaw={anomalyStatus}
                score={radarModel.score}
              />
            </Grid>
          </Grid>
        </>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>How reliable is this?</Typography>
            <DetailRow label="Reading quality" value={quality.status} />
            <DetailRow label="Usable this week" value={quality.valid_observation ? 'Yes' : 'No'} />
            <DetailRow label="Optical images this week" value={quality.sentinel2_images} />
            <DetailRow label="Radar images this week" value={quality.sentinel1_images} />
            <DetailRow
              label="Confidence"
              value={quality.confidence_score != null ? `${quality.confidence_score}/100` : quality.confidence}
            />
            {cacheNote && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
                {cacheNote}
              </Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Satellite images used</Typography>
            <DetailRow label="Area averaged" value={sampling.radius_m != null ? `${sampling.radius_m} m around tree GPS` : sampling.method} />
            {s2 && (
              <>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Optical (Sentinel-2) · {formatDate(s2.date)}
                  {hideOptical && ' · skipped (high cloud)'}
                </Typography>
                <DetailRow label="Cloud over area" value={s2.cloud_cover != null ? `${formatNumber(s2.cloud_cover, 1)}%` : null} />
                {!hideOptical && (
                  <DetailRow label="Clear view of tree" value={s2.scl_clear_percentage != null ? `${formatNumber(s2.scl_clear_percentage, 0)}%` : null} />
                )}
              </>
            )}
            {s1 && (
              <>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                  Radar (Sentinel-1) · {formatDate(s1.date)}
                  {radarModel.fromPriorWeek ? ' · last stored pass' : ''}
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
