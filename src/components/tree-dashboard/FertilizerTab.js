import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, CircularProgress, Chip, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Grid,
} from '@mui/material';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import GrassIcon from '@mui/icons-material/Grass';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import { supabase } from '../../supabaseClient';
import { formatDate, formatCurrency, formatNumber } from '../../utils/formatters';
import { getIrrigationZoneId } from '../../utils/schema';
import {
  mergeFertilizerEvents,
  fertilizerQuantityShare,
  buildTreeCostByEvent,
  computeFertilizerCostTotals,
  resolveEventCosts,
  resolveProductUnitCost,
  isFertilizerAllocation,
  sumFertilizerTreeAllocations,
  collectProductIdsFromRawEvents,
  loadFertilizerCostSources,
} from '../../utils/fertilizer';

const compactCellSx = { py: 0.75, px: 1, fontSize: '0.8125rem' };
const compactHeadSx = { ...compactCellSx, fontWeight: 600, whiteSpace: 'nowrap' };

function eventScopeLabel(event) {
  if (event.isTreeSpecific) return 'This tree';
  if (event.type === 'Direct soil') return 'Zone';
  return 'Zone drip';
}

function eventDetailLabel(event) {
  if (event.type === 'Drip fertigation') {
    return `${event.waterLiters ?? '—'} L · ${event.durationMinutes ?? '—'} min`;
  }
  return event.method || '—';
}

const CHART_PRODUCT_COLORS = ['#2e7d32', '#1565c0', '#ed6c02', '#9c27b0', '#00838f', '#c62828', '#6a1b9a', '#0277bd'];

function productChartKey(product) {
  return String(product.productId || product.id);
}

function collectProductsFromEvents(events) {
  const products = new Map();

  (events || []).forEach((event) => {
    (event.products || []).forEach((product) => {
      const key = productChartKey(product);
      if (products.has(key)) return;

      const unit = product.unit || 'units';
      products.set(key, {
        key,
        name: product.name,
        unit,
        label: `${product.name} (${unit})`,
      });
    });
  });

  return [...products.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildFertilizerChartData(events, activeTreeCount) {
  const products = collectProductsFromEvents(events);
  const byDate = {};

  (events || []).forEach((event) => {
    const dateKey = String(event.eventDate).slice(0, 10);
    if (!byDate[dateKey]) {
      byDate[dateKey] = { dateKey, label: formatDate(dateKey) };
      products.forEach((product) => {
        byDate[dateKey][product.key] = 0;
      });
    }

    (event.products || []).forEach((product) => {
      const key = productChartKey(product);
      const share = fertilizerQuantityShare(product.quantity, event, activeTreeCount);
      byDate[dateKey][key] = (byDate[dateKey][key] || 0) + share;
    });
  });

  return {
    data: Object.values(byDate).sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    products,
  };
}

function buildFertilizerProductTotals(
  events,
  activeTreeCount,
  treeCostByEvent,
  zoneCostByEvent,
  unitCostByProduct,
) {
  const totals = new Map();

  (events || []).forEach((event) => {
    const { treeCost } = resolveEventCosts(
      event,
      activeTreeCount,
      treeCostByEvent,
      zoneCostByEvent,
      unitCostByProduct,
    );
    const eventProducts = event.products || [];

    const rows = eventProducts.map((product) => {
      const key = productChartKey(product);
      const quantity = fertilizerQuantityShare(product.quantity, event, activeTreeCount);
      const unitCost = resolveProductUnitCost(product, unitCostByProduct);
      return {
        key,
        name: product.name,
        unit: product.unit || 'units',
        quantity,
        cost: quantity * unitCost,
      };
    });

    const sumQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const sumCalculatedCost = rows.reduce((sum, row) => sum + row.cost, 0);

    rows.forEach((row) => {
      let cost = row.cost;
      if (treeCost > 0) {
        if (sumCalculatedCost > 0) {
          cost = treeCost * (row.cost / sumCalculatedCost);
        } else if (sumQuantity > 0) {
          cost = treeCost * (row.quantity / sumQuantity);
        } else {
          cost = treeCost / eventProducts.length;
        }
      }

      if (!totals.has(row.key)) {
        totals.set(row.key, {
          key: row.key,
          name: row.name,
          unit: row.unit,
          total: 0,
          cost: 0,
        });
      }

      const entry = totals.get(row.key);
      entry.total += row.quantity;
      entry.cost += cost;
    });
  });

  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function FertilizerQuantitySummary({ products, totalCost }) {
  return (
    <Paper sx={{ p: 1.5, mb: 2 }} variant="outlined">
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Total fertilizer used (this tree)
      </Typography>
      {products.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No fertilizer recorded.</Typography>
      ) : (
        <>
          <Grid container spacing={1.5}>
            {products.map((product) => (
              <Grid item xs={6} sm={4} md={3} key={product.key}>
                <Typography variant="caption" color="text.secondary" display="block">
                  {product.name}
                </Typography>
                <Typography variant="subtitle1" fontWeight={700}>
                  {formatNumber(product.total)} {product.unit}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatCurrency(product.cost)}
                </Typography>
              </Grid>
            ))}
          </Grid>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mt: 1.5, pt: 1, borderTop: 1, borderColor: 'divider' }}
          >
            <Typography variant="caption" color="text.secondary">Total cost (this tree)</Typography>
            <Typography variant="subtitle1" fontWeight={700}>{formatCurrency(totalCost)}</Typography>
          </Stack>
        </>
      )}
    </Paper>
  );
}

