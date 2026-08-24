import React from 'react';
import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

const VISUAL_HEIGHT = 96;

function VisualFrame({ children, paletteKey = 'primary', statusColor }) {
  const theme = useTheme();
  const colorMap = {
    error: theme.palette.error,
    warning: theme.palette.warning,
    success: theme.palette.success,
    info: theme.palette.info,
    default: theme.palette.primary,
    primary: theme.palette.primary,
  };
  const palette = colorMap[statusColor] || colorMap[paletteKey] || theme.palette.primary;

  return (
    <Box
      sx={{
        height: VISUAL_HEIGHT,
        borderRadius: 1.5,
        mb: 1.5,
        overflow: 'hidden',
        position: 'relative',
        bgcolor: alpha(palette.main, 0.12),
        border: `1px solid ${alpha(palette.main, 0.28)}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at 20% 20%, ${alpha(palette.light || palette.main, 0.35)}, transparent 55%),
            radial-gradient(circle at 80% 80%, ${alpha(palette.main, 0.2)}, transparent 50%)`,
        }}
      />
      <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>{children}</Box>
    </Box>
  );
}

function CanopySvg() {
  return (
    <svg viewBox="0 0 160 96" width="100%" height="100%" aria-hidden>
      <ellipse cx="80" cy="78" rx="58" ry="10" fill="#2e4a22" opacity="0.35" />
      <rect x="76" y="52" width="8" height="26" rx="2" fill="#5d4037" />
      <circle cx="80" cy="42" r="26" fill="#66bb6a" />
      <circle cx="62" cy="48" r="18" fill="#81c784" />
      <circle cx="98" cy="48" r="18" fill="#4caf50" />
      <circle cx="44" cy="58" r="12" fill="#388e3c" opacity="0.8" />
      <circle cx="116" cy="58" r="12" fill="#388e3c" opacity="0.8" />
      <path d="M20 18h18v8H20zM122 14h20v6h-20z" fill="#78909c" opacity="0.7" />
      <circle cx="128" cy="12" r="5" fill="#90a4ae" />
      <path d="M30 28c8-6 16-6 24 0" stroke="#a5d6a7" strokeWidth="2" fill="none" opacity="0.6" />
    </svg>
  );
}

function MoistureSvg() {
  return (
    <svg viewBox="0 0 160 96" width="100%" height="100%" aria-hidden>
      <rect x="0" y="62" width="160" height="34" fill="#4e342e" />
      <rect x="0" y="72" width="160" height="24" fill="#5d4037" />
      <path d="M40 72c0-14 12-24 20-36 8 12 20 22 20 36z" fill="#42a5f5" opacity="0.85" />
      <path d="M88 68c0-10 8-18 14-26 6 8 14 16 14 26z" fill="#29b6f6" opacity="0.75" />
      <ellipse cx="80" cy="48" rx="22" ry="10" fill="#81c784" />
      <path d="M68 48 Q80 28 92 48" fill="#66bb6a" />
      <circle cx="52" cy="66" r="3" fill="#81d4fa" opacity="0.8" />
      <circle cx="110" cy="64" r="2.5" fill="#81d4fa" opacity="0.7" />
    </svg>
  );
}

function NutrientSvg() {
  return (
    <svg viewBox="0 0 160 96" width="100%" height="100%" aria-hidden>
      <path d="M80 78 L80 52" stroke="#558b2f" strokeWidth="4" />
      <ellipse cx="80" cy="44" rx="28" ry="16" fill="#9ccc65" />
      <ellipse cx="58" cy="50" rx="14" ry="9" fill="#aed581" />
      <ellipse cx="102" cy="50" rx="14" ry="9" fill="#7cb342" />
      <circle cx="48" cy="28" r="12" fill="#ffa726" opacity="0.9" />
      <text x="48" y="32" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700">N</text>
      <circle cx="112" cy="24" r="10" fill="#ef5350" opacity="0.85" />
      <text x="112" y="28" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700">K</text>
      <circle cx="80" cy="18" r="9" fill="#42a5f5" opacity="0.85" />
      <text x="80" y="22" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700">P</text>
    </svg>
  );
}

function RadarSvg() {
  return (
    <svg viewBox="0 0 160 96" width="100%" height="100%" aria-hidden>
      <rect x="0" y="68" width="160" height="28" fill="#37474f" />
      <path d="M80 68 Q110 50 130 68" fill="#546e7a" opacity="0.5" />
      <path d="M80 20 L95 68 L65 68 Z" fill="#78909c" opacity="0.35" />
      <path d="M80 28 A42 42 0 0 1 110 58" stroke="#29b6f6" strokeWidth="2" fill="none" opacity="0.8" />
      <path d="M80 36 A32 32 0 0 1 102 58" stroke="#4fc3f7" strokeWidth="2" fill="none" opacity="0.6" />
      <circle cx="80" cy="68" r="4" fill="#90a4ae" />
      <rect x="118" y="14" width="28" height="14" rx="3" fill="#607d8b" />
      <circle cx="132" cy="12" r="4" fill="#b0bec5" />
    </svg>
  );
}

