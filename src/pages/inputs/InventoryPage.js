import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Button, TextField, Grid, FormControl, InputLabel, Select, MenuItem, Alert,
  IconButton,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/common/PageHeader';
import { formatCurrency, formatDate } from '../../utils/formatters';
import {
  inventoryStockHint,
  getProductStock,
} from '../../utils/products';

function InventoryPage() {
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [purchase, setPurchase] = useState({
    product_id: '',
    quantity: '',
    unit_cost: '',
    supplier: '',
    reference: '',
  });
  const [message, setMessage] = useState(null);

  const loadData = async () => {
    const [{ data: prodData, error: prodError }, { data: purchaseData, error: purchaseError }] = await Promise.all([
      supabase
        .from('products')
        .select('*, inventory(current_stock)')
        .eq('active', true)
        .order('name'),
      supabase
        .from('inventory_transactions')
        .select('id, product_id, quantity, unit_cost, total_cost, supplier, reference, transaction_date, created_at, products(name, unit)')
        .eq('transaction_type', 'PURCHASE')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (prodError) {
      setMessage({ type: 'error', text: inventoryStockHint(prodError.message) });
      return;
    }
    if (purchaseError) {
      setMessage({ type: 'error', text: inventoryStockHint(purchaseError.message) });
    }

    setProducts(prodData || []);
    setPurchases(purchaseData || []);
    setInventory(
      (prodData || [])
        .map((product) => ({
          id: product.id,
          current_stock: getProductStock(product),
          products: { name: product.name, unit: product.unit, category: product.category },
        }))
        .filter((item) => item.current_stock > 0)
    );
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePurchase = async () => {
    if (!purchase.product_id || !purchase.quantity) {
      setMessage({ type: 'error', text: 'Product and quantity required.' });
      return;
    }
    if (purchase.unit_cost === '') {
      setMessage({ type: 'error', text: 'Enter the unit cost paid for this purchase.' });
      return;
    }

    const qty = Number(purchase.quantity);
    const unitCost = Number(purchase.unit_cost);

    if (Number.isNaN(qty) || qty <= 0 || Number.isNaN(unitCost) || unitCost < 0) {
      setMessage({ type: 'error', text: 'Quantity and unit cost must be valid positive numbers.' });
      return;
    }

    const productId = Number(purchase.product_id);
    const selectedProduct = products.find((p) => String(p.id) === String(productId));
    const productName = selectedProduct?.name || 'Product';
    const productUnit = selectedProduct?.unit || '';

    const { error: txError } = await supabase.from('inventory_transactions').insert([{
      product_id: productId,
      transaction_type: 'PURCHASE',
      quantity: qty,
      unit_cost: unitCost,
      total_cost: qty * unitCost,
      supplier: purchase.supplier,
      reference: purchase.reference,
    }]);

    if (txError) {
      setMessage({ type: 'error', text: inventoryStockHint(txError.message) });
      return;
    }

    setPurchase({
      product_id: '',
      quantity: '',
      unit_cost: '',
      supplier: '',
      reference: '',
    });

    await loadData();

    const { data: refreshed } = await supabase
      .from('products')
      .select('inventory(current_stock)')
      .eq('id', productId)
      .maybeSingle();

    const updatedStock = getProductStock(refreshed);

    setMessage({
      type: 'success',
      text: updatedStock > 0
        ? `Purchase recorded. ${productName} stock is now ${updatedStock}${productUnit ? ` ${productUnit}` : ''}.`
        : 'Purchase recorded, but stock is still 0. Run supabase/migrations/013_fix_inventory_stock_trigger.sql in Supabase SQL Editor.',
    });
  };

  const handleDeletePurchase = async (tx) => {
    const label = `${tx.products?.name || 'Product'} · ${tx.quantity} ${tx.products?.unit || ''}`;
    if (!window.confirm(`Delete purchase (${label})? Stock will be reduced by the purchased quantity.`)) return;

    const { error: adjustError } = await supabase.from('inventory_transactions').insert([{
      product_id: tx.product_id,
      transaction_type: 'ADJUSTMENT',
      quantity: tx.quantity,
      unit_cost: tx.unit_cost,
      total_cost: tx.total_cost,
      reference: `purchase_reversal:${tx.id}`,
      notes: 'Stock reduced after purchase delete',
    }]);

    if (adjustError) {
      setMessage({ type: 'error', text: inventoryStockHint(adjustError.message) });
      return;
    }

    const { error: deleteError } = await supabase.from('inventory_transactions').delete().eq('id', tx.id);
    if (deleteError) {
      setMessage({ type: 'error', text: inventoryStockHint(deleteError.message) });
      return;
    }

    setMessage({ type: 'success', text: 'Purchase deleted and stock adjusted.' });
    loadData();
  };

  return (
    <Box>
      <PageHeader
        section="Inputs"
        title="Inventory"
        subtitle="Record purchases at the price you paid and track stock for fertigation and spray."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Paper sx={{ mb: 3 }} variant="outlined">
        <Typography variant="h6" sx={{ p: 2, pb: 0 }}>Current Stock</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Stock</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {inventory.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} align="center">No stock yet. Record a purchase below.</TableCell>
              </TableRow>
            ) : (
              inventory.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.products?.name}</TableCell>
                  <TableCell>{item.current_stock} {item.products?.unit}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Record Purchase</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Enter the unit cost you paid for this purchase.
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Product</InputLabel>
              <Select
                value={purchase.product_id}
                label="Product"
                onChange={(e) => setPurchase({ ...purchase, product_id: e.target.value })}
              >
                {products.map((p) => <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Quantity"
              type="number"
              fullWidth
              required
              value={purchase.quantity}
              onChange={(e) => setPurchase({ ...purchase, quantity: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Unit cost"
              type="number"
              fullWidth
              required
              value={purchase.unit_cost}
              onChange={(e) => setPurchase({ ...purchase, unit_cost: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField label="Supplier (optional)" fullWidth value={purchase.supplier} onChange={(e) => setPurchase({ ...purchase, supplier: e.target.value })} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField label="Invoice no. (optional)" fullWidth value={purchase.reference} onChange={(e) => setPurchase({ ...purchase, reference: e.target.value })} />
          </Grid>
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={handlePurchase} disabled={!products.length}>
          Record Purchase
        </Button>
      </Paper>

      <Paper variant="outlined">
        <Typography variant="h6" sx={{ p: 2, pb: 0 }}>Recent Purchases</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Product</TableCell>
              <TableCell>Qty</TableCell>
              <TableCell>Unit cost</TableCell>
              <TableCell>Total</TableCell>
              <TableCell>Supplier</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {purchases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">No purchases recorded yet.</TableCell>
              </TableRow>
            ) : (
              purchases.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>{formatDate(tx.transaction_date || tx.created_at?.slice(0, 10))}</TableCell>
                  <TableCell>{tx.products?.name}</TableCell>
                  <TableCell>{tx.quantity} {tx.products?.unit}</TableCell>
                  <TableCell>{formatCurrency(tx.unit_cost)}</TableCell>
                  <TableCell>{formatCurrency(tx.total_cost)}</TableCell>
                  <TableCell>{tx.supplier || '—'}</TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="Delete purchase" size="small" onClick={() => handleDeletePurchase(tx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
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

export default InventoryPage;
