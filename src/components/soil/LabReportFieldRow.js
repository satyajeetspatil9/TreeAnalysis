import React from 'react';
import { Box, Typography, TextField } from '@mui/material';
import { LAB_NUTRIENT_FIELDS, fieldLabelWithUnit } from '../../utils/soil';

const labMetaFieldSx = {
  minWidth: 150,
  flex: '0 0 auto',
  '& .MuiInputBase-root': { fontSize: '0.875rem' },
};

const labNutrientFieldSx = {
  minWidth: 80,
  maxWidth: 100,
  flex: '0 0 auto',
  '& .MuiInputBase-root': { fontSize: '0.875rem' },
};

function LabFieldCell({ label, children, sx }) {
  return (
    <Box sx={{ flex: '0 0 auto', ...sx }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5, lineHeight: 1.2 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

export function LabReportFieldRow({ form, onChange }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'nowrap',
        gap: 1.5,
        overflowX: 'auto',
        pb: 0.5,
        alignItems: 'flex-start',
      }}
    >
      <LabFieldCell label="Sample date" sx={labMetaFieldSx}>
        <TextField
          size="small"
          type="date"
          fullWidth
          value={form.sample_date}
          onChange={(e) => onChange({ ...form, sample_date: e.target.value })}
        />
      </LabFieldCell>
      <LabFieldCell label="Lab name" sx={{ ...labMetaFieldSx, minWidth: 130 }}>
        <TextField
          size="small"
          fullWidth
          value={form.lab_name}
          onChange={(e) => onChange({ ...form, lab_name: e.target.value })}
        />
      </LabFieldCell>
      {LAB_NUTRIENT_FIELDS.map((field) => (
        <LabFieldCell key={field.key} label={fieldLabelWithUnit(field)} sx={labNutrientFieldSx}>
          <TextField
            size="small"
            fullWidth
            value={form[field.key]}
            onChange={(e) => onChange({ ...form, [field.key]: e.target.value })}
          />
        </LabFieldCell>
      ))}
    </Box>
  );
}
