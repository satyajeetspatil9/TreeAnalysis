import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, Grid, Paper, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import { formatLocationLabel, parsePositionCode } from '../../utils/positionCode';
import {
  BLOCK_ACCENT,
  buildBlockZoneBands,
  groupPositionsByRow,
  groupRowLots,
  positionsInBlock,
  treeShortName,
} from '../../utils/orchardLayout';

const ZONE_SELECT = 'id, zone_code, description, row_count, block';

export function useIrrigationZones() {
  const { farm } = useFarm();
  const [zones, setZones] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!farm?.id) {
        setZones([]);
        return;
      }
      const primary = await supabase
        .from('irrigation_zones')
        .select(ZONE_SELECT)
        .eq('farm_id', farm.id)
        .order('zone_code');
      if (cancelled) return;
      if (primary.error?.message?.includes('block')) {
        const fallback = await supabase
          .from('irrigation_zones')
          .select('id, zone_code, description, row_count')
          .eq('farm_id', farm.id)
          .order('zone_code');
        if (!cancelled) setZones(fallback.data || []);
        return;
      }
      setZones(primary.data || []);
    }

    load();
    return () => { cancelled = true; };
  }, [farm?.id]);

  return zones;
}

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
  const zoneTitle = band.fallbackLabel;

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

function BlockColumn({
  block, positions, allPositions, irrigationZones, firstMatchKey, firstMatchRef, blockRef, renderTree,
}) {
  const theme = useTheme();
  const accent = theme.palette[BLOCK_ACCENT[block]]?.main || theme.palette.primary.main;
  const blockPositions = positionsInBlock(positions, block);
  const bands = buildBlockZoneBands(blockPositions, {
    block,
    allZones: irrigationZones,
    allPositions,
  });

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
          label={`${blockPositions.length} tree${blockPositions.length === 1 ? '' : 's'}`}
        />
      </Box>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
        {bands.map((band) => {
          const key = `${block}-${band.key}`;
          return (
            <ZoneCard
              key={key}
              section={block}
              band={band}
              positions={band.positions}
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
  const irrigationZones = useIrrigationZones();
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
            allPositions={positions}
            irrigationZones={irrigationZones}
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
            allPositions={positions}
            irrigationZones={irrigationZones}
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
