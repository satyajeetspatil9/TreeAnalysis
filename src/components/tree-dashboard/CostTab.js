import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableRow, CircularProgress, Alert,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { formatCurrency } from '../../utils/formatters';
import { loadTreeCostBreakdown } from '../../utils/treeCosts';

function CostTab({ tree }) {
  const [breakdown, setBreakdown] = useState([]);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCosts() {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await loadTreeCostBreakdown(supabase, tree);
        setBreakdown(result.breakdown);
        setTotal(result.total);
        setLoadError(result.loadError);
      } catch (err) {
        setBreakdown([]);
        setTotal(0);
        setLoadError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (tree?.id) loadCosts();
  }, [tree]);

  if (loading) return <CircularProgress size={24} />;

  return (
    <Box>
      {loadError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Some cost data could not be loaded ({loadError}). Run supabase/migrations/020_fix_tree_cost_rls.sql
          in Supabase SQL Editor if expense rows are missing.
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 2 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Tree Cost</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Includes fertilizer (zone share + tree-only applications), labour, spray, and other allocated expenses.
        </Typography>
        <Table size="small">
          <TableBody>
            {breakdown.map((row) => (
              <TableRow key={row.category}>
                <TableCell>{row.category}</TableCell>
                <TableCell align="right">{formatCurrency(row.amount)}</TableCell>
              </TableRow>
            ))}
            {breakdown.length === 0 && (
              <TableRow><TableCell colSpan={2}>No costs recorded for this tree yet.</TableCell></TableRow>
            )}
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default CostTab;
