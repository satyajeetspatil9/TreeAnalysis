import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Paper, Grid, TextField, Button, FormControl, InputLabel, Select, MenuItem,
  CircularProgress, Alert, Stack, IconButton,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { supabase } from '../../supabaseClient';
import {
  deleteTreePhoto,
  insertTreePhoto,
  photosRlsHint,
  uploadTreePhotoFile,
} from '../../utils/treePhotos';

const PHOTO_TYPES = {
  TREE: '🌳 Full Tree',
  LEAF: '🍃 Leaf',
  TRUNK: '🪵 Trunk',
  DISEASE: '🐛 Disease',
  FRUIT: '🥭 Fruit',
  OTHER: '📷 Other',
};

function emptyForm() {
  return {
    photo_url: '',
    photo_type: 'TREE',
    description: '',
    taken_at: new Date().toISOString().slice(0, 10),
  };
}

function PhotosTab({ tree }) {
  const fileInputRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [message, setMessage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [form, setForm] = useState(emptyForm());

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('photos')
      .select('*')
      .eq('tree_id', tree.id)
      .order('taken_at', { ascending: false });

    if (error) {
      setMessage({ type: 'error', text: photosRlsHint(error.message) });
      setPhotos([]);
    } else {
      setPhotos(data || []);
    }
    setLoading(false);
  }, [tree.id]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const clearSelectedFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Please choose an image file.' });
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setMessage(null);
  };

  const resetForm = () => {
    setForm(emptyForm());
    clearSelectedFile();
  };

  const handleAdd = async () => {
    const hasUrl = Boolean(form.photo_url.trim());
    if (!selectedFile && !hasUrl) {
      setMessage({ type: 'error', text: 'Choose a photo from your device or paste an image URL.' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      let photoUrl = form.photo_url.trim();
      if (selectedFile) {
        photoUrl = await uploadTreePhotoFile(supabase, tree.id, selectedFile);
      }

      await insertTreePhoto(supabase, tree.id, {
        photo_url: photoUrl,
        photo_type: form.photo_type,
        description: form.description,
        taken_at: new Date(form.taken_at).toISOString(),
      });

      resetForm();
      setMessage({ type: 'success', text: 'Photo added.' });
      await fetchPhotos();
    } catch (err) {
      setMessage({ type: 'error', text: photosRlsHint(err.message) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (photo) => {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return;

    setDeletingId(photo.id);
    setMessage(null);

    try {
      await deleteTreePhoto(supabase, photo);
      setMessage({ type: 'success', text: 'Photo deleted.' });
      await fetchPhotos();
    } catch (err) {
      setMessage({ type: 'error', text: photosRlsHint(err.message) });
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <CircularProgress size={24} />;

  return (
    <Box>
      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Add Photo</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Upload from your phone or computer, or paste an image URL.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <Button
            variant="outlined"
            startIcon={<PhotoCameraIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
          >
            Choose Photo
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleFileChange}
          />
          {selectedFile && (
            <Button variant="text" onClick={clearSelectedFile} disabled={saving}>
              Clear selected file
            </Button>
          )}
        </Stack>

        {selectedFile && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Selected: {selectedFile.name}
            </Typography>
            {previewUrl && (
              <Box
                component="img"
                src={previewUrl}
                alt="Selected preview"
                sx={{ width: '100%', maxWidth: 320, height: 200, objectFit: 'cover', borderRadius: 1 }}
              />
            )}
          </Box>
        )}

        <TextField
          label="Photo URL (optional if uploading a file)"
          fullWidth
          margin="normal"
          value={form.photo_url}
          onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
          disabled={Boolean(selectedFile)}
          helperText={selectedFile ? 'URL is ignored while a file is selected.' : 'Use this for external image links.'}
        />
        <FormControl fullWidth margin="normal">
          <InputLabel>Type</InputLabel>
          <Select
            value={form.photo_type}
            label="Type"
            onChange={(e) => setForm({ ...form, photo_type: e.target.value })}
          >
            {Object.entries(PHOTO_TYPES).map(([key, label]) => (
              <MenuItem key={key} value={key}>{label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Description"
          fullWidth
          margin="normal"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <TextField
          label="Date"
          type="date"
          fullWidth
          margin="normal"
          InputLabelProps={{ shrink: true }}
          value={form.taken_at}
          onChange={(e) => setForm({ ...form, taken_at: e.target.value })}
        />
        <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
          <Button variant="contained" onClick={handleAdd} disabled={saving}>
            {saving ? 'Saving…' : '+ Add Photo'}
          </Button>
          <Button variant="text" onClick={resetForm} disabled={saving}>
            Clear
          </Button>
        </Stack>
      </Paper>

      <Grid container spacing={2}>
        {photos.map((photo) => (
          <Grid item xs={12} sm={6} md={4} key={photo.id}>
            <Paper sx={{ p: 2, position: 'relative' }} variant="outlined">
              <IconButton
                size="small"
                aria-label="Delete photo"
                onClick={() => handleDelete(photo)}
                disabled={deletingId === photo.id}
                sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper' }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
              {photo.photo_url && (
                <Box
                  component="img"
                  src={photo.photo_url}
                  alt={photo.description || 'Tree photo'}
                  sx={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 1, mb: 1 }}
                />
              )}
              <Typography variant="body2">{new Date(photo.taken_at).toLocaleDateString('en-IN')}</Typography>
              <Typography variant="body1">{PHOTO_TYPES[photo.photo_type] || photo.photo_type}</Typography>
              {photo.description && (
                <Typography variant="body2" color="text.secondary">{photo.description}</Typography>
              )}
            </Paper>
          </Grid>
        ))}
        {photos.length === 0 && (
          <Grid item xs={12}>
            <Typography color="text.secondary">No photos yet for this tree.</Typography>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}

export default PhotosTab;
