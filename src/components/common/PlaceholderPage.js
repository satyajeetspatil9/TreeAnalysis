import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

function PlaceholderPage({ title, description, children }) {
  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        {title}
      </Typography>
      {description && (
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          {description}
        </Typography>
      )}
      {children || (
        <Paper sx={{ p: 4, textAlign: 'center' }} variant="outlined">
          <Typography color="text.secondary">
            This module will connect to the backend tables once migrations are applied in Supabase.
          </Typography>
        </Paper>
      )}
    </Box>
  );
}

export default PlaceholderPage;
