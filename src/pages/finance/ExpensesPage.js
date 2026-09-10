import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Button, TextField, Grid, FormControl, InputLabel, Select, MenuItem, Alert, IconButton,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { supabase } from '../../supabaseClient';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatCurrency, formatDate } from '../../utils/formatters';
import {
  expenseScopeNotes,
  loadFarmExpenses,
  loadFarmTrees,
  loadFarmZoneIds,
  parseExpenseScope,
} from '../../utils/farmScope';

const SCOPE_TYPES = [
  { value: 'farm', label: 'Farm (manual allocation)' },
  { value: 'zone', label: 'Irrigation Zone' },
  { value: 'tree', label: 'Single Tree' },
];

const EXPENSE_TYPE_LABELS = {
  OPEX: 'OPEX — Operating expenditure',
  CAPEX: 'CAPEX — Capital expenditure',
};

const EXPENSE_CATEGORIES = ['Fertilizer', 'Labour', 'Plant protection', 'Fuel', 'Repairs', 'Other'];

function emptyExpenseForm() {
  return {
    expense_date: new Date().toISOString().slice(0, 10),
    category: 'Fertilizer',
    description: '',
    amount: '',
    expense_type: 'OPEX',
    vendor: '',
    invoice_number: '',
    scope_type: 'zone',
    scope_id: '',
  };
}

function expenseFromRecord(row) {
  const scope = parseExpenseScope(row.notes);
  return {
    expense_date: row.expense_date,
    category: row.category || 'Other',
    description: row.description || '',
    amount: row.amount != null ? String(row.amount) : '',
    expense_type: row.expense_type || 'OPEX',
    vendor: row.vendor || '',
    invoice_number: row.invoice_number || '',
    scope_type: scope.type === 'tree' ? 'tree' : (scope.type === 'farm' ? 'farm' : 'zone'),
    scope_id: scope.type === 'zone' || scope.type === 'tree' ? String(scope.id) : '',
  };
}

function ExpensesPage() {
  const { farm } = useFarm();
  const [expenses, setExpenses] = useState([]);
  const [zones, setZones] = useState([]);
  const [trees, setTrees] = useState([]);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyExpenseForm());

  const load = useCallback(async () => {
    if (!farm?.id) {
      setExpenses([]);
      setZones([]);
      setTrees([]);
      return;
    }
    const zoneIds = await loadFarmZoneIds(supabase, farm.id);
    const farmTrees = await loadFarmTrees(supabase, farm.id, {
      select: 'id, variety, tree_positions(position_code)',
    });
    const treeIds = farmTrees.map((t) => t.id);
    const [{ data: z }, farmExpenses] = await Promise.all([
      supabase.from('irrigation_zones').select('id, zone_code').eq('farm_id', farm.id).order('zone_code'),
      loadFarmExpenses(supabase, farm.id, { zoneIds, treeIds, limit: 50 }),
    ]);
    setZones(z || []);
    setTrees(farmTrees);
    setExpenses(farmExpenses);
  }, [farm?.id]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyExpenseForm());
  };

  const handleSave = async () => {
    if (!farm?.id) {
      setMessage({ type: 'error', text: 'Create a farm in Settings before recording expenses.' });
      return;
    }
    if (!form.amount || !form.category) {
      setMessage({ type: 'error', text: 'Category and amount required.' });
      return;
    }
    if (form.scope_type === 'zone' && !form.scope_id) {
      setMessage({ type: 'error', text: 'Select a zone.' });
      return;
    }
    if (form.scope_type === 'tree' && !form.scope_id) {
      setMessage({ type: 'error', text: 'Select a tree.' });
      return;
    }

    const payload = {
      expense_date: form.expense_date,
      category: form.category,
      description: form.description,
      amount: Number(form.amount),
      expense_type: form.expense_type,
      vendor: form.vendor,
      invoice_number: form.invoice_number,
      notes: expenseScopeNotes({
        scopeType: form.scope_type,
        scopeId: form.scope_id,
        farmId: farm.id,
      }),
    };

    setSaving(true);
    setMessage(null);
    const query = editingId
      ? supabase.from('expenses').update(payload).eq('id', editingId)
      : supabase.from('expenses').insert([payload]);
    const { error } = await query;
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }
    setMessage({
      type: 'success',
      text: editingId
        ? 'Expense updated.'
        : 'Expense saved. Tree allocation runs automatically for zone/tree scope.',
    });
    resetForm();
    load();
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete ${row.category} ${formatCurrency(row.amount)} on ${formatDate(row.expense_date)}?`)) {
      return;
    }
    await supabase.from('expense_allocations').delete().eq('expense_id', row.id);
    const { error } = await supabase.from('expenses').delete().eq('id', row.id);
    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }
    if (editingId === row.id) resetForm();
    setMessage({ type: 'success', text: 'Expense deleted.' });
    load();
  };

  return (
    <Box>
      <PageHeader
        section="Finance"
        title="Expenses"
        subtitle="Record spending for this farm. Zone and tree scopes allocate cost automatically."
      />
      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>Create a farm in Settings before recording expenses.</Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField label="Date" type="date" fullWidth InputLabelProps={{ shrink: true }} value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select value={form.category} label="Category" onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField label="Amount" fullWidth value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select value={form.expense_type} label="Type" onChange={(e) => setForm({ ...form, expense_type: e.target.value })}>
                <MenuItem value="OPEX">{EXPENSE_TYPE_LABELS.OPEX}</MenuItem>
                <MenuItem value="CAPEX">{EXPENSE_TYPE_LABELS.CAPEX}</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField label="Description" fullWidth value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField label="Vendor" fullWidth value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField label="Invoice" fullWidth value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Apply to</InputLabel>
              <Select value={form.scope_type} label="Apply to" onChange={(e) => setForm({ ...form, scope_type: e.target.value, scope_id: '' })}>
                {SCOPE_TYPES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          {form.scope_type === 'zone' && (
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Zone</InputLabel>
                <Select value={form.scope_id} label="Zone" onChange={(e) => setForm({ ...form, scope_id: e.target.value })}>
                  {zones.map((z) => <MenuItem key={z.id} value={String(z.id)}>{z.zone_code}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
          )}
          {form.scope_type === 'tree' && (
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Tree</InputLabel>
                <Select value={form.scope_id} label="Tree" onChange={(e) => setForm({ ...form, scope_id: e.target.value })}>
                  {trees.map((t) => <MenuItem key={t.id} value={String(t.id)}>{t.tree_positions?.position_code}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
          )}
        </Grid>
        <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
          <Button variant="contained" onClick={handleSave} disabled={saving || !farm}>
            {saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save Expense')}
          </Button>
          {editingId && <Button onClick={resetForm}>Cancel</Button>}
        </Box>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {expenses.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{formatDate(e.expense_date)}</TableCell>
                <TableCell>{e.category}</TableCell>
                <TableCell>{e.description}</TableCell>
                <TableCell>{EXPENSE_TYPE_LABELS[e.expense_type] || e.expense_type}</TableCell>
                <TableCell align="right">{formatCurrency(e.amount)}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" aria-label="Edit" onClick={() => { setEditingId(e.id); setForm(expenseFromRecord(e)); }}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label="Delete" onClick={() => handleDelete(e)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {expenses.length === 0 && (
              <TableRow><TableCell colSpan={6}>No expenses for this farm yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default ExpensesPage;
