import React from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ParkIcon from '@mui/icons-material/Park';
import GrassIcon from '@mui/icons-material/Grass';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import ScienceIcon from '@mui/icons-material/Science';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import OpacityIcon from '@mui/icons-material/Opacity';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import WavesIcon from '@mui/icons-material/Waves';
import { SATELLITE_INDEX_INFO } from '../../utils/satelliteDisplay';

const VISUAL_CONFIG = {
  overall: {
    Icon: ParkIcon,
    label: 'Whole tree seen from space',
  },
  NDVI: {
    Icon: GrassIcon,
    label: SATELLITE_INDEX_INFO.NDVI.title,
    caption: 'Healthy green leaves?',
  },
  NDMI: {
    Icon: WaterDropIcon,
    label: SATELLITE_INDEX_INFO.NDMI.title,
    caption: 'Enough water in soil?',
  },
  NDRE: {
    Icon: ScienceIcon,
    label: SATELLITE_INDEX_INFO.NDRE.title,
    caption: 'Leaves getting enough food?',
  },
  S1_VV: {
    Icon: SatelliteAltIcon,
    label: 'Ground wetness (radar)',
    caption: 'Wet or dry under the tree?',
  },
  water_stress: {
    Icon: OpacityIcon,
    label: 'Water stress',
    caption: 'Is the tree thirsty?',
  },
  nutrient_stress: {
    Icon: AgricultureIcon,
    label: 'Nutrient stress',
    caption: 'Does it need fertilizer?',
  },
  radar_stress: {
    Icon: WavesIcon,
    label: 'Unusual wetness',
    caption: 'Any odd wet spots nearby?',
  },
};

function useStatusPalette(statusColor) {
  const theme = useTheme();
  const map = {
    error: theme.palette.error,
    warning: theme.palette.warning,
    success: theme.palette.success,
    info: theme.palette.info,
    primary: theme.palette.primary,
    default: {
      main: theme.palette.text.secondary,
      light: theme.palette.text.primary,
    },
  };
  return map[statusColor] || map.primary;
}

function IndicatorBanner({
  indicatorId,
  statusColor = 'primary',
  statusLabel,
  compact = false,
}) {
  const palette = useStatusPalette(statusColor);
  const config = VISUAL_CONFIG[indicatorId];
  if (!config) return null;

  const { Icon, label, caption } = config;

  return (
    <Box
      sx={{
        borderRadius: 1.5,
        mb: 1.5,
        px: 1.5,
        py: compact ? 1.25 : 1.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        bgcolor: alpha(palette.main, 0.14),
        border: `1px solid ${alpha(palette.main, 0.38)}`,
      }}
    >
      <Box
        sx={{
          width: compact ? 44 : 52,
          height: compact ? 44 : 52,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: alpha(palette.main, 0.22),
          color: palette.main,
        }}
      >
        <Icon sx={{ fontSize: compact ? 26 : 30 }} />
      </Box>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.25 }}>
          {label}
        </Typography>
        {caption && !compact && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
            {caption}
          </Typography>
        )}
        {statusLabel && (
          <Chip
            label={statusLabel}
            size="small"
            color={statusColor === 'default' ? 'default' : statusColor}
            sx={{ mt: 0.75, height: 22, fontWeight: 600 }}
          />
        )}
      </Box>
    </Box>
  );
}

export function SatelliteIndicatorVisual({
  indicatorId,
  statusColor = 'primary',
  statusLabel,
  sx,
}) {
  return (
    <Box sx={sx}>
      <IndicatorBanner
        indicatorId={indicatorId}
        statusColor={statusColor}
        statusLabel={statusLabel}
      />
    </Box>
  );
}

export function SatelliteOverallVisual({
  statusColor = 'primary',
  statusLabel,
  stressPercentage,
  sx,
}) {
  const palette = useStatusPalette(statusColor);

  return (
    <Box
      sx={{
        width: { xs: '100%', sm: 200 },
        minWidth: { sm: 200 },
        flexShrink: 0,
        ...sx,
      }}
    >
      <Box
        sx={{
          borderRadius: 1.5,
          p: 1.75,
          bgcolor: alpha(palette.main, 0.14),
          border: `1px solid ${alpha(palette.main, 0.38)}`,
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            mx: 'auto',
            mb: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(palette.main, 0.22),
            color: palette.main,
            position: 'relative',
          }}
        >
          <ParkIcon sx={{ fontSize: 32 }} />
          {stressPercentage != null && (
            <Box
              sx={{
                position: 'absolute',
                inset: -4,
                borderRadius: '50%',
                border: `3px solid ${alpha(palette.main, 0.25)}`,
                borderTopColor: palette.main,
                transform: 'rotate(-90deg)',
              }}
            />
          )}
        </Box>
        <Typography variant="subtitle2" fontWeight={700}>
          Overall tree signal
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
          From satellite this week
        </Typography>
        {statusLabel && (
          <Chip
            label={statusLabel}
            size="small"
            color={statusColor === 'default' ? 'default' : statusColor}
            sx={{ mt: 1, fontWeight: 600 }}
          />
        )}
        {stressPercentage != null && (
          <Typography
            variant="caption"
            display="block"
            sx={{ mt: 0.75, color: palette.main, fontWeight: 700 }}
          >
            Stress estimate {Math.round(Number(stressPercentage))}%
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export default SatelliteIndicatorVisual;