function FertilizerQuantityTooltip({ active, payload, products }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  const productByKey = Object.fromEntries((products || []).map((product) => [product.key, product]));

  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block">{point?.label}</Typography>
      {payload.map((entry) => {
        const product = productByKey[entry.dataKey];
        return (
          <Typography key={entry.dataKey} variant="body2">
            {product?.name || entry.name}: {formatNumber(entry.value)} {product?.unit || ''}
          </Typography>
        );
      })}
    </Paper>
  );
}

function FertilizerQuantityChart({ chartData, stroke, title }) {
  const { data, products } = chartData;
  if (!data.length) return null;

  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <ResponsiveContainer width="100%" height={products.length > 3 ? 220 : 180}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: products.length > 1 ? 16 : 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(value) => formatNumber(value)} width={48} tick={{ fontSize: 11 }} />
          <Tooltip content={<FertilizerQuantityTooltip products={products} />} />
          {products.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {products.map((product, index) => (
            <Line
              key={product.key}
              type="monotone"
              dataKey={product.key}
              stroke={products.length === 1 ? stroke : CHART_PRODUCT_COLORS[index % CHART_PRODUCT_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              name={product.label}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

function FertilizerSection({
  title,
  icon: Icon,
  color,
  chartStroke,
  events,
  activeTreeCount,
  treeCostByEvent,
  zoneCostByEvent,
  unitCostByProduct,
  emptyMessage,
}) {
  const costTotals = useMemo(
    () => computeFertilizerCostTotals(
      events,
      activeTreeCount,
      treeCostByEvent,
      zoneCostByEvent,
      unitCostByProduct,
    ),
    [events, activeTreeCount, treeCostByEvent, zoneCostByEvent, unitCostByProduct],
  );

  const chartData = useMemo(
    () => buildFertilizerChartData(events, activeTreeCount),
    [events, activeTreeCount],
  );

  const rows = useMemo(() => {
    const flatRows = [];

    events.forEach((event) => {
      const { treeCost } = resolveEventCosts(
        event,
        activeTreeCount,
        treeCostByEvent,
        zoneCostByEvent,
        unitCostByProduct,
      );

      event.products.forEach((product, index) => {
        flatRows.push({
          key: `${event.key}-${product.id}`,
          isFirstProduct: index === 0,
          eventDate: event.eventDate,
          scope: eventScopeLabel(event),
          detail: eventDetailLabel(event),
          productName: product.name,
          zoneQty: `${formatNumber(product.quantity)} ${product.unit}`,
          treeQty: `${formatNumber(fertilizerQuantityShare(product.quantity, event, activeTreeCount))} ${product.unit}`,
          treeCost: index === 0 ? treeCost : null,
        });
      });
    });

    return flatRows;
  }, [events, activeTreeCount, treeCostByEvent, zoneCostByEvent, unitCostByProduct]);

  return (
    <Paper sx={{ p: 1.5, mb: 2 }} variant="outlined">
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
          <Icon fontSize="small" color={color} />
          <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
          <Chip label={`${events.length} event${events.length === 1 ? '' : 's'}`} size="small" variant="outlined" />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Zone {formatCurrency(costTotals.zoneCost)} · This tree {formatCurrency(costTotals.treeCost)}
        </Typography>
      </Stack>

      {events.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
          {emptyMessage}
        </Typography>
      ) : (
        <>
          <FertilizerQuantityChart
            chartData={chartData}
            stroke={chartStroke}
            title="Fertilizer used over time (this tree)"
          />
          <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={compactHeadSx}>Date</TableCell>
                <TableCell sx={compactHeadSx}>Scope</TableCell>
                <TableCell sx={compactHeadSx}>Detail</TableCell>
                <TableCell sx={compactHeadSx}>Product</TableCell>
                <TableCell sx={compactHeadSx} align="right">Zone</TableCell>
                <TableCell sx={compactHeadSx} align="right">Tree</TableCell>
                <TableCell sx={compactHeadSx} align="right">Cost</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow
                  key={row.key}
                  sx={{
                    '& td': compactCellSx,
                    ...(index > 0 && row.isFirstProduct
                      ? { '& td': { ...compactCellSx, borderTop: 1, borderColor: 'divider' } }
                      : {}),
                  }}
                >
                  <TableCell>{row.isFirstProduct ? formatDate(row.eventDate) : ''}</TableCell>
                  <TableCell>{row.isFirstProduct ? row.scope : ''}</TableCell>
                  <TableCell>{row.isFirstProduct ? row.detail : ''}</TableCell>
                  <TableCell>{row.productName}</TableCell>
                  <TableCell align="right">{row.zoneQty}</TableCell>
                  <TableCell align="right">{row.treeQty}</TableCell>
                  <TableCell align="right">
                    {row.treeCost != null ? formatCurrency(row.treeCost) : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        </>
      )}
    </Paper>
  );
}

function FertilizerTab({ tree, zoneCode }) {
  const [events, setEvents] = useState([]);
  const [activeTreeCount, setActiveTreeCount] = useState(0);
  const [treeCostByEvent, setTreeCostByEvent] = useState({});
  const [zoneCostByEvent, setZoneCostByEvent] = useState({});
  const [unitCostByProduct, setUnitCostByProduct] = useState({});
  const [totalTreeFertilizerCost, setTotalTreeFertilizerCost] = useState(0);
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
        setTotalTreeFertilizerCost(0);
        setLoading(false);
        return;
      }

      const [
        { data: zoneTrees },
        { data: soilEvents },
        { data: fertigationEvents },
        { data: allocations },
      ] = await Promise.all([
        supabase
          .from('tree_irrigation_zones')
          .select('tree_id, trees!inner(status)')
          .eq('zone_id', zoneId)
          .is('end_date', null),
        supabase
          .from('soil_application_events')
          .select(`
            *,
            soil_application_products(
              id, product_id, quantity, unit, unit_cost,
              products(name)
            )
          `)
          .or(`and(zone_id.eq.${zoneId},tree_id.is.null),tree_id.eq.${tree.id}`)
          .order('event_date', { ascending: false })
          .limit(20),
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
      const fertilizerAllocations = (allocations || []).filter(isFertilizerAllocation);
      const mergedEvents = mergeFertilizerEvents(soilEvents, fertigationEvents);
      const productIds = collectProductIdsFromRawEvents(soilEvents, fertigationEvents);
      const costSources = await loadFertilizerCostSources(supabase, mergedEvents, productIds);

      setActiveTreeCount(activeCount);
      setTreeCostByEvent(buildTreeCostByEvent(fertilizerAllocations));
      setTotalTreeFertilizerCost(sumFertilizerTreeAllocations(fertilizerAllocations));
      setZoneCostByEvent(costSources.zoneCostByEvent);
      setUnitCostByProduct(costSources.unitCostByProduct);
      setEvents(mergedEvents);
      setLoading(false);
    }

    load();
  }, [tree]);

  const soilEvents = useMemo(
    () => events.filter((event) => event.type === 'Direct soil'),
    [events],
  );

  const fertigationEvents = useMemo(
    () => events.filter((event) => event.type === 'Drip fertigation'),
    [events],
  );

  const productQuantityTotals = useMemo(
    () => buildFertilizerProductTotals(
      events,
      activeTreeCount,
      treeCostByEvent,
      zoneCostByEvent,
      unitCostByProduct,
    ),
    [events, activeTreeCount, treeCostByEvent, zoneCostByEvent, unitCostByProduct],
  );

  const computedTreeCost = useMemo(
    () => computeFertilizerCostTotals(
      events,
      activeTreeCount,
      treeCostByEvent,
      zoneCostByEvent,
      unitCostByProduct,
    ).treeCost,
    [events, activeTreeCount, treeCostByEvent, zoneCostByEvent, unitCostByProduct],
  );

  const displayTotalCost = totalTreeFertilizerCost > 0
    ? totalTreeFertilizerCost
    : computedTreeCost;

  if (loading) return <CircularProgress size={24} />;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Zone {zoneCode} · {activeTreeCount || '—'} active tree{activeTreeCount === 1 ? '' : 's'}.
        Zone applications split equally; this-tree soil applies in full.
      </Typography>

      <FertilizerQuantitySummary products={productQuantityTotals} totalCost={displayTotalCost} />

      {activeTreeCount === 0 && (
        <Paper sx={{ p: 1.5, mb: 2 }} variant="outlined">
          <Typography color="warning.main" variant="body2">
            No active trees in this zone — per-tree shares cannot be calculated.
          </Typography>
        </Paper>
      )}

      <FertilizerSection
        title="Direct Soil Application"
        icon={GrassIcon}
        color="success"
        chartStroke="#2e7d32"
        events={soilEvents}
        activeTreeCount={activeTreeCount}
        treeCostByEvent={treeCostByEvent}
        zoneCostByEvent={zoneCostByEvent}
        unitCostByProduct={unitCostByProduct}
        emptyMessage="No direct soil fertilizer. Use Inputs → Soil Application."
      />

      <FertilizerSection
        title="Drip Fertigation"
        icon={WaterDropIcon}
        color="primary"
        chartStroke="#1565c0"
        events={fertigationEvents}
        activeTreeCount={activeTreeCount}
        treeCostByEvent={treeCostByEvent}
        zoneCostByEvent={zoneCostByEvent}
        unitCostByProduct={unitCostByProduct}
        emptyMessage="No drip fertigation. Use Irrigation → Fertigation."
      />
    </Box>
  );
}

export default FertilizerTab;
