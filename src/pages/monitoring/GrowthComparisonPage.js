import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, Grid,
} from '@mui/material';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, formatNumber, getTreeDisplayId } from '../../utils/formatters';

function computeAverages(records) {
  const heightValues = records
    .filter((r) => r.height_cm != null && r.height_cm !== '')
    .map((r) => Number(r.height_cm));
  const trunkValues = records
    .filter((r) => r.trunk_diameter_mm != null && r.trunk_diameter_mm !== '')
    .map((r) => Number(r.trunk_diameter_mm));

  return {
    height: heightValues.length
      ? heightValues.reduce((sum, value) => sum + value, 0) / heightValues.length
      : null,
    trunk: trunkValues.length
      ? trunkValues.reduce((sum, value) => sum + value, 0) / trunkValues.length
      : null,
    count: records.length,
    heightCount: heightValues.length,
    trunkCount: trunkValues.length,
  };
}

function diffFromAverage(value, average) {
  if (value == null || value === '' || average == null) return '—';
  return `${formatNumber(Number(value) - average, 1)}`;
}

function sortRecords(records) {
  return records.slice().sort((a, b) =>
    getTreeDisplayId(a.trees || {}).localeCompare(getTreeDisplayId(b.trees || {}))
  );
}

function HeightTooltip({ active, payload, average }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block" sx={{ fontWeight: 600 }}>{row?.tree}</Typography>
      <Typography variant="body2">Height: {formatNumber(row?.height, 1)} cm</Typography>
      {average != null && (
        <Typography variant="caption" color="text.secondary">
          vs avg: {formatNumber(Number(row?.height) - average, 1)} cm
        </Typography>
      )}
    </Paper>
  );
}

function TrunkTooltip({ active, payload, average }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block" sx={{ fontWeight: 600 }}>{row?.tree}</Typography>
      <Typography variant="body2">Trunk: {formatNumber(row?.trunk, 1)} mm</Typography>
      {average != null && (
        <Typography variant="caption" color="text.secondary">
          vs avg: {formatNumber(Number(row?.trunk) - average, 1)} mm
        </Typography>
      )}
    </Paper>
  );
}

function GrowthComparisonPage() {
  const [records, setRecords] = useState([]);

  useEffect(() => {
    async function load() {
      const { data: latest } = await supabase
        .from('tree_growth')
        .select('*, trees(tree_positions(position_code), variety)')
        .order('measurement_date', { ascending: false });

      const byTree = {};
      (latest || []).forEach((r) => {
        if (!byTree[r.tree_id]) byTree[r.tree_id] = r;
      });
      setRecords(Object.values(byTree));
    }
    load();
  }, []);

  const averages = useMemo(() => computeAverages(records), [records]);

  const heightChartData = useMemo(
    () => sortRecords(records)
      .filter((r) => r.height_cm != null && r.height_cm !== '')
      .map((r) => ({
        tree: getTreeDisplayId(r.trees || {}),
        height: Number(r.height_cm),
      })),
    [records]
  );

  const trunkChartData = useMemo(
    () => sortRecords(records)
      .filter((r) => r.trunk_diameter_mm != null && r.trunk_diameter_mm !== '')
      .map((r) => ({
        tree: getTreeDisplayId(r.trees || {}),
        trunk: Number(r.trunk_diameter_mm),
      })),
    [records]
  );

  const xAxisProps = {
    dataKey: 'tree',
    interval: 0,
    angle: -35,
    textAnchor: 'end',
    height: 72,
    tick: { fontSize: 11 },
  };

  return (
    <Box>
      <PageHeader
        title="Growth Comparison"
        subtitle="Latest measurement per tree compared with orchard averages."
      />

      <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <Typography variant="caption" color="text.secondary">Average height</Typography>
            <Typography variant="h6">
              {averages.height != null ? `${formatNumber(averages.height, 1)} cm` : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {averages.heightCount} tree{averages.heightCount === 1 ? '' : 's'}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Typography variant="caption" color="text.secondary">Average trunk</Typography>
            <Typography variant="h6">
              {averages.trunk != null ? `${formatNumber(averages.trunk, 1)} mm` : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {averages.trunkCount} tree{averages.trunkCount === 1 ? '' : 's'}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Typography variant="caption" color="text.secondary">Trees measured</Typography>
            <Typography variant="h6">{averages.count}</Typography>
          </Grid>
        </Grid>
      </Paper>

      {records.length > 0 && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} lg={6}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Height by Tree</Typography>
              {heightChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={heightChartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis {...xAxisProps} />
                    <YAxis tickFormatter={(value) => `${value} cm`} width={52} />
                    <Tooltip content={<HeightTooltip average={averages.height} />} />
                    {averages.height != null && (
                      <ReferenceLine
                        y={averages.height}
                        stroke="#ef6c00"
                        strokeDasharray="4 4"
                        label={{ value: 'Avg', position: 'insideTopRight', fill: '#ef6c00', fontSize: 12 }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="height"
                      stroke="#2e7d32"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Height (cm)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Typography color="text.secondary">No height measurements yet.</Typography>
              )}
            </Paper>
          </Grid>
          <Grid item xs={12} lg={6}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Trunk by Tree</Typography>
              {trunkChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trunkChartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis {...xAxisProps} />
                    <YAxis tickFormatter={(value) => `${value} mm`} width={52} />
                    <Tooltip content={<TrunkTooltip average={averages.trunk} />} />
                    {averages.trunk != null && (
                      <ReferenceLine
                        y={averages.trunk}
                        stroke="#ef6c00"
                        strokeDasharray="4 4"
                        label={{ value: 'Avg', position: 'insideTopRight', fill: '#ef6c00', fontSize: 12 }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="trunk"
                      stroke="#1565c0"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Trunk (mm)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Typography color="text.secondary">No trunk measurements yet.</Typography>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Tree</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Height (cm)</TableCell>
              <TableCell>Trunk (mm)</TableCell>
              <TableCell>vs Avg Height</TableCell>
              <TableCell>vs Avg Trunk</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">No growth measurements recorded yet.</TableCell>
              </TableRow>
            ) : (
              sortRecords(records).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{getTreeDisplayId(r.trees || {})}</TableCell>
                  <TableCell>{formatDate(r.measurement_date)}</TableCell>
                  <TableCell>{formatNumber(r.height_cm, 1)}</TableCell>
                  <TableCell>{formatNumber(r.trunk_diameter_mm, 1)}</TableCell>
                  <TableCell>
                    {diffFromAverage(r.height_cm, averages.height)}
                    {r.height_cm != null && averages.height != null ? ' cm' : ''}
                  </TableCell>
                  <TableCell>
                    {diffFromAverage(r.trunk_diameter_mm, averages.trunk)}
                    {r.trunk_diameter_mm != null && averages.trunk != null ? ' mm' : ''}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default GrowthComparisonPage;
