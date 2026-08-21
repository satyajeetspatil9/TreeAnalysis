import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, CircularProgress, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Divider,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { formatDate, formatCurrency, formatNumber } from '../../utils/formatters';
import { getIrrigationZoneId } from '../../utils/schema';
import {
  normalizeFertigationEvents,
  perTreeShare,
  buildTreeCostByEvent,
  computeFertilizerCostTotals,
  resolveEventCosts,
  sumFertigationTreeAllocations,
  isFertigationAllocation,
  collectProductIdsFromFertigationEvents,
  loadFertilizerCostSources,
} from '../../utils/fertilizer';

function FertigationTab({ tree, zoneCode }) {
  const [events, setEvents] = useState([]);
  const [activeTreeCount, setActiveTreeCount] = useState(0);
  const [treeCostByEvent, setTreeCostByEvent] = useState({});
  const [zoneCostByEvent, setZoneCostByEvent] = useState({});
  const [unitCostByProduct, setUnitCostByProduct] = useState({});
  const [totalTreeFertigationCost, setTotalTreeFertigationCost] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const zoneId = getIrrigationZoneId(tree);
      if (!zoneId) {
        setEvents([]);
        setActiveTreeCount(0);
        setTreeCostByEvent({});
        setZoneCostByEvent({});
        setUnitCostByProduct({});
        setTotalTreeFertigationCost(0);
        setLoading(false);
        return;
      }

      const [
        { data: zoneTrees },
        { data: fertigationEvents },
        { data: allocations },
      ] = await Promise.all([
        supabase
          .from('tree_irrigation_zones')
          .select('tree_id, trees!inner(status)')
          .eq('zone_id', zoneId)
          .is('end_date', null),
        supabase
          .from('fertigation_events')
          .select(`
            *,
            fertigation_products(
              id, product_id, quantity, unit,
              products(name)
            )
          `)
          .eq('zone_id', zoneId)
          .order('event_date', { ascending: false })
          .limit(20),
        supabase
          .from('expense_allocations')
          .select('allocation_amount, expenses(category, notes)')
          .eq('tree_id', tree.id),
      ]);

      const activeCount = (zoneTrees || []).filter((row) => row.trees?.status === 'Active').length;
      const fertigationAllocations = (allocations || []).filter(isFertigationAllocation);
      const normalizedEvents = normalizeFertigationEvents(fertigationEvents);
      const productIds = collectProductIdsFromFertigationEvents(fertigationEvents);
      const costSources = await loadFertilizerCostSources(supabase, normalizedEvents, productIds);

      setActiveTreeCount(activeCount);
      setTreeCostByEvent(buildTreeCostByEvent(fertigationAllocations));
      setTotalTreeFertigationCost(sumFertigationTreeAllocations(fertigationAllocations));
      setZoneCostByEvent(costSources.zoneCostByEvent);
      setUnitCostByProduct(costSources.unitCostByProduct);
      setEvents(normalizedEvents);
      setLoading(false);
    }

    load();
  }, [tree]);

  const costTotals = useMemo(
    () => computeFertilizerCostTotals(
      events,
      activeTreeCount,
      treeCostByEvent,
      zoneCostByEvent,
      unitCostByProduct
    ),
    [events, activeTreeCount, treeCostByEvent, zoneCostByEvent, unitCostByProduct]
  );

  const displayTreeTotal = totalTreeFertigationCost > 0
    ? totalTreeFertigationCost
    : costTotals.treeCost;

  if (loading) return <CircularProgress size={24} />;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Zone {zoneCode} drip fertigation. Zone totals are split equally across{' '}
        {activeTreeCount || '—'} active tree{activeTreeCount === 1 ? '' : 's'} in this zone.
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={3}
          divider={<Divider orientation="vertical" flexItem />}
        >
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">
              Total zone fertigation cost
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              {formatCurrency(costTotals.zoneCost)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Sum of listed zone events below
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">
              Total fertigation cost (this tree)
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              {formatCurrency(displayTreeTotal)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {totalTreeFertigationCost > 0
                ? 'All fertigation allocations for this tree'
                : 'Estimated from listed events'}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {activeTreeCount === 0 && (
        <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
          <Typography color="warning.main" variant="body2">
            No active trees are assigned to this irrigation zone. Per-tree shares cannot be calculated.
          </Typography>
        </Paper>
      )}

      {events.length === 0 ? (
        <Paper sx={{ p: 3 }} variant="outlined">
          <Typography color="text.secondary">
            No fertigation recorded for zone {zoneCode}. Use Irrigation → Fertigation.
          </Typography>
        </Paper>
      ) : (
        events.map((event) => {
          const { zoneCost, treeCost } = resolveEventCosts(
            event,
            activeTreeCount,
            treeCostByEvent,
            zoneCostByEvent,
            unitCostByProduct
          );

          return (
            <Paper key={event.key} sx={{ p: 2, mb: 2 }} variant="outlined">
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                {formatDate(event.eventDate)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Water: {event.waterLiters ?? '—'} L · Duration: {event.durationMinutes ?? '—'} min
              </Typography>

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">Zone applied</TableCell>
                    <TableCell align="right">This tree share</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {event.products.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>{product.name}</TableCell>
                      <TableCell align="right">
                        {formatNumber(product.quantity)} {product.unit}
                      </TableCell>
                      <TableCell align="right">
                        {formatNumber(perTreeShare(product.quantity, activeTreeCount))} {product.unit}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Divider sx={{ my: 1.5 }} />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Zone cost: {formatCurrency(zoneCost || treeCost * activeTreeCount)}
                </Typography>
                <Typography variant="body2">
                  This tree: {formatCurrency(treeCost)}
                </Typography>
              </Stack>
            </Paper>
          );
        })
      )}

      {events.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Showing {events.length} fertigation event{events.length === 1 ? '' : 's'}.
        </Typography>
      )}
    </Box>
  );
}

export default FertigationTab;
