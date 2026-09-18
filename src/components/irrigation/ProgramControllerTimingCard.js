import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { formatDateTime } from '../../utils/irrigationStatus';

function timeOrDash(value) {
  return value ? formatDateTime(value) : '—';
}

export default function ProgramControllerTimingCard({
  timing,
  jobName = null,
  channel = null,
  compact = false,
}) {
  if (!timing) return null;

  const programStart = timing.programStartActual || timing.programStartPlanned;
  const programEnd = timing.programEndActual || timing.programEndPlanned;
  const hasAny = Boolean(
    programStart
    || programEnd
    || timing.controllerStart
    || timing.controllerEnd,
  );
  if (!hasAny) return null;

  const startDiff = timing.startLagVsJob !== '—'
    ? timing.startLagVsJob
    : timing.startLagVsPlanned;

  const line = [
    `Program start ${timeOrDash(programStart)}`,
    `end ${timeOrDash(programEnd)}`,
    `controller start ${timeOrDash(timing.controllerStart)}`,
    `controller end ${timeOrDash(timing.controllerEnd)}`,
    `start diff ${startDiff || '—'}`,
  ].join(', ');

  const suffix = [jobName, channel].filter(Boolean).join(' · ');

  const text = (
    <Typography variant={compact ? 'caption' : 'body2'} sx={{ wordBreak: 'break-word' }}>
      {line}
      {suffix ? ` (${suffix})` : ''}
    </Typography>
  );

  if (compact) {
    return <Box sx={{ mt: 1 }}>{text}</Box>;
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      {text}
    </Paper>
  );
}
