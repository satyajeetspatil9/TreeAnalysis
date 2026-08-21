import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { TREE_STATUS } from '../utils/schema';
import {
  Modal, Box, Typography, TextField, Button, CircularProgress, Alert,
  FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import { getTreeDisplayId } from '../utils/formatters';
import VarietySelect from './VarietySelect';
import { parseTreeGps } from '../utils/treeGps';

const style = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 420,
  bgcolor: 'background.paper',
  border: 1,
  borderColor: 'divider',
  boxShadow: 24,
  p: 4,
  borderRadius: 2,
  maxHeight: '90vh',
  overflow: 'auto',
};

function EditTreeModal({ tree, open, onClose }) {
  const [status, setStatus] = useState('Active');
  const [variety, setVariety] = useState('');
  const [rootstock, setRootstock] = useState('');
  const [notes, setNotes] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (tree) {
      setStatus(tree.status || 'Active');
      setVariety(tree.variety || '');
      setRootstock(tree.rootstock || '');
      setNotes(tree.notes || '');
      const position = tree.tree_positions;
      setLatitude(position?.latitude != null ? String(position.latitude) : '');
      setLongitude(position?.longitude != null ? String(position.longitude) : '');
    }
  }, [tree]);

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(String(pos.coords.latitude));
        setLongitude(String(pos.coords.longitude));
        setLocating(false);
      },
      (err) => {
        setError(err.message || 'Could not get GPS location.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const gps = parseTreeGps(latitude, longitude);
      if (gps.error) throw new Error(gps.error);

      const positionId = tree.position_id || tree.tree_positions?.id;
      if (!positionId) throw new Error('Tree position not found.');

      const { error: updateError } = await supabase
        .from('trees')
        .update({ status, variety, rootstock, notes })
        .eq('id', tree.id);

      if (updateError) throw updateError;

      const { error: gpsError } = await supabase
        .from('tree_positions')
        .update({ latitude: gps.latitude, longitude: gps.longitude })
        .eq('id', positionId);

      if (gpsError) throw gpsError;

      setSuccess(true);
      setTimeout(onClose, 1000);
    } catch (err) {
      setError(`Failed to update tree: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={style} component="form" onSubmit={handleSubmit}>
        <Typography variant="h6" component="h2">
          Edit Tree: {getTreeDisplayId(tree)}
        </Typography>
        <VarietySelect value={variety} onChange={setVariety} required />
        <TextField label="Rootstock" fullWidth margin="normal" value={rootstock} onChange={(e) => setRootstock(e.target.value)} />
        <TextField label="Notes" fullWidth margin="normal" multiline rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <Typography variant="subtitle2" sx={{ mt: 1 }}>GPS location (required)</Typography>
        <Button variant="outlined" size="small" sx={{ mt: 1, mb: 1 }} onClick={captureLocation} disabled={locating}>
          {locating ? 'Getting location…' : 'Use my current location'}
        </Button>
        <TextField
          label="Latitude"
          type="number"
          fullWidth
          margin="normal"
          required
          inputProps={{ step: 'any', min: -90, max: 90 }}
          value={latitude}
          onChange={(e) => setLatitude(e.target.value)}
        />
        <TextField
          label="Longitude"
          type="number"
          fullWidth
          margin="normal"
          required
          inputProps={{ step: 'any', min: -180, max: 180 }}
          value={longitude}
          onChange={(e) => setLongitude(e.target.value)}
        />

        <FormControl fullWidth margin="normal">
          <InputLabel>Status</InputLabel>
          <Select value={status} label="Status" onChange={(e) => setStatus(e.target.value)}>
            {TREE_STATUS.map((value) => (
              <MenuItem key={value} value={value}>{value}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mt: 2 }}>Tree updated successfully!</Alert>}

        <Button type="submit" variant="contained" color="primary" fullWidth sx={{ mt: 3 }} disabled={loading || !latitude || !longitude}>
          {loading ? <CircularProgress size={24} /> : 'Save Changes'}
        </Button>
      </Box>
    </Modal>
  );
}

export default EditTreeModal;
