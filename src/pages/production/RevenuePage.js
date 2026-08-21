import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Paper, Grid, Table, TableBody, TableCell, TableHead, TableRow, Alert } from '@mui/material';
import { supabase } from '../../supabaseClient';
import { formatCurrency, formatNumber } from '../../utils/formatters';
import PageHeader from '../../components/common/PageHeader';
import {
  cropYearNoticeText,
  filterRecordsForCropYear,
  getCurrentCropYearRange,
} from '../../utils/cropYear';

function RevenuePage() {
  const [records, setRecords] = useState([]);
  const cropYear = useMemo(() => getCurrentCropYearRange(), []);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('harvest_events')
        .select('tree_id, harvest_date, quantity_kg, revenue, trees(tree_positions(position_code))');
      setRecords(data || []);
    }
    load();
  }, []);

  const cropYearRecords = useMemo(
    () => filterRecordsForCropYear(records, 'harvest_date', cropYear),
    [records, cropYear]
  );

  const { byTree, totals } = useMemo(() => {
    const map = {};
    let kg = 0;
    let rev = 0;

    cropYearRecords.forEach((h) => {
      const code = h.trees?.tree_positions?.position_code || h.tree_id;
      if (!map[code]) map[code] = { code, kg: 0, revenue: 0 };
      map[code].kg += Number(h.quantity_kg || 0);
      map[code].revenue += Number(h.revenue || 0);
      kg += Number(h.quantity_kg || 0);
      rev += Number(h.revenue || 0);
    });

    return {
      byTree: Object.values(map).sort((a, b) => b.revenue - a.revenue),
      totals: { kg, revenue: rev },
    };
  }, [cropYearRecords]);

  return (
    <Box>
      <PageHeader
        title="Revenue"
        subtitle={`Sales income by tree for crop year ${cropYear.label}.`}
      />

      <Alert severity="info" sx={{ mb: 2 }}>
        {cropYearNoticeText(cropYear)}
      </Alert>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }} variant="outlined">
            <Typography variant="overline">Crop year yield ({cropYear.label})</Typography>
            <Typography variant="h5">{formatNumber(totals.kg, 1)} kg</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }} variant="outlined">
            <Typography variant="overline">Crop year revenue ({cropYear.label})</Typography>
            <Typography variant="h5">{formatCurrency(totals.revenue)}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Tree</TableCell>
              <TableCell>Yield (kg)</TableCell>
              <TableCell>Revenue</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {byTree.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} align="center">No harvest in crop year {cropYear.label} yet.</TableCell>
              </TableRow>
            ) : (
              byTree.map((r) => (
                <TableRow key={r.code}>
                  <TableCell>{r.code}</TableCell>
                  <TableCell>{formatNumber(r.kg, 1)}</TableCell>
                  <TableCell>{formatCurrency(r.revenue)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default RevenuePage;
