import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Alert, CircularProgress,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { getTreeDisplayId } from '../../utils/formatters';

const REMOVAL_REASONS = ['Disease', 'Storm damage', 'Poor growth', 'Replanting', 'Other'];

function RemoveTreeDialog({ tree, open, onClose, onSuccess }) {
  const [reason, setReason] = useState('');
  const [removedDate, setRemovedDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!reason) {
      setError('Please select a removal reason.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const note = `[Removed ${removedDate}] ${reason}${tree.notes ? `\n${tree.notes}` : ''}`;
      const { error: updateError } = await supabase
        .from('trees')
        .update({ status: 'Removed', removed_date: removedDate, notes: note })
        .eq('id', tree.id);

      if (updateError) throw updateError;
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Remove Tree: {getTreeDisplayId(tree)}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          Marks this tree instance as removed. The physical position and all historical records are preserved.
        </Alert>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <FormControl fullWidth margin="normal">
          <InputLabel>Reason</InputLabel>
          <Select value={reason} label="Reason" onChange={(e) => setReason(e.target.value)}>
            {REMOVAL_REASONS.map((r) => (
              <MenuItem key={r} value={r}>{r}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField label="Removal Date" type="date" fullWidth margin="normal" InputLabelProps={{ shrink: true }} value={removedDate} onChange={(e) => setRemovedDate(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" color="warning" disabled={loading}>
          {loading ? <CircularProgress size={22} /> : 'Mark as Removed'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default RemoveTreeDialog;
