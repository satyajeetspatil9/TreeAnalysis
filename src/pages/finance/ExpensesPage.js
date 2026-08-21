import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Button, TextField, Grid, FormControl, InputLabel, Select, MenuItem, Alert,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { formatCurrency, formatDate } from '../../utils/formatters';

const SCOPE_TYPES = [
  { value: 'farm', label: 'Farm (manual allocation)' },
  { value: 'zone', label: 'Irrigation Zone' },
  { value: 'tree', label: 'Single Tree' },
];

const EXPENSE_TYPE_LABELS = {
  OPEX: 'OPEX — Operating expenditure',
  CAPEX: 'CAPEX — Capital expenditure',
};

function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [zones, setZones] = useState([]);
  const [trees, setTrees] = useState([]);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState({
    expense_date: new Date().toISOString().slice(0, 10),
    category: 'Fertilizer',
    description: '',
    amount: '',
    expense_type: 'OPEX',
    vendor: '',
    invoice_number: '',
    scope_type: 'zone',
    scope_id: '',
  });

  const load = async () => {
    const { data } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false }).limit(50);
    setExpenses(data || []);
    const { data: z } = await supabase.from('irrigation_zones').select('id, zone_code');
    setZones(z || []);
    const { data: t } = await supabase.from('trees').select('id, variety, tree_positions(position_code)').eq('status', 'Active');
    setTrees(t || []);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.amount || !form.category) {
      setMessage({ type: 'error', text: 'Category and amount required.' });
      return;
    }
    let notes = null;
    if (form.scope_type === 'zone' && form.scope_id) notes = `zone:${form.scope_id}`;
    if (form.scope_type === 'tree' && form.scope_id) notes = `tree:${form.scope_id}`;

    const { error } = await supabase.from('expenses').insert([{
      expense_date: form.expense_date,
      category: form.category,
      description: form.description,
      amount: Number(form.amount),
      expense_type: form.expense_type,
      vendor: form.vendor,
      invoice_number: form.invoice_number,
      notes,
    }]);
    if (error) setMessage({ type: 'error', text: error.message });
    else { setMessage({ type: 'success', text: 'Expense saved. Tree allocation runs automatically for zone/tree scope.' }); load(); }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Expenses</Typography>
      {message && <Alert severity={message.type} sx={{ mb: 2 }}>{message.text}</Alert>}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}><TextField label="Date" type="date" fullWidth InputLabelProps={{ shrink: true }} value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></Grid>
          <Grid item xs={12} md={3}><TextField label="Category" fullWidth value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Grid>
          <Grid item xs={12} md={3}><TextField label="Amount" fullWidth value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth><InputLabel>Type</InputLabel>
              <Select value={form.expense_type} label="Type" onChange={(e) => setForm({ ...form, expense_type: e.target.value })}>
                <MenuItem value="OPEX">{EXPENSE_TYPE_LABELS.OPEX}</MenuItem>
                <MenuItem value="CAPEX">{EXPENSE_TYPE_LABELS.CAPEX}</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}><TextField label="Description" fullWidth value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Grid>
          <Grid item xs={12} md={3}><TextField label="Vendor" fullWidth value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></Grid>
          <Grid item xs={12} md={3}><TextField label="Invoice" fullWidth value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth><InputLabel>Apply to</InputLabel>
              <Select value={form.scope_type} label="Apply to" onChange={(e) => setForm({ ...form, scope_type: e.target.value, scope_id: '' })}>
                {SCOPE_TYPES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          {form.scope_type === 'zone' && (
            <Grid item xs={12} md={3}>
              <FormControl fullWidth><InputLabel>Zone</InputLabel>
                <Select value={form.scope_id} label="Zone" onChange={(e) => setForm({ ...form, scope_id: e.target.value })}>
                  {zones.map((z) => <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
          )}
          {form.scope_type === 'tree' && (
            <Grid item xs={12} md={3}>
              <FormControl fullWidth><InputLabel>Tree</InputLabel>
                <Select value={form.scope_id} label="Tree" onChange={(e) => setForm({ ...form, scope_id: e.target.value })}>
                  {trees.map((t) => <MenuItem key={t.id} value={t.id}>{t.tree_positions?.position_code}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
          )}
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={handleSave}>Save Expense</Button>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead><TableRow><TableCell>Date</TableCell><TableCell>Category</TableCell><TableCell>Description</TableCell><TableCell>Type</TableCell><TableCell align="right">Amount</TableCell></TableRow></TableHead>
          <TableBody>
            {expenses.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{formatDate(e.expense_date)}</TableCell>
                <TableCell>{e.category}</TableCell>
                <TableCell>{e.description}</TableCell>
                <TableCell>{EXPENSE_TYPE_LABELS[e.expense_type] || e.expense_type}</TableCell>
                <TableCell align="right">{formatCurrency(e.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default ExpensesPage;
