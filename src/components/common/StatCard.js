import React from 'react';
import { Paper, Typography, Box } from '@mui/material';

function StatCard({ title, value, subtitle, color, icon }) {
  return (
    <Paper sx={{ p: 2.5, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            {title}
          </Typography>
          <Typography variant="h4" sx={{ color: color || 'text.primary', fontWeight: 700, my: 0.5 }}>
            {value}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        {icon && (
          <Box sx={{ color: color || 'primary.main', opacity: 0.9, mt: 0.5 }}>
            {icon}
          </Box>
        )}
      </Box>
    </Paper>
  );
}

export default StatCard;
