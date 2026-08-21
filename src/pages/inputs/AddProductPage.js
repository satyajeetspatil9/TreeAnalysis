import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Button, TextField, Grid, FormControl, InputLabel, Select, MenuItem, Alert,
  IconButton, Stack,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/common/PageHeader';
import {
  PRODUCT_CATEGORIES,
  PRODUCT_UNITS,
  PRODUCT_NUTRIENT_FIELDS,
  emptyProductForm,
  buildProductPayload,
  buildProductUpdatePayload,
  productFormFromRecord,
  formatNutrientComposition,
  nutrientFieldLabel,
  updateProductNutrient,
  productsRlsHint,
  inventoryStockHint,
  getProductStock,
} from '../../utils/products';

const nutrientFieldSx = {
  '& .MuiInputBase-root': { fontSize: '0.875rem' },
  '& .MuiInputLabel-root': { fontSize: '0.875rem' },
};

function AddProductPage() {
  const [products, setProducts] = useState([]);
  const [productForm, setProductForm] = useState(emptyProductForm());
  const [editingProductId, setEditingProductId] = useState(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [message, setMessage] = useState(null);

  const loadData = async () => {
    const { data: prodData, error: prodError } = await supabase
      .from('products')
      .select('*, inventory(current_stock)')
      .eq('active', true)
      .order('name');

    if (prodError) {
      setMessage({ type: 'error', text: inventoryStockHint(prodError.message) });
      return;
    }

    setProducts(prodData || []);
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetProductForm = () => {
    setEditingProductId(null);
    setProductForm(emptyProductForm());
  };

  const startEditProduct = (product) => {
    setEditingProductId(product.id);
    setProductForm(productFormFromRecord(product));
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveProduct = async () => {
    if (!productForm.name.trim()) {
      setMessage({ type: 'error', text: 'Product name is required.' });
      return;
    }
    if (!productForm.category) {
      setMessage({ type: 'error', text: 'Category is required.' });
      return;
    }
    if (!productForm.unit) {
      setMessage({ type: 'error', text: 'Unit is required.' });
      return;
    }

    setSavingProduct(true);
    setMessage(null);

    const payload = editingProductId
      ? buildProductUpdatePayload(productForm)
      : buildProductPayload(productForm);

    const { error } = editingProductId
      ? await supabase.from('products').update(payload).eq('id', editingProductId)
      : await supabase.from('products').insert([payload]);

    setSavingProduct(false);

    if (error) {
      const text = error.message.includes('products_name_key')
        ? 'A product with this name already exists.'
        : productsRlsHint(error.message);
      setMessage({ type: 'error', text });
      return;
    }

    resetProductForm();
    setMessage({
      type: 'success',
      text: editingProductId ? 'Product updated.' : 'Product added. Record a purchase in Inventory to add stock.',
    });
    loadData();
  };

  const handleDeleteProduct = async (product) => {
    const stock = getProductStock(product);
    const stockNote = stock > 0 ? ` It still has ${stock} ${product.unit} in stock and will be hidden from new entries.` : '';
    if (!window.confirm(`Remove product "${product.name}"?${stockNote}`)) return;

    const { error } = await supabase.from('products').update({ active: false }).eq('id', product.id);
    if (error) {
      setMessage({ type: 'error', text: productsRlsHint(error.message) });
      return;
    }

    if (editingProductId === product.id) resetProductForm();
    setMessage({ type: 'success', text: 'Product removed.' });
    loadData();
  };

  return (
    <Box>
      <PageHeader
        section="Farm Setting"
        title="Add Product"
        subtitle="Define products and nutrient composition. Record purchases in Inventory to track stock."
      />

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>{editingProductId ? 'Edit Product' : 'Add Product'}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Nutrient values are optional percentages (%). Enter the actual price when you record each purchase in Inventory.
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField
              label="Product name"
              fullWidth
              required
              value={productForm.name}
              onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth required>
              <InputLabel>Category</InputLabel>
              <Select
                value={productForm.category}
                label="Category"
                onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
              >
                {PRODUCT_CATEGORIES.map((category) => (
                  <MenuItem key={category} value={category}>{category}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth required>
              <InputLabel>Unit</InputLabel>
              <Select
                value={productForm.unit}
                label="Unit"
                onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}
              >
                {PRODUCT_UNITS.map((unit) => (
                  <MenuItem key={unit} value={unit}>{unit}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Nutrient composition (%)</Typography>
        <Grid container spacing={1.5}>
          {PRODUCT_NUTRIENT_FIELDS.map((field) => (
            <Grid item xs={6} sm={4} md={3} lg={2} key={field.key}>
              <TextField
                label={nutrientFieldLabel(field)}
                type="number"
                fullWidth
                size="small"
                sx={nutrientFieldSx}
                value={productForm.nutrients[field.key]}
                onChange={(e) => setProductForm(updateProductNutrient(productForm, field.key, e.target.value))}
              />
            </Grid>
          ))}
        </Grid>

        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleSaveProduct} disabled={savingProduct}>
            {editingProductId ? 'Save Changes' : 'Add Product'}
          </Button>
          {editingProductId && (
            <Button variant="text" onClick={resetProductForm} disabled={savingProduct}>Cancel</Button>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Typography variant="h6" sx={{ p: 2, pb: 0 }}>Products</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell>Nutrients</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">No products yet. Add one above.</TableCell>
              </TableRow>
            ) : (
              products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>{product.name}</TableCell>
                  <TableCell>{product.category}</TableCell>
                  <TableCell>{product.unit}</TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>{formatNutrientComposition(product.nutrient_composition)}</TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="Edit product" size="small" onClick={() => startEditProduct(product)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label="Delete product" size="small" onClick={() => handleDeleteProduct(product)}>
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

export default AddProductPage;
