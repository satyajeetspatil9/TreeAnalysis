import React, { useEffect, useState, useCallback } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress, Alert, IconButton, Chip,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import AddTreeForm from '../components/AddTreeForm';
import PageHeader from '../components/common/PageHeader';
import EditTreeModal from '../components/EditTreeModal';
import RemoveTreeDialog from '../components/trees/RemoveTreeDialog';
import HealthIndicator from '../components/common/HealthIndicator';
import { formatDate, getTreeDisplayId } from '../utils/formatters';
import { TREE_LIST_SELECT, getIrrigationZoneCode } from '../utils/schema';

function TreesPage() {
  const [trees, setTrees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingTree, setEditingTree] = useState(null);
  const [removingTree, setRemovingTree] = useState(null);

  const fetchTrees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('trees')
        .select(TREE_LIST_SELECT)
        .eq('status', 'Active');

      if (fetchError) throw fetchError;

      const sorted = (data || []).sort((a, b) =>
        getTreeDisplayId(a).localeCompare(getTreeDisplayId(b))
      );
      setTrees(sorted);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrees();
    const subscription = supabase
      .channel('trees-page-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trees' }, fetchTrees)
      .subscribe();
    return () => supabase.removeChannel(subscription);
  }, [fetchTrees]);

  return (
    <Box>
      <PageHeader
        section="Orchard"
        title="Trees"
        subtitle="Active tree instances. Each physical tag (position code) can have multiple generations in history."
      />

      <AddTreeForm onSuccess={fetchTrees} />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
      ) : error ? (
        <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
      ) : (
        <TableContainer component={Paper} sx={{ mt: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tree</TableCell>
                <TableCell>Variety</TableCell>
                <TableCell>Planting</TableCell>
                <TableCell>Irrigation</TableCell>
                <TableCell>Health</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {trees.map((tree) => (
                <TableRow key={tree.id} hover>
                  <TableCell>
                    <Typography component={RouterLink} to={`/tree/${getTreeDisplayId(tree)}`} sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}>
                      {getTreeDisplayId(tree)}
                    </Typography>
                  </TableCell>
                  <TableCell>{tree.variety || '—'}</TableCell>
                  <TableCell>{formatDate(tree.planting_date)}</TableCell>
                  <TableCell>{getIrrigationZoneCode(tree)}</TableCell>
                  <TableCell><HealthIndicator tree={tree} /></TableCell>
                  <TableCell><Chip label={tree.status} size="small" color="success" variant="outlined" /></TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setEditingTree(tree)}><EditIcon fontSize="small" /></IconButton>
                    <Chip label="Remove" size="small" onClick={() => setRemovingTree(tree)} sx={{ ml: 0.5, cursor: 'pointer' }} color="warning" variant="outlined" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {editingTree && <EditTreeModal tree={editingTree} open={!!editingTree} onClose={() => setEditingTree(null)} />}
      {removingTree && (
        <RemoveTreeDialog tree={removingTree} open={!!removingTree} onClose={() => setRemovingTree(null)} onSuccess={fetchTrees} />
      )}
    </Box>
  );
}

export default TreesPage;
