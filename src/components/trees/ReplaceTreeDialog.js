import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Alert, CircularProgress,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { getTreeDisplayId } from '../../utils/formatters';
import { getPositionCode } from '../../utils/schema';
import VarietySelect from '../VarietySelect';

function ReplaceTreeDialog({ oldTree, open, onClose, onSuccess }) {
  const [variety, setVariety] = useState(oldTree?.variety || '');
  const [plantingDate, setPlantingDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const positionCode = getPositionCode(oldTree);
      const positionId = oldTree.position_id || oldTree.tree_positions?.id;
      if (!positionId) throw new Error('Tree position not found.');

      if (oldTree.status === 'Active') {
        const { error: archiveError } = await supabase
          .from('trees')
          .update({
            status: 'Removed',
            removed_date: plantingDate,
            notes: `[Replaced ${plantingDate}]${oldTree.notes ? `\n${oldTree.notes}` : ''}`,
          })
          .eq('id', oldTree.id);
        if (archiveError) throw archiveError;
      }

      const { data: newTree, error: insertError } = await supabase
        .from('trees')
        .insert([
          {
            position_id: positionId,
            variety,
            planting_date: plantingDate,
            status: 'Active',
            rootstock: oldTree.rootstock,
            nursery: oldTree.nursery,
            planting_batch: oldTree.planting_batch,
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      if (oldTree.status === 'Active') {
        await supabase.from('tree_replacements').insert([
          {
            position_code: positionCode,
            position_id: positionId,
            old_tree_id: oldTree.id,
            new_tree_id: newTree.id,
            replacement_date: plantingDate,
            reason: 'Replacement',
          },
        ]);
      }

      onSuccess?.(newTree);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {oldTree?.status === 'Active' ? 'Replace Tree' : 'Plant New Tree'} at {getTreeDisplayId(oldTree)}
      </DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          Position {getTreeDisplayId(oldTree)} stays on the physical tag. A new tree instance is created; prior instances remain in history.
        </Alert>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <VarietySelect value={variety} onChange={setVariety} required />
        <TextField label="Planting Date" type="date" fullWidth margin="normal" InputLabelProps={{ shrink: true }} value={plantingDate} onChange={(e) => setPlantingDate(e.target.value)} required />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading || !variety}>
          {loading ? <CircularProgress size={22} /> : 'Confirm'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ReplaceTreeDialog;
