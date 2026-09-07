import React from 'react';
import { Box, Button, Chip, Paper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AirIcon from '@mui/icons-material/Air';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import BugReportIcon from '@mui/icons-material/BugReport';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { climateWorkAction } from '../../utils/climateWork';

function riskIcon(type) {
  switch (type) {
    case 'SPRAY':
    case 'SPRAY_WINDOW':
      return AirIcon;
    case 'FLOWER_DROP':
    case 'IRRIGATION':
      return WaterDropIcon;
    case 'DISEASE':
      return HealthAndSafetyIcon;
    case 'PEST':
      return BugReportIcon;
    default:
      return WarningAmberIcon;
  }
}

function RiskPanel({ warnings = [], onCreateWork, creatingType = null }) {
  if (warnings.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2.5, bgcolor: (t) => alpha(t.palette.success.main, 0.08) }}>
        <Typography variant="subtitle1" fontWeight={700} color="success.main">
          All systems nominal
        </Typography>
        <Typography variant="body2" color="text.secondary">
          No active risks detected for this crop.
        </Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <HealthAndSafetyIcon color="error" />
        Active advisory
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {warnings.map((warning, index) => {
          const Icon = riskIcon(warning.type);
          const isHigh = warning.level === 'HIGH';
          return (
            <Paper
              key={`${warning.type}-${index}`}
              variant="outlined"
              sx={{
                p: 1.75,
                borderLeft: 4,
                borderLeftColor: isHigh ? 'error.main' : 'warning.main',
                bgcolor: (t) => alpha(isHigh ? t.palette.error.main : t.palette.warning.main, 0.08),
              }}
            >
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <Icon color={isHigh ? 'error' : 'warning'} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      {String(warning.type).replace(/_/g, ' ')}
                    </Typography>
                    <Chip
                      size="small"
                      label={`${warning.level} RISK`}
                      color={isHigh ? 'error' : 'warning'}
                    />
                  </Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>{warning.message}</Typography>
                  {onCreateWork && (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={creatingType === warning.type}
                      onClick={() => onCreateWork(warning)}
                    >
                      {climateWorkAction(warning).label}
                    </Button>
                  )}
                </Box>
              </Box>
            </Paper>
          );
        })}
      </Box>
    </Box>
  );
}

export default RiskPanel;
