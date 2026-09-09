import React from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { countCommonLowNutrients } from '../../utils/soil';

export function CommonBelowNutrientsSummary({
  observations,
  sourceText,
  linkTo,
  linkLabel,
}) {
  const nutrients = countCommonLowNutrients(observations);

  return (
    <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        Common nutrients below required
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {sourceText}
        {linkTo && linkLabel ? (
          <>
            {' '}
            <Typography
              component={RouterLink}
              to={linkTo}
              variant="body2"
              sx={{ color: 'primary.main', fontWeight: 600, textDecoration: 'none' }}
            >
              {linkLabel}
            </Typography>
          </>
        ) : null}
      </Typography>
      {nutrients.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {(observations || []).length === 0
            ? 'No 7-in-1 readings yet.'
            : 'No nutrients are below required on the latest 7-in-1 readings.'}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {nutrients.map((nutrient) => (
            <Chip
              key={nutrient.key}
              color="warning"
              label={`${nutrient.label} · ${nutrient.treeCount} tree${nutrient.treeCount === 1 ? '' : 's'}`}
            />
          ))}
        </Box>
      )}
    </Paper>
  );
}
