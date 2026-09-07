import React from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

const COLOR_KEYS = {
  blue: 'info',
  green: 'success',
  red: 'error',
  yellow: 'warning',
  orange: 'warning',
  cyan: 'info',
  gray: 'primary',
};

function SensorCard({
  label,
  value,
  unit,
  subLabel,
  subValue,
  subUnit,
  icon: Icon,
  color = 'blue',
  status = 'normal',
}) {
  const theme = useTheme();
  const paletteKey = COLOR_KEYS[color] || 'info';
  const tone = theme.palette[paletteKey] || theme.palette.info;
  const borderColor = status === 'critical'
    ? alpha(theme.palette.error.main, 0.55)
    : status === 'warning'
      ? alpha(theme.palette.warning.main, 0.55)
      : theme.palette.divider;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        borderColor,
        bgcolor: alpha(tone.main, 0.08),
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(tone.main, 0.18),
            color: tone.main,
          }}
        >
          {Icon ? <Icon /> : null}
        </Box>
        {status !== 'normal' && (
          <Chip
            size="small"
            label={status.toUpperCase()}
            color={status === 'critical' ? 'error' : 'warning'}
          />
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mt: 0.25 }}>
        <Typography variant="h5" fontWeight={800}>
          {value}
        </Typography>
        {unit ? (
          <Typography variant="caption" color="text.secondary">{unit}</Typography>
        ) : null}
      </Box>
      {subValue !== undefined && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">{subLabel}</Typography>
          <Typography variant="body2" fontWeight={700}>
            {subValue}
            {subUnit || unit ? (
              <Typography component="span" variant="caption" color="text.secondary">
                {' '}{subUnit || unit}
              </Typography>
            ) : null}
          </Typography>
        </Box>
      )}
    </Paper>
  );
}

export default SensorCard;
