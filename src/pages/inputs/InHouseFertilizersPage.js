import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import ScienceIcon from '@mui/icons-material/Science';
import LocalFloristIcon from '@mui/icons-material/LocalFlorist';
import CurrencyRupeeIcon from '@mui/icons-material/CurrencyRupee';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/common/PageHeader';
import { formatCurrency } from '../../utils/formatters';
import {
  PRODUCT_CATEGORIES,
  PRODUCT_UNITS,
  emptyInHouseProductForm,
  loadInHouseProducts,
  loadAllProducts,
  saveInHouseProduct,
  deleteInHouseProduct,
} from '../../utils/products';

function StatCard({ label, value, subtext, icon, color = 'primary' }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        borderRadius: 2,
        bgcolor: (theme) => alpha(theme.palette[color]?.main || theme.palette.primary.main, 0.04),
        borderColor: (theme) => alpha(theme.palette[color]?.main || theme.palette.primary.main, 0.2),
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Box
          sx={{
            p: 0.75,
            borderRadius: 1.5,
            bgcolor: (theme) => alpha(theme.palette[color]?.main || theme.palette.primary.main, 0.12),
            color: (theme) => theme.palette[color]?.main || theme.palette.primary.main,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </Box>
      </Box>
      <Box>
        <Typography variant="h4" fontWeight={800} color="text.primary">
          {value}
        </Typography>
        {subtext && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {subtext}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export default function InHouseFertilizersPage() {
  const [products, setProducts] = useState([]);
  const [allCatalogProducts, setAllCatalogProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyInHouseProductForm());
  const [saving, setSaving] = useState(false);

  // Delete confirm dialog
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [inHouseData, allData] = await Promise.all([
        loadInHouseProducts(supabase),
        loadAllProducts(supabase),
      ]);
      setProducts(inHouseData || []);
      setAllCatalogProducts(allData || []);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to load in-house products.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Statistics
  const stats = useMemo(() => {
    const total = products.length;
    const active = products.filter((p) => p.active !== false).length;
    const fertilizers = products.filter((p) => p.category === 'Fertilizer').length;
    const protections = products.filter((p) => p.category === 'Plant Protection').length;
    const withRates = products.filter((p) => Number(p.default_unit_cost) > 0);
    const avgRate = withRates.length
      ? withRates.reduce((acc, p) => acc + Number(p.default_unit_cost), 0) / withRates.length
      : 0;

    return { total, active, fertilizers, protections, avgRate };
  }, [products]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        !search.trim() ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.preparation_notes && p.preparation_notes.toLowerCase().includes(search.toLowerCase()));

      const matchCategory =
        categoryFilter === 'ALL' || p.category === categoryFilter;

      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' ? p.active !== false : p.active === false);

      return matchSearch && matchCategory && matchStatus;
    });
  }, [products, search, categoryFilter, statusFilter]);

  const openAddDialog = () => {
    setEditingId(null);
    setForm(emptyInHouseProductForm());
    setMessage(null);
    setDialogOpen(true);
  };

  const openEditDialog = (product) => {
    setEditingId(product.id);
    setForm({
      product_id: product.id,
      name: product.name || '',
      category: product.category || 'Fertilizer',
      unit: product.unit || 'L',
      default_unit_cost: product.default_unit_cost != null ? String(product.default_unit_cost) : '0',
      preparation_notes: product.preparation_notes || '',
      active: product.active !== false,
    });
    setMessage(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setMessage({ type: 'error', text: 'Please select or enter a product name.' });
      return;
    }
    if (form.default_unit_cost === '' || Number(form.default_unit_cost) < 0) {
      setMessage({ type: 'error', text: 'Enter a valid non-negative rate.' });
      return;
    }

    setSaving(true);
    setMessage(null);

    const targetId = editingId || form.product_id;
    const { error } = await saveInHouseProduct(supabase, form, targetId);
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to save fertilizer.' });
      return;
    }

    setDialogOpen(false);
    setMessage({
      type: 'success',
      text: editingId
        ? `Updated '${form.name.trim()}' rate to ₹${form.default_unit_cost}/${form.unit}.`
        : `Added in-house fertilizer '${form.name.trim()}' with rate ₹${form.default_unit_cost}/${form.unit}.`,
    });
    await loadData();
  };

  const handleToggleActive = async (product) => {
    const nextActive = !product.active;
    const { error } = await supabase
      .from('products')
      .update({ active: nextActive })
      .eq('id', product.id);

    if (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to update status.' });
      return;
    }
    await loadData();
  };

  const confirmDelete = (product) => {
    setDeleteConfirm(product);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const { error } = await deleteInHouseProduct(supabase, deleteConfirm.id);
    setDeleting(false);

    if (error) {
      setMessage({
        type: 'error',
        text: `Cannot delete '${deleteConfirm.name}': it is referenced in irrigation or application logs. Consider deactivating it instead.`,
      });
      setDeleteConfirm(null);
      return;
    }

    setDeleteConfirm(null);
    setMessage({ type: 'success', text: `Deleted '${deleteConfirm.name}'.` });
    await loadData();
  };

  return (
    <Box sx={{ pb: 6 }}>
      <PageHeader
        section="Inputs"
        title="In-House Fertilizers"
        subtitle="Manage farm-prepared organic formulations (e.g. DGA, Jeevamrut, Vermiwash). Configured rates are applied directly across Fertigation, Soil Application, and Tree Costs without needing inventory stock."
      />

      {message && (
        <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {/* Info Alert Box */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          mb: 3,
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          bgcolor: (theme) => alpha(theme.palette.success.main, 0.05),
          borderColor: (theme) => alpha(theme.palette.success.main, 0.3),
        }}
      >
        <InfoOutlinedIcon color="success" />
        <Typography variant="body2" color="text.secondary">
          <strong>Zero Inventory Overhead:</strong> Formulations listed here are prepared in-house. You don't need to log purchase bills or maintain stock in Inventory. Whenever applied, their rate (₹/unit) is recorded directly in orchard expenses.
        </Typography>
      </Paper>

      {/* Metric Cards */}
      <Grid container spacing={2.5} sx={{ mb: 3.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Total Formulations"
            value={stats.total}
            subtext={`${stats.active} active for use`}
            icon={<LocalFloristIcon fontSize="small" />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Avg Formulation Rate"
            value={stats.avgRate > 0 ? `₹${stats.avgRate.toFixed(2)}` : '₹0.00'}
            subtext="Per liter / kg prepared"
            icon={<CurrencyRupeeIcon fontSize="small" />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Fertilizers"
            value={stats.fertilizers}
            subtext="DGA, Jeevamrut, Vermiwash"
            icon={<ScienceIcon fontSize="small" />}
            color="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Plant Protection"
            value={stats.protections}
            subtext="Dashparni, AgniAstra, Sprays"
            icon={<CheckCircleIcon fontSize="small" />}
            color="warning"
          />
        </Grid>
      </Grid>

      {/* Table & Controls Section */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {/* Toolbar */}
        <Box
          sx={{
            p: 2,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', flex: 1 }}>
            <TextField
              size="small"
              placeholder="Search formulation or notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 240 }}
            />

            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Category</InputLabel>
              <Select
                value={categoryFilter}
                label="Category"
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <MenuItem value="ALL">All Categories</MenuItem>
                {PRODUCT_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>{c}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="ALL">All</MenuItem>
                <MenuItem value="ACTIVE">Active only</MenuItem>
                <MenuItem value="INACTIVE">Inactive only</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openAddDialog}
            sx={{ fontWeight: 700, px: 2.5 }}
          >
            Add In-House Fertilizer
          </Button>
        </Box>

        {/* Formulations Table */}
        <TableContainer>
          <Table size="small">
            <TableHead sx={{ bgcolor: (theme) => alpha(theme.palette.primary.main, 0.03) }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Fertilizer Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Category</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Unit</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Direct Rate (Cost / Unit)</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Preparation / Recipe Notes</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Active</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">Loading in-house fertilizers…</Typography>
                  </TableCell>
                </TableRow>
              ) : filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {products.length === 0
                        ? 'No in-house fertilizers added yet. Click "Add In-House Fertilizer" to create one.'
                        : 'No fertilizers match your search filters.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts.map((p) => {
                  const rate = Number(p.default_unit_cost) || 0;
                  return (
                    <TableRow key={p.id} hover>
                      <TableCell>
                        <Typography fontWeight={700} color="text.primary">
                          {p.name}
                        </Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          color="success"
                          label="In-House"
                          sx={{ fontSize: '0.65rem', height: 18, mt: 0.5 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={p.category || 'Fertilizer'}
                          color={p.category === 'Plant Protection' ? 'warning' : 'primary'}
                          variant="filled"
                          sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={600}>{p.unit || 'L'}</Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography fontWeight={800} color={rate > 0 ? 'success.main' : 'text.secondary'}>
                            {formatCurrency(rate)} / {p.unit || 'unit'}
                          </Typography>
                          <Tooltip title="Click Edit to modify rate">
                            <IconButton size="small" onClick={() => openEditDialog(p)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {p.preparation_notes || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Switch
                          size="small"
                          checked={p.active !== false}
                          onChange={() => handleToggleActive(p)}
                          inputProps={{ 'aria-label': `Toggle ${p.name} active` }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button size="small" startIcon={<EditIcon />} onClick={() => openEditDialog(p)}>
                            Edit
                          </Button>
                          <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => confirmDelete(p)}>
                            Delete
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>
          {editingId ? `Edit ${form.name}` : 'New In-House Fertilizer'}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            Configure rate and specifications for farm-prepared formulations. This rate will automatically be used across fertigation, soil application, and cost accounting.
          </Typography>

          <Grid container spacing={2}>
            <Grid item xs={12} sm={8}>
              <Autocomplete
                id="inhouse-product-select"
                options={allCatalogProducts}
                getOptionLabel={(option) => {
                  if (typeof option === 'string') return option;
                  return option.name || '';
                }}
                isOptionEqualToValue={(option, val) => {
                  if (!option || !val) return false;
                  if (val.id && option.id) return option.id === val.id;
                  return option.name?.toLowerCase() === (val.name || val)?.toLowerCase();
                }}
                value={
                  allCatalogProducts.find(
                    (p) =>
                      (form.product_id && String(p.id) === String(form.product_id)) ||
                      (form.name && p.name.toLowerCase() === form.name.trim().toLowerCase())
                  ) || (form.name ? { name: form.name } : null)
                }
                onChange={(event, newValue) => {
                  if (!newValue) {
                    setForm(emptyInHouseProductForm());
                    return;
                  }
                  if (typeof newValue === 'string') {
                    const matched = allCatalogProducts.find(
                      (p) => p.name.toLowerCase() === newValue.trim().toLowerCase()
                    );
                    if (matched) {
                      setForm({
                        ...form,
                        product_id: matched.id,
                        name: matched.name,
                        category: matched.category || form.category || 'Fertilizer',
                        unit: matched.unit || form.unit || 'L',
                        default_unit_cost:
                          matched.default_unit_cost != null && Number(matched.default_unit_cost) > 0
                            ? String(matched.default_unit_cost)
                            : form.default_unit_cost || '0',
                        preparation_notes: matched.preparation_notes || form.preparation_notes || '',
                        active: matched.active !== false,
                      });
                    } else {
                      setForm({ ...form, product_id: '', name: newValue });
                    }
                  } else {
                    setForm({
                      ...form,
                      product_id: newValue.id,
                      name: newValue.name,
                      category: newValue.category || form.category || 'Fertilizer',
                      unit: newValue.unit || form.unit || 'L',
                      default_unit_cost:
                        newValue.default_unit_cost != null && Number(newValue.default_unit_cost) > 0
                          ? String(newValue.default_unit_cost)
                          : form.default_unit_cost || '0',
                      preparation_notes: newValue.preparation_notes || form.preparation_notes || '',
                      active: newValue.active !== false,
                    });
                  }
                }}
                freeSolo
                renderOption={(props, option) => (
                  <Box component="li" {...props} key={option.id || option.name}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {option.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {option.category || 'Fertilizer'} · Standard unit: {option.unit || 'L'}
                        </Typography>
                      </Box>
                      {option.is_inhouse && (
                        <Chip
                          size="small"
                          label="In-House"
                          color="success"
                          variant="outlined"
                          sx={{ ml: 1, height: 20, fontSize: '0.65rem' }}
                        />
                      )}
                    </Box>
                  </Box>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Product Name (from Products List)"
                    placeholder="Select or search product..."
                    required
                    helperText="Select a product from the master products catalog"
                    autoFocus
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth required>
                <InputLabel>Category</InputLabel>
                <Select
                  value={form.category}
                  label="Category"
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {PRODUCT_CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth required>
                <InputLabel>Unit of Measurement</InputLabel>
                <Select
                  value={form.unit}
                  label="Unit of Measurement"
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                >
                  {PRODUCT_UNITS.map((u) => (
                    <MenuItem key={u} value={u}>{u}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label={`Direct Rate (₹ per ${form.unit || 'unit'})`}
                type="number"
                fullWidth
                required
                value={form.default_unit_cost}
                onChange={(e) => setForm({ ...form, default_unit_cost: e.target.value })}
                InputProps={{
                  startAdornment: <InputAdornment position="start">₹</InputAdornment>,
                  inputProps: { min: 0, step: 0.5 },
                }}
                helperText="Applied directly to expenses when used"
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Preparation Recipe / Ingredients (Optional)"
                placeholder="e.g. 10 kg cow dung, 10 L cow urine, 2 kg jaggery, 2 kg besan, 200 L water. Ferment for 7 days."
                fullWidth
                multiline
                rows={3}
                value={form.preparation_notes}
                onChange={(e) => setForm({ ...form, preparation_notes: e.target.value })}
              />
            </Grid>

            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  />
                }
                label="Available for active use in fertigation and soil application"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : (editingId ? 'Save Changes' : 'Create Fertilizer')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={Boolean(deleteConfirm)} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 800 }}>Delete In-House Formulation?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Are you sure you want to delete <strong>{deleteConfirm?.name}</strong>? If it has been used in past events or programs, deletion will be blocked to maintain historical records.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
