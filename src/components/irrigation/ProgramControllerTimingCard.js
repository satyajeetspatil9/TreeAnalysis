import React from 'react';
import { Box, Grid, Paper, Typography } from '@mui/material';
import { formatDateTime } from '../../utils/irrigationStatus';

export default function ProgramControllerTimingCard({
  timing,
  jobName = null,
  channel = null,
  compact = false,
}) {
  if (!timing) return null;

  const hasAny = Boolean(
    timing.programStartPlanned
    || timing.programStartActual
    || timing.controllerStart
    || timing.programEndPlanned
    || timing.programEndActual
    || timing.controllerEnd,
  );
  if (!hasAny) return null;

  const startLag = timing.startLagVsJob !== '—' ? timing.startLagVsJob : timing.startLagVsPlanned;
  const endLag = timing.endLagVsJob !== '—' ? timing.endLagVsJob : timing.endLagVsPlanned;

  const body = (
    <>
      {!compact && (
        <>
          <Typography variant="subtitle1" fontWeight={800} gutterBottom>
            Program time vs controller time
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Program times are the irrigation job (listed start, scheduler start, planned/actual end).
            Controller times are when the ESP32 pin actually went on or off (Turso).
            {jobName ? ` Job: ${jobName}.` : ''}
            {channel ? ` Pin: ${channel}.` : ''}
          </Typography>
        </>
      )}
      <Grid container spacing={1.5}>
        <Grid item xs={12} sm={6}>
          <Typography variant="caption" color="text.secondary">Start</Typography>
          <Typography variant="body2">
            Listed {timing.programStartPlanned ? formatDateTime(timing.programStartPlanned) : '—'}
          </Typography>
          <Typography variant="body2">
            Job started {timing.programStartActual ? formatDateTime(timing.programStartActual) : '—'}
          </Typography>
          <Typography variant="body2">
            Controller {timing.controllerStart ? formatDateTime(timing.controllerStart) : '—'}
          </Typography>
          <Typography variant="body2" fontWeight={700}>{startLag}</Typography>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Typography variant="caption" color="text.secondary">End</Typography>
          <Typography variant="body2">
            Planned {timing.programEndPlanned ? formatDateTime(timing.programEndPlanned) : '—'}
          </Typography>
          <Typography variant="body2">
            Job ended {timing.programEndActual ? formatDateTime(timing.programEndActual) : '—'}
          </Typography>
          <Typography variant="body2">
            Controller {timing.controllerEnd
              ? `${formatDateTime(timing.controllerEnd)}${timing.controllerEnded ? '' : ' (expected)'}`
              : '—'}
          </Typography>
          <Typography variant="body2" fontWeight={700}>{endLag}</Typography>
        </Grid>
      </Grid>
    </>
  );

  if (compact) {
    return (
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Program vs controller
          {channel ? ` · ${channel}` : ''}
        </Typography>
        {body}
      </Box>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      {body}
    </Paper>
  );
}
