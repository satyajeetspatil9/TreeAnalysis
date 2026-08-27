import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { formatNumber } from '../../utils/formatters';
import {
  evaluateSoilStandard,
  getSoilStandard,
  soilStatusColor,
  soilValueColor,
  SOIL_STANDARDS_REFERENCE,
} from '../../utils/soil';

export function SoilNutrientDisplay({
  standardKey,
  label,
  value,
  decimals = 2,
  unit,
  showRange = true,
  showLabel = true,
  statusFirst = false,
  variant = 'body2',
}) {
  const standard = getSoilStandard(standardKey);
  const displayLabel = showLabel ? (label || standard?.label || standardKey) : null;
  const displayUnit = unit ?? standard?.unit;
  const evaluation = evaluateSoilStandard(standard, value);

  const statusChip = evaluation.label ? (
    <Chip
      label={evaluation.label}
      size="small"
      sx={{
        height: 28,
        bgcolor: 'transparent',
        border: 1,
        borderColor: soilStatusColor(evaluation.status),
        color: soilStatusColor(evaluation.status),
        '& .MuiChip-label': {
          fontSize: '0.875rem',
          fontWeight: 600,
          px: 1,
          py: 0.25,
        },
      }}
    />
  ) : null;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {statusFirst && statusChip}
        <Typography
          variant={variant}
          component="span"
          sx={{ color: soilValueColor(standardKey, value), fontWeight: 600 }}
        >
          {displayLabel ? `${displayLabel}: ` : ''}
          {value != null && value !== ''
            ? `${formatNumber(value, decimals)}${displayUnit ? ` ${displayUnit}` : ''}`
            : '—'}
        </Typography>
        {!statusFirst && statusChip}
      </Box>
      {showRange && standard?.rangeLabel && (
        <Typography variant="caption" color="text.secondary" display="block">
          Target: {standard.rangeLabel}
        </Typography>
      )}
    </Box>
  );
}

export function SoilStandardsReference({ compact = false }) {
  if (compact) {
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {SOIL_STANDARDS_REFERENCE.map((standard) => (
          <Chip
            key={standard.label}
            size="small"
            variant="outlined"
            label={`${standard.label}: ${standard.rangeLabel}`}
            sx={{
              height: 'auto',
              maxWidth: '100%',
              '& .MuiChip-label': {
                display: 'block',
                whiteSpace: 'normal',
                lineHeight: 1.35,
                py: 0.35,
                fontSize: '0.72rem',
              },
            }}
          />
        ))}
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Required nutrient ranges
      </Typography>
      {SOIL_STANDARDS_REFERENCE.map((standard) => (
        <Typography key={standard.label} variant="body2" sx={{ py: 0.25 }}>
          <strong>{standard.label}</strong>: {standard.rangeLabel}
        </Typography>
      ))}
    </Box>
  );
}

export default SoilNutrientDisplay;
