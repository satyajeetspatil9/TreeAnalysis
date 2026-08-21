import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Paper, CircularProgress, Grid, Alert } from '@mui/material';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { formatCurrency, formatNumber } from '../../utils/formatters';
import {
  aggregateRecordsByCropYear,
  cropYearNoticeText,
  filterRecordsForCropYear,
  getCurrentCropYearRange,
} from '../../utils/cropYear';

function YieldTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block">Crop year {point?.label}</Typography>
      <Typography variant="body2">
        Yield: {formatNumber(payload[0]?.value, 1)} kg
      </Typography>
      {point?.harvestCount > 1 && (
        <Typography variant="caption" color="text.secondary">
          {point.harvestCount} harvests combined
        </Typography>
      )}
    </Paper>
  );
}

function RevenueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block">Crop year {point?.label}</Typography>
      <Typography variant="body2">
        Revenue: {formatCurrency(payload[0]?.value)}
      </Typography>
      {point?.harvestCount > 1 && (
        <Typography variant="caption" color="text.secondary">
          {point.harvestCount} harvests combined
        </Typography>
      )}
    </Paper>
  );
}

function buildChartData(records) {
  return aggregateRecordsByCropYear(records).map((year) => ({
    startYear: year.startYear,
    label: year.label,
    yieldKg: year.yieldKg,
    revenue: year.revenue,
    harvestCount: year.harvestCount,
  }));
}

function sumTotals(records) {
  return (records || []).reduce(
    (acc, record) => ({
      kg: acc.kg + Number(record.quantity_kg || 0),
      revenue: acc.revenue + Number(record.revenue || 0),
    }),
    { kg: 0, revenue: 0 }
  );
}

function YieldTab({ tree }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const cropYear = useMemo(() => getCurrentCropYearRange(), []);

  useEffect(() => {
    async function loadYield() {
      setLoading(true);
      const { data } = await supabase
        .from('harvest_events')
        .select('*')
        .eq('tree_id', tree.id)
        .order('harvest_date', { ascending: false });

      setRecords(data || []);
      setLoading(false);
    }

    loadYield();
  }, [tree.id]);

  const cropYearRecords = useMemo(
    () => filterRecordsForCropYear(records, 'harvest_date', cropYear),
    [records, cropYear]
  );

  const yearlySummaries = useMemo(
    () => aggregateRecordsByCropYear(records).slice().reverse(),
    [records]
  );

  const totals = useMemo(() => sumTotals(cropYearRecords), [cropYearRecords]);
  const chartData = useMemo(() => buildChartData(records), [records]);

  if (loading) return <CircularProgress size={24} />;

  const cropYearNotice = (
    <Alert severity="info" sx={{ mb: 2 }}>
      {cropYearNoticeText(cropYear)}
    </Alert>
  );

  if (records.length === 0) {
    return (
      <Box>
        {cropYearNotice}
        <Paper sx={{ p: 3 }} variant="outlined">
          <Typography color="text.secondary">Not yet producing. Harvest records will appear here.</Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box>
      {cropYearNotice}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption">Crop year yield ({cropYear.label})</Typography>
            <Typography variant="h5">{formatNumber(totals.kg, 1)} kg</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, textAlign: 'center' }} variant="outlined">
            <Typography variant="caption">Crop year revenue ({cropYear.label})</Typography>
            <Typography variant="h5">{formatCurrency(totals.revenue)}</Typography>
          </Paper>
        </Grid>
      </Grid>

      {chartData.length > 0 ? (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Yield by Crop Year</Typography>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={(value) => `${value} kg`} width={56} />
                  <Tooltip content={<YieldTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="yieldKg"
                    stroke="#2e7d32"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    name="Yield (kg)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Revenue by Crop Year</Typography>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={(value) => `₹${value}`} width={56} />
                  <Tooltip content={<RevenueTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#1565c0"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    name="Revenue"
                  />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        </Grid>
      ) : (
        <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
          <Typography color="text.secondary">
            No harvest recorded in crop year {cropYear.label} yet.
          </Typography>
        </Paper>
      )}

      <Typography variant="h6" gutterBottom>Harvest by crop year</Typography>
      {yearlySummaries.map((year) => (
        <Paper key={year.startYear} sx={{ p: 2, mb: 1 }} variant="outlined">
          <Typography variant="subtitle2">Crop year {year.label}</Typography>
          <Typography>
            {formatNumber(year.yieldKg, 1)} kg | {formatCurrency(year.revenue)}
            {year.harvestCount > 1 ? ` | ${year.harvestCount} harvests` : ''}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}

export default YieldTab;
