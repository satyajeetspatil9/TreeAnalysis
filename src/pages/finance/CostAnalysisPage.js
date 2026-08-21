import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Grid, Table, TableBody, TableCell, TableHead, TableRow,
  CircularProgress, Alert,
} from '@mui/material';
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { formatCurrency } from '../../utils/formatters';
import { useFarm } from '../../hooks/useFarm';
import { loadFarmCostAnalysis } from '../../utils/treeCosts';

const CATEGORY_BAR_COLORS = [
  '#1565c0',
  '#2e7d32',
  '#ef6c00',
  '#6a1b9a',
  '#c62828',
  '#00838f',
  '#5d4037',
  '#4527a0',
  '#558b2f',
  '#ad1457',
];

const CHART_HEIGHT = 420;

function ChartTooltip({ active, payload, labelTitle }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Typography variant="caption" display="block">
        {labelTitle}: {point?.category || point?.code}
      </Typography>
      {payload.map((entry) => (
        <Typography key={entry.dataKey} variant="body2">
          {entry.name}: {formatCurrency(entry.value)}
        </Typography>
      ))}
    </Paper>
  );
}

function CostAnalysisPage() {
  const { farm, loading: farmLoading } = useFarm();
  const [byCategory, setByCategory] = useState([]);
  const [byTree, setByTree] = useState([]);
  const [totals, setTotals] = useState({ capex: 0, opex: 0, total: 0 });
  const [topTrees, setTopTrees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await loadFarmCostAnalysis(supabase, farm?.id);
      setByCategory(result.byCategory);
      setByTree(result.byTree);
      setTotals(result.totals);
      setTopTrees(result.topTrees);
      setLoading(false);
    }
    load();
  }, [farm]);

  if (loading || farmLoading) return <CircularProgress />;

  const hasChartData = byCategory.length > 0 || byTree.length > 0;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Cost Analysis</Typography>
      {farm && <Typography color="text.secondary" sx={{ mb: 2 }}>{farm.name}</Typography>}

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Create a farm in Settings to view cost analysis.</Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">Total</Typography>
            <Typography variant="h5">{formatCurrency(totals.total)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">CAPEX</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Capital expenditure
            </Typography>
            <Typography variant="h5">{formatCurrency(totals.capex)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">OPEX</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Operating expenditure
            </Typography>
            <Typography variant="h5">{formatCurrency(totals.opex)}</Typography>
          </Paper>
        </Grid>
      </Grid>

      {hasChartData ? (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>Total Cost by Category</Typography>
              {byCategory.length > 0 ? (
                <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                  <BarChart data={byCategory} margin={{ top: 12, right: 24, left: 8, bottom: 56 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="category"
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={70}
                    />
                    <YAxis tickFormatter={(value) => formatCurrency(value)} width={72} />
                    <Tooltip content={<ChartTooltip labelTitle="Category" />} />
                    <Bar
                      dataKey="total"
                      name="Total cost"
                      radius={[4, 4, 0, 0]}
                    >
                      {byCategory.map((entry, index) => (
                        <Cell
                          key={entry.category}
                          fill={CATEGORY_BAR_COLORS[index % CATEGORY_BAR_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Typography color="text.secondary">No category costs recorded yet.</Typography>
              )}
            </Paper>
          </Grid>
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" gutterBottom>CAPEX & OPEX by Tree</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Allocated expenses plus labour share per tree.
              </Typography>
              {byTree.length > 0 ? (
                <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                  <LineChart data={byTree} margin={{ top: 12, right: 24, left: 8, bottom: 56 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="code"
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={70}
                    />
                    <YAxis tickFormatter={(value) => formatCurrency(value)} width={72} />
                    <Tooltip content={<ChartTooltip labelTitle="Tree" />} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="capex"
                      stroke="#1565c0"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      name="CAPEX"
                    />
                    <Line
                      type="monotone"
                      dataKey="opex"
                      stroke="#ef6c00"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      name="OPEX"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Typography color="text.secondary">No tree costs recorded yet.</Typography>
              )}
            </Paper>
          </Grid>
        </Grid>
      ) : (
        farm && (
          <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
            <Typography color="text.secondary">No cost records yet. Charts appear once expenses or labour are recorded.</Typography>
          </Paper>
        )
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }} variant="outlined">
            <Typography variant="h6" gutterBottom>By Category</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Includes expenses plus labour recorded under Finance → Labour.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byCategory.map((r) => (
                  <TableRow key={r.category}>
                    <TableCell>{r.category}</TableCell>
                    <TableCell align="right">{formatCurrency(r.amount)}</TableCell>
                  </TableRow>
                ))}
                {byCategory.length === 0 && (
                  <TableRow><TableCell colSpan={2}>No costs recorded yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }} variant="outlined">
            <Typography variant="h6" gutterBottom>Top Tree Costs</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Allocated expenses plus this tree&apos;s labour share.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tree</TableCell>
                  <TableCell align="right">Allocated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {topTrees.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.code}</TableCell>
                    <TableCell align="right">{formatCurrency(t.amount)}</TableCell>
                  </TableRow>
                ))}
                {topTrees.length === 0 && (
                  <TableRow><TableCell colSpan={2}>No tree costs yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default CostAnalysisPage;
