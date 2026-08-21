import React from 'react';
import { Box, Typography } from '@mui/material';
import { getHealthDisplay } from '../../utils/healthStatus';

function HealthIndicator({ tree, showLabel = false }) {
  const health = getHealthDisplay(tree);

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <Typography component="span" aria-label={health.label}>
        {health.emoji}
      </Typography>
      {showLabel && (
        <Typography variant="body2" sx={{ color: health.color }}>
          {health.label}
        </Typography>
      )}
    </Box>
  );
}

export default HealthIndicator;
