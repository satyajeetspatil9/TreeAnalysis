// src/components/TreeList.js
import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Alert,
  Divider,
  IconButton
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import EditTreeModal from './EditTreeModal';

function TreeList() {
  const [trees, setTrees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingTree, setEditingTree] = useState(null);

  const handleOpenEditModal = (tree) => {
    setEditingTree(tree);
  };

  const handleCloseEditModal = () => {
    setEditingTree(null);
  };
  
  const handleDelete = async (treeId) => {
    try {
      const { error } = await supabase.from('trees').delete().match({ id: treeId });
      if (error) {
        throw error;
      }
    } catch (error) {
      alert(error.message);
    }
  };

  const fetchTrees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch data from the 'trees' table
      const { data, error } = await supabase
        .from('trees')
        .select('*') // Select all columns
        .order('position_code', { ascending: true }); // Order by position code

      if (error) {
        throw error;
      }
      setTrees(data);
    } catch (err) {
      console.error('Error fetching trees:', err.message);
      setError('Failed to load trees. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []); // This function has no dependencies, so the array is empty

  useEffect(() => {
    fetchTrees();

    // Set up real-time subscriptions for instant updates
    const subscription = supabase
      .channel('trees-channel') // A unique channel name
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trees' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // Add the new tree to our state, keeping the list sorted
            setTrees((currentTrees) =>
              [...currentTrees, payload.new].sort((a, b) => a.position_code.localeCompare(b.position_code))
            );
          } else if (payload.eventType === 'DELETE') {
            // Remove the deleted tree from our state
            setTrees((currentTrees) =>
              currentTrees.filter((tree) => tree.id !== payload.old.id)
            );
          } else if (payload.eventType === 'UPDATE') {
            setTrees((currentTrees) =>
              currentTrees.map((tree) => (tree.id === payload.new.id ? payload.new : tree))
            );
          }
        }
      )
      .subscribe();

    // This cleanup function will run when the component unmounts
    return () => {
      supabase.removeChannel(subscription); // Clean up subscription on unmount
    };
  }, [fetchTrees]); // Depend on the stable fetchTrees function

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ mt: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h5" component="h2" gutterBottom>
        Your Trees ({trees.length})
      </Typography>
      {trees.length === 0 ? (
        <Typography variant="body1">No trees found. Add one above!</Typography>
      ) : (
        <List>
          {trees.map((tree) => (
            <React.Fragment key={tree.id}>
              <ListItem
                secondaryAction={
                  <>
                    <IconButton edge="end" aria-label="edit" onClick={() => handleOpenEditModal(tree)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton edge="end" aria-label="delete" onClick={() => handleDelete(tree.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </>
                }
              >
                <ListItemText
                  primary={`Position: ${tree.position_code} - Variety: ${tree.variety || 'N/A'}`}
                  secondary={`Planted: ${new Date(tree.planting_date).toLocaleDateString()} | Status: ${tree.status}`}
                />
              </ListItem>
              <Divider />
            </React.Fragment>
          ))}
        </List>
      )}
      {editingTree && <EditTreeModal tree={editingTree} open={!!editingTree} onClose={handleCloseEditModal} />}
    </Box>
  );
}

export default TreeList;
