import React, { useRef } from 'react';
import { Box, Button, Chip, Grid, Paper, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { formatLocationLabel, parsePositionCode } from '../../utils/positionCode';
import {
  BLOCK_ACCENT,
  ROW_BANDS,
  groupPositionsByRow,
  groupRowLots,
  positionsInSectionBand,
  treeShortName,
  zoneTitleForPositions,
} from '../../utils/orchardLayout';

export function TreeCircleLink({ pos, color, to, tooltip }) {
  const theme = useTheme();
  const parsed = parsePositionCode(pos.position_code);
  const treeName = treeShortName(pos);
  const fill = color || theme.palette.success.main;
  const href = to || `/tree/${pos.position_code}`;
  const title = tooltip || [
    pos.position_code,
    pos.activeTree?.variety,
    parsed ? formatLocationLabel(parsed) : null,
  ].filter(Boolean).join(' · ');

  return (
    <Tooltip title={title} arrow>
      <Box
        component={RouterLink}
        to={href}
        aria-label={title}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '50%',
          textDecoration: 'none',
          bgcolor: fill,
          color: theme.palette.getContrastText(fill),
          flexShrink: 0,
          '&:hover': { filter: 'brightness(0.88)' },
        }}
      >
        <Typography
          component="span"
          sx={{
            fontWeight: 800,
            fontSize: '0.7rem',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            color: 'inherit',
          }}
        >
          {treeName}
        </Typography>
      </Box>
    </Tooltip>
  );
}

function ZoneCard({ section, band, positions, cardRef, renderTree }) {
  const theme = useTheme();
  const rows = groupPositionsByRow(positions);
  const zoneTitle = zoneTitleForPositions(positions, band.fallbackLabel);

  return (
    <Paper
      ref={cardRef}
      sx={{
        p: 1.5,
        flex: 1,
        bgcolor: alpha(theme.palette.background.paper, 0.6),
      }}
      variant="outlined"
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            {zoneTitle}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Block {section} · {band.rowHint}
          </Typography>
        </Box>
        <Chip size="small" variant="outlined" label={`${positions.length} tree${positions.length === 1 ? '' : 's'}`} />
      </Box>
      {positions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No trees in this zone.</Typography>
      ) : (
        rows.map(([rowCode, rowPositions]) => {
          const lots = groupRowLots(rowPositions);
          const showLot = lots.length > 1;
          return (
            <Box
              key={rowCode}
              sx={{
                display: 'grid',
                gridTemplateColumns: '40px minmax(0, 1fr)',
                columnGap: 0.75,
                alignItems: 'start',
                py: 0.75,
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-of-type': { borderBottom: 0 },
              }}
            >
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, color: 'text.secondary', pt: 0.5, lineHeight: 1.2 }}
              >
                {rowCode}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
                {lots.map(([lot, trees]) => (
                  <Box
                    key={lot}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: showLot ? '36px minmax(0, 1fr)' : 'minmax(0, 1fr)',
                      columnGap: 0.5,
                      alignItems: 'start',
                    }}
                  >
                    {showLot && (
                      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', pt: 0.5 }}>
                        {lot}
                      </Typography>
                    )}
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, 40px)',
                        justifyContent: 'start',
                        gap: 0.5,
                      }}
                    >
                      {trees.map((pos) => (
                        <React.Fragment key={pos.id}>
                          {renderTree(pos)}
                        </React.Fragment>
                      ))}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })
      )}
    </Paper>
  );
}

function BlockColumn({ block, positions, firstMatchKey, firstMatchRef, blockRef, renderTree }) {
  const theme = useTheme();
  const accent = theme.palette[BLOCK_ACCENT[block]]?.main || theme.palette.primary.main;

  return (
    <Paper
      ref={blockRef}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid',
        borderColor: alpha(accent, 0.45),
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: alpha(accent, 0.16),
          borderBottom: '1px solid',
          borderColor: alpha(accent, 0.28),
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Block {block}
        </Typography>
        <Chip
          size="small"
          label={`${positionsInSectionBand(positions, block, 'upper').length
            + positionsInSectionBand(positions, block, 'lower').length} trees`}
        />
      </Box>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
        {ROW_BANDS.map((band) => {
          const key = `${block}-${band.key}`;
          return (
            <ZoneCard
              key={key}
              section={block}
              band={band}
              positions={positionsInSectionBand(positions, block, band.key)}
              cardRef={firstMatchKey === key ? firstMatchRef : null}
              renderTree={renderTree}
            />
          );
        })}
      </Box>
    </Paper>
  );
}

export default function OrchardZoneLayout({
  positions,
  renderTree,
  firstMatchKey = null,
  firstMatchRef = null,
  blockBRef: blockBRefProp,
  blockARef: blockARefProp,
  showBlockJump = true,
}) {
  const innerBRef = useRef(null);
  const innerARef = useRef(null);
  const blockBRef = blockBRefProp || innerBRef;
  const blockARef = blockARefProp || innerARef;
  const treeRenderer = renderTree || ((pos) => <TreeCircleLink pos={pos} />);

  return (
    <>
      {showBlockJump && (
        <Box sx={{ display: { xs: 'flex', md: 'none' }, gap: 1, mb: 2 }}>
          <Button fullWidth variant="outlined" onClick={() => blockBRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            Block B
          </Button>
          <Button fullWidth variant="outlined" onClick={() => blockARef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            Block A
          </Button>
        </Box>
      )}
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <BlockColumn
            block="B"
            positions={positions}
            firstMatchKey={firstMatchKey}
            firstMatchRef={firstMatchRef}
            blockRef={blockBRef}
            renderTree={treeRenderer}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <BlockColumn
            block="A"
            positions={positions}
            firstMatchKey={firstMatchKey}
            firstMatchRef={firstMatchRef}
            blockRef={blockARef}
            renderTree={treeRenderer}
          />
        </Grid>
      </Grid>
    </>
  );
}