function WaterStressSvg() {
  return (
    <svg viewBox="0 0 160 96" width="100%" height="100%" aria-hidden>
      <path d="M52 72 L52 48 Q52 32 64 28 Q76 32 76 48 L76 72 Z" fill="#ef5350" opacity="0.25" />
      <path d="M84 72 L84 44 Q84 24 96 18 Q108 24 108 44 L108 72 Z" fill="#42a5f5" opacity="0.35" />
      <path d="M60 40c0-8 6-14 12-18 6 4 12 10 12 18" fill="none" stroke="#ef5350" strokeWidth="2" />
      <path d="M96 36c0-6 5-10 10-13 5 3 10 7 10 13" fill="#29b6f6" opacity="0.8" />
      <rect x="24" y="58" width="112" height="8" rx="4" fill="#455a64" />
      <rect x="24" y="58" width="36" height="8" rx="4" fill="#ef5350" />
      <text x="80" y="54" textAnchor="middle" fill="#eceff1" fontSize="9">Water level</text>
    </svg>
  );
}

function NutrientStressSvg() {
  return (
    <svg viewBox="0 0 160 96" width="100%" height="100%" aria-hidden>
      <path d="M80 76 L80 54" stroke="#6d4c41" strokeWidth="3" />
      <ellipse cx="80" cy="46" rx="20" ry="12" fill="#ffb74d" opacity="0.7" />
      <ellipse cx="66" cy="52" rx="10" ry="7" fill="#ffcc80" opacity="0.6" />
      <ellipse cx="94" cy="52" rx="10" ry="7" fill="#ffa726" opacity="0.5" />
      <rect x="28" y="62" width="104" height="10" rx="5" fill="#37474f" />
      <rect x="28" y="62" width="48" height="10" rx="5" fill="#ffa726" />
      <text x="52" y="24" fill="#fff" fontSize="11" fontWeight="700" opacity="0.9">N</text>
      <text x="80" y="20" fill="#fff" fontSize="10" fontWeight="700" opacity="0.7">P</text>
      <text x="108" y="24" fill="#fff" fontSize="11" fontWeight="700" opacity="0.5">K</text>
    </svg>
  );
}

function RadarWetnessSvg() {
  return (
    <svg viewBox="0 0 160 96" width="100%" height="100%" aria-hidden>
      <ellipse cx="80" cy="78" rx="60" ry="12" fill="#263238" />
      <path d="M30 78 Q50 62 70 78 T110 78 T150 78" fill="#37474f" />
      <path d="M50 78 Q65 68 80 78 T110 78" fill="#0288d1" opacity="0.45" />
      <path d="M80 22 L80 68" stroke="#78909c" strokeWidth="2" strokeDasharray="4 3" />
      <path d="M80 30 A38 38 0 0 1 108 62" stroke="#4fc3f7" strokeWidth="2.5" fill="none" />
      <path d="M80 38 A28 28 0 0 1 100 62" stroke="#81d4fa" strokeWidth="1.5" fill="none" opacity="0.7" />
      <circle cx="92" cy="72" r="5" fill="#4fc3f7" opacity="0.8" />
    </svg>
  );
}

function OverallTreeSvg() {
  return (
    <svg viewBox="0 0 160 96" width="100%" height="100%" aria-hidden>
      <circle cx="80" cy="48" r="34" fill="none" stroke="currentColor" strokeWidth="6" opacity="0.2" />
      <circle cx="80" cy="48" r="34" fill="none" stroke="currentColor" strokeWidth="6" strokeDasharray="160 54" opacity="0.85" transform="rotate(-90 80 48)" />
      <circle cx="80" cy="48" r="18" fill="currentColor" opacity="0.15" />
      <rect x="77" y="52" width="6" height="16" rx="1" fill="#6d4c41" />
      <circle cx="80" cy="44" r="14" fill="#66bb6a" />
      <circle cx="70" cy="48" r="9" fill="#81c784" />
      <circle cx="90" cy="48" r="9" fill="#4caf50" />
      <rect x="18" y="16" width="22" height="10" rx="2" fill="#78909c" opacity="0.6" />
      <circle cx="28" cy="14" r="4" fill="#b0bec5" />
    </svg>
  );
}

const ART_MAP = {
  overall: OverallTreeSvg,
  NDVI: CanopySvg,
  NDMI: MoistureSvg,
  NDRE: NutrientSvg,
  S1_VV: RadarSvg,
  water_stress: WaterStressSvg,
  nutrient_stress: NutrientStressSvg,
  radar_stress: RadarWetnessSvg,
};

export function SatelliteIndicatorVisual({ indicatorId, statusColor = 'primary', sx }) {
  const Art = ART_MAP[indicatorId];
  if (!Art) return null;

  return (
    <Box sx={sx}>
      <VisualFrame statusColor={statusColor}>
        <Art />
      </VisualFrame>
    </Box>
  );
}

export function SatelliteOverallVisual({ statusColor = 'primary', sx }) {
  const theme = useTheme();
  const colorMap = {
    error: theme.palette.error.main,
    warning: theme.palette.warning.main,
    success: theme.palette.success.main,
    primary: theme.palette.primary.main,
    default: theme.palette.text.secondary,
  };
  const tint = colorMap[statusColor] || colorMap.primary;

  return (
    <Box
      sx={{
        width: { xs: '100%', sm: 140 },
        minWidth: { sm: 140 },
        flexShrink: 0,
        color: tint,
        ...sx,
      }}
    >
      <VisualFrame statusColor={statusColor} paletteKey="primary">
        <OverallTreeSvg />
      </VisualFrame>
    </Box>
  );
}

export default SatelliteIndicatorVisual;
