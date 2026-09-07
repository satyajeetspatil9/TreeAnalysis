import React from 'react';
import { Box, LinearProgress, Paper, Typography } from '@mui/material';

function CropStageStatus({ crop, gdd, stage, dailyGDD }) {
  const milestones = String(crop).toLowerCase() === 'mango'
    ? [
      { label: 'Vegetative', max: 300 },
      { label: 'Initiation', max: 600 },
      { label: 'Flowering', max: 900 },
      { label: 'Fruit Set', max: 1200 },
      { label: 'Maturity', max: 1500 },
    ]
    : [
      { label: 'Vegetative', max: 250 },
      { label: 'Flowering', max: 500 },
      { label: 'Nut Set', max: 850 },
      { label: 'Maturity', max: 1200 },
    ];

  const maxGDD = milestones[milestones.length - 1].max;
  const progressPercent = Math.min(100, Math.max(0, (Number(gdd) / maxGDD) * 100));
  const stageLower = String(stage || '').toLowerCase();

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>Growth tracking</Typography>
          <Typography variant="body2" color="text.secondary">GDD and stage analysis</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 3 }}>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="h6" fontWeight={700}>{dailyGDD}</Typography>
            <Typography variant="caption" color="text.secondary">Daily GDD</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="h4" fontWeight={800} color="primary.main">
              {Math.round(Number(gdd) || 0)}
              <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.75 }}>Total</Typography>
            </Typography>
            <Typography variant="caption" color="info.main" display="block">
              Current: {stage}
            </Typography>
          </Box>
        </Box>
      </Box>

      <LinearProgress
        variant="determinate"
        value={progressPercent}
        sx={{ height: 10, borderRadius: 5, mb: 2 }}
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: `repeat(${milestones.length}, 1fr)` },
          gap: 1,
          textAlign: 'center',
        }}
      >
        {milestones.map((m, i) => {
          const active = stageLower.includes(m.label.toLowerCase()) || stageLower === m.label.toLowerCase();
          return (
            <Box key={m.label} sx={{ color: active ? 'primary.main' : 'text.secondary' }}>
              <Typography variant="caption" fontWeight={active ? 700 : 500} display="block">{m.label}</Typography>
              <Typography variant="caption" color="text.disabled">
                {i === 0 ? `0–${m.max}` : `${milestones[i - 1].max}–${m.max}`}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

export default CropStageStatus;
