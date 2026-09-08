import React, { useMemo } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';

export function layoutByGps(rows) {
  if (!rows.length) return { aspect: 1.4, items: [] };
  const lats = rows.map((row) => row.gps.latitude);
  const lngs = rows.map((row) => row.gps.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 1e-6;
  const lngSpan = maxLng - minLng || 1e-6;
  const midLat = (minLat + maxLat) / 2;
  const widthM = lngSpan * 111320 * Math.cos((midLat * Math.PI) / 180);
  const heightM = latSpan * 111320;
  const aspect = Math.min(2.4, Math.max(0.7, widthM / heightM));

  const pad = 0.08;
  return {
    aspect,
    items: rows.map((row) => ({
      ...row,
      x: pad + ((row.gps.longitude - minLng) / lngSpan) * (1 - 2 * pad),
      y: pad + ((maxLat - row.gps.latitude) / latSpan) * (1 - 2 * pad),
    })),
  };
}

export function StatusDot({ color }) {
  return (
    <Box
      sx={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: `radial-gradient(circle at 32% 28%, ${alpha('#fff', 0.65)} 0%, ${color} 42%, ${alpha('#000', 0.28)} 100%)`,
        boxShadow: `0 2px 4px ${alpha('#000', 0.22)}`,
        flexShrink: 0,
      }}
    />
  );
}

export function TreeDotMarker({ label, to, color, tooltip }) {
  const title = [label, tooltip].filter(Boolean).join(' · ');
  return (
    <Tooltip title={title} arrow>
      <Box
        component={RouterLink}
        to={to}
        aria-label={title}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
          p: 0.25,
          borderRadius: '50%',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <StatusDot color={color} />
      </Box>
    </Tooltip>
  );
}

export function GpsTreeDotMap({
  items,
  noGpsItems = [],
  caption = 'North ↑ · placed by GPS',
  emptyGpsText = 'Trees need GPS on their position to appear on this layout.',
}) {
  const theme = useTheme();
  const gpsRows = useMemo(() => items.filter((row) => row.gps), [items]);
  const layout = useMemo(() => layoutByGps(gpsRows), [gpsRows]);
  const missingGps = noGpsItems.length ? noGpsItems : items.filter((row) => !row.gps);

  const renderMarker = (row) => (
    <TreeDotMarker
      key={row.id}
      label={row.label}
      to={row.to}
      color={row.color}
      tooltip={row.tooltip}
    />
  );

  if (!items.length && !missingGps.length) return null;

  return (
    <Box>
      {layout.items.length > 0 ? (
        <Box sx={{ position: 'relative' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            {caption}
          </Typography>
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              aspectRatio: String(layout.aspect),
              minHeight: 320,
              maxHeight: 640,
              bgcolor: alpha(theme.palette.grey[500], 0.06),
              borderRadius: 1,
            }}
          >
            {layout.items.map((row) => (
              <Box
                key={row.id}
                sx={{
                  position: 'absolute',
                  left: `${row.x * 100}%`,
                  top: `${row.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 1,
                }}
              >
                {renderMarker(row)}
              </Box>
            ))}
          </Box>
        </Box>
      ) : (
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {emptyGpsText}
        </Typography>
      )}
      {missingGps.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            {missingGps.length} tree{missingGps.length === 1 ? '' : 's'} without GPS
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {missingGps.map(renderMarker)}
          </Box>
        </Box>
      )}
    </Box>
  );
}
