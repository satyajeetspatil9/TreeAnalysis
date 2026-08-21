import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Grid, CircularProgress, Alert,
  TextField, Button, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, DialogContentText, FormControl, InputLabel, Select, MenuItem,
  List, ListItem, ListItemText, Divider,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useFarm } from '../../hooks/useFarm';
import PageHeader from '../../components/common/PageHeader';
import { formatDate, getTreeDisplayId } from '../../utils/formatters';

function rlsHint(message) {
  if (!message?.includes('row-level security')) return message;
  return `${message} Open Settings → Save Farm to link the farm to your account, then run migration 008_fix_irrigation_rls.sql in Supabase SQL Editor.`;
}

const emptyForm = { zone_code: '', description: '', flow_rate_lph: '' };
const today = () => new Date().toISOString().slice(0, 10);

async function getZoneUsage(zoneId) {
  const [activeRes, historyRes, eventsRes, fertRes] = await Promise.all([
    supabase
      .from('tree_irrigation_zones')
      .select('*', { count: 'exact', head: true })
      .eq('zone_id', zoneId)
      .is('end_date', null),
    supabase
      .from('tree_irrigation_zones')
      .select('*', { count: 'exact', head: true })
      .eq('zone_id', zoneId),
    supabase
      .from('irrigation_events')
      .select('*', { count: 'exact', head: true })
      .eq('zone_id', zoneId),
    supabase
      .from('fertigation_events')
      .select('*', { count: 'exact', head: true })
      .eq('zone_id', zoneId),
  ]);

  return {
    activeTrees: activeRes.count || 0,
    assignmentHistory: historyRes.count || 0,
    irrigationEvents: eventsRes.count || 0,
    fertigationEvents: fertRes.count || 0,
  };
}

function IrrigationZonesPage() {
  const { user } = useAuth();
  const { farm } = useFarm();
  const [zones, setZones] = useState([]);
  const [activeTrees, setActiveTrees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editingZone, setEditingZone] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [deletingZone, setDeletingZone] = useState(null);
  const [deleteUsage, setDeleteUsage] = useState(null);
  const [managingZone, setManagingZone] = useState(null);
  const [assignedTrees, setAssignedTrees] = useState([]);
  const [assignForm, setAssignForm] = useState({ tree_id: '', start_date: today() });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    if (!farm) {
      setZones([]);
      setActiveTrees([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const [{ data, error: fetchError }, { data: treesData }] = await Promise.all([
      supabase
        .from('irrigation_zones')
        .select('*')
        .eq('farm_id', farm.id)
        .order('zone_code'),
      supabase
        .from('trees')
        .select('id, tree_positions(position_code)')
        .eq('status', 'Active'),
    ]);

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const sortedTrees = (treesData || []).sort((a, b) =>
      getTreeDisplayId(a).localeCompare(getTreeDisplayId(b))
    );
    setActiveTrees(sortedTrees);

    const withCounts = await Promise.all(
      (data || []).map(async (zone) => {
        const usage = await getZoneUsage(zone.id);
        return { ...zone, ...usage, treeCount: usage.activeTrees };
      })
    );
    setZones(withCounts);
    setLoading(false);
  }, [farm]);

  const loadAssignedTrees = useCallback(async (zoneId) => {
    const { data } = await supabase
      .from('tree_irrigation_zones')
      .select('id, start_date, trees(id, tree_positions(position_code))')
      .eq('zone_id', zoneId)
      .is('end_date', null)
      .order('start_date', { ascending: false });

    setAssignedTrees(
      (data || []).sort((a, b) =>
        getTreeDisplayId(a.trees).localeCompare(getTreeDisplayId(b.trees))
      )
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (zone) => {
    setEditingZone(zone);
    setEditForm({
      zone_code: zone.zone_code || '',
      description: zone.description || '',
      flow_rate_lph: zone.flow_rate_lph ?? '',
    });
  };

  const closeEdit = () => {
    setEditingZone(null);
    setEditForm(emptyForm);
  };

  const openManage = async (zone) => {
    setManagingZone(zone);
    setAssignForm({ tree_id: '', start_date: today() });
    await loadAssignedTrees(zone.id);
  };

  const closeManage = () => {
    setManagingZone(null);
    setAssignedTrees([]);
    setAssignForm({ tree_id: '', start_date: today() });
  };

  const openDelete = async (zone) => {
    setDeletingZone(zone);
    setDeleteUsage(await getZoneUsage(zone.id));
  };

  const closeDelete = () => {
    setDeletingZone(null);
    setDeleteUsage(null);
  };

  const canDeleteZone = (usage) => {
    if (!usage) return false;
    if (usage.activeTrees > 0) return false;
    if (usage.assignmentHistory > 0) return false;
    if (usage.irrigationEvents > 0) return false;
    if (usage.fertigationEvents > 0) return false;
    return true;
  };

  const deleteBlockReason = (usage) => {
    if (!usage) return 'Unable to check zone usage.';
    if (usage.activeTrees > 0) {
      return `${usage.activeTrees} tree(s) are still assigned. Remove them from this zone first (Manage trees), or move them to another zone.`;
    }
    if (usage.assignmentHistory > 0) {
      return 'This zone has past tree assignments. Deletion is blocked to preserve history.';
    }
    if (usage.irrigationEvents > 0 || usage.fertigationEvents > 0) {
      return 'This zone has irrigation or fertigation events recorded against it.';
    }
    return null;
  };

  const handleAdd = async () => {
    if (!farm) {
      setMessage({ type: 'error', text: 'Create a farm in Settings first.' });
      return;
    }
    if (!user) {
      setMessage({ type: 'error', text: 'Sign in again — your session may have expired.' });
      return;
    }
    if (!form.zone_code.trim()) {
      setMessage({ type: 'error', text: 'Zone code is required (e.g. IZ-01).' });
      return;
    }

    const { data: farmRow, error: farmError } = await supabase
      .from('farms')
      .select('user_id')
      .eq('id', farm.id)
      .maybeSingle();

    if (farmError) {
      setMessage({ type: 'error', text: rlsHint(farmError.message) });
      return;
    }
    if (!farmRow || farmRow.user_id !== user.id) {
      setMessage({
        type: 'error',
        text: 'This farm is not linked to your account. Open Settings and click Save Farm, then try again.',
      });
      return;
    }

    const { error: insertError } = await supabase.from('irrigation_zones').insert([{
      farm_id: farm.id,
      zone_code: form.zone_code.trim().toUpperCase(),
      description: form.description.trim() || null,
      flow_rate_lph: form.flow_rate_lph ? Number(form.flow_rate_lph) : null,
    }]);

    if (insertError) {
      setMessage({ type: 'error', text: rlsHint(insertError.message) });
      return;
    }

    setMessage({ type: 'success', text: `Zone ${form.zone_code.trim().toUpperCase()} created.` });
    setForm(emptyForm);
    load();
  };

  const handleSaveEdit = async () => {
    if (!editingZone || !editForm.zone_code.trim()) return;

    setSaving(true);
    setMessage(null);

    const { error: updateError } = await supabase
      .from('irrigation_zones')
      .update({
        zone_code: editForm.zone_code.trim().toUpperCase(),
        description: editForm.description.trim() || null,
        flow_rate_lph: editForm.flow_rate_lph !== '' ? Number(editForm.flow_rate_lph) : null,
      })
      .eq('id', editingZone.id);

    setSaving(false);

    if (updateError) {
      setMessage({ type: 'error', text: rlsHint(updateError.message) });
      return;
    }

    setMessage({ type: 'success', text: `Zone ${editForm.zone_code.trim().toUpperCase()} updated.` });
    closeEdit();
    load();
  };

  const handleAssignTree = async () => {
    if (!managingZone || !assignForm.tree_id) return;

    setAssigning(true);
    setMessage(null);

    const { error: closeError } = await supabase
      .from('tree_irrigation_zones')
      .update({ end_date: assignForm.start_date })
      .eq('tree_id', assignForm.tree_id)
      .is('end_date', null);

    if (closeError) {
      setAssigning(false);
      setMessage({ type: 'error', text: rlsHint(closeError.message) });
      return;
    }

    const { error: insertError } = await supabase.from('tree_irrigation_zones').insert([{
      tree_id: assignForm.tree_id,
      zone_id: managingZone.id,
      start_date: assignForm.start_date,
    }]);

    setAssigning(false);

    if (insertError) {
      setMessage({ type: 'error', text: rlsHint(insertError.message) });
      return;
    }

    setMessage({
      type: 'success',
      text: `Tree assigned to ${managingZone.zone_code}. Any previous zone assignment ended on ${formatDate(assignForm.start_date)}.`,
    });
    setAssignForm({ tree_id: '', start_date: today() });
    await loadAssignedTrees(managingZone.id);
    load();
  };

  const handleRemoveTree = async (linkId, treeLabel) => {
    if (!managingZone) return;

    const endDate = today();
    const { error: removeError } = await supabase
      .from('tree_irrigation_zones')
      .update({ end_date: endDate })
      .eq('id', linkId);

    if (removeError) {
      setMessage({ type: 'error', text: rlsHint(removeError.message) });
      return;
    }

    setMessage({ type: 'success', text: `${treeLabel} removed from ${managingZone.zone_code}.` });
    await loadAssignedTrees(managingZone.id);
    load();
  };

  const handleDelete = async () => {
    if (!deletingZone || !canDeleteZone(deleteUsage)) return;

    setDeleting(true);
    setMessage(null);

    const { error: deleteError } = await supabase
      .from('irrigation_zones')
      .delete()
      .eq('id', deletingZone.id);

    setDeleting(false);

    if (deleteError) {
      setMessage({ type: 'error', text: rlsHint(deleteError.message) });
      return;
    }

    setMessage({ type: 'success', text: `Zone ${deletingZone.zone_code} deleted.` });
    if (editingZone?.id === deletingZone.id) closeEdit();
    if (managingZone?.id === deletingZone.id) closeManage();
    closeDelete();
    load();
  };

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      <PageHeader
        section="Irrigation"
        title="Irrigation Zones"
        subtitle="Create zones, assign trees, edit details, or delete unused zones — all in one place."
      />

      {!farm && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Create your farm in Settings before adding irrigation zones.
        </Alert>
      )}

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Add irrigation zone</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField
              label="Zone code"
              fullWidth
              required
              value={form.zone_code}
              onChange={(e) => setForm({ ...form, zone_code: e.target.value })}
              placeholder="IZ-A-01"
              disabled={!farm}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Description"
              fullWidth
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Block A, R01–R08 drip line"
              disabled={!farm}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Flow rate (L/hr)"
              type="number"
              fullWidth
              value={form.flow_rate_lph}
              onChange={(e) => setForm({ ...form, flow_rate_lph: e.target.value })}
              disabled={!farm}
            />
          </Grid>
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={handleAdd} disabled={!farm || !form.zone_code.trim()}>
          Add zone
        </Button>
      </Paper>

      {zones.length === 0 ? (
        <Alert severity="info">No irrigation zones yet. Add one above.</Alert>
      ) : (
        <Grid container spacing={2}>
          {zones.map((zone) => (
            <Grid item xs={12} sm={6} md={4} key={zone.id}>
              <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Typography variant="h6">{zone.zone_code}</Typography>
                  <Box>
                    <IconButton size="small" onClick={() => openEdit(zone)} aria-label={`Edit ${zone.zone_code}`}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => openDelete(zone)}
                      aria-label={`Delete ${zone.zone_code}`}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {zone.description || 'No description'}
                </Typography>
                <Typography variant="body2">{zone.treeCount} trees assigned</Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  Flow: {zone.flow_rate_lph ? `${zone.flow_rate_lph} L/hr` : '—'}
                </Typography>
                <Button size="small" variant="contained" onClick={() => openManage(zone)} sx={{ mt: 'auto' }}>
                  Manage trees
                </Button>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={!!managingZone} onClose={closeManage} maxWidth="sm" fullWidth>
        <DialogTitle>Trees in {managingZone?.zone_code}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Assign a tree to this zone. If it already belongs to another zone, the old assignment ends on the start date you pick.
          </Typography>

          {assignedTrees.length === 0 ? (
            <Alert severity="info" sx={{ mb: 2 }}>No trees assigned to this zone yet.</Alert>
          ) : (
            <>
              <Typography variant="subtitle2" gutterBottom>Currently assigned</Typography>
              <List dense disablePadding sx={{ mb: 2 }}>
                {assignedTrees.map((link) => {
                  const label = getTreeDisplayId(link.trees);
                  return (
                    <ListItem
                      key={link.id}
                      secondaryAction={(
                        <Button size="small" color="warning" onClick={() => handleRemoveTree(link.id, label)}>
                          Remove
                        </Button>
                      )}
                      sx={{ px: 0 }}
                    >
                      <ListItemText
                        primary={(
                          <Typography
                            component={RouterLink}
                            to={`/tree/${label}`}
                            sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}
                          >
                            {label}
                          </Typography>
                        )}
                        secondary={`Since ${formatDate(link.start_date)}`}
                      />
                    </ListItem>
                  );
                })}
              </List>
              <Divider sx={{ mb: 2 }} />
            </>
          )}

          <Typography variant="subtitle2" gutterBottom>Add or move a tree</Typography>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <FormControl fullWidth required>
                <InputLabel>Tree</InputLabel>
                <Select
                  value={assignForm.tree_id}
                  label="Tree"
                  onChange={(e) => setAssignForm({ ...assignForm, tree_id: e.target.value })}
                >
                  {activeTrees.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{getTreeDisplayId(t)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Start date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={assignForm.start_date}
                onChange={(e) => setAssignForm({ ...assignForm, start_date: e.target.value })}
                helperText="Date this zone starts watering the tree"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeManage}>Close</Button>
          <Button
            variant="contained"
            onClick={handleAssignTree}
            disabled={assigning || !assignForm.tree_id}
          >
            {assigning ? 'Assigning…' : 'Assign to zone'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editingZone} onClose={closeEdit} maxWidth="sm" fullWidth>
        <DialogTitle>Edit irrigation zone</DialogTitle>
        <DialogContent>
          <TextField
            label="Zone code"
            fullWidth
            required
            margin="normal"
            value={editForm.zone_code}
            onChange={(e) => setEditForm({ ...editForm, zone_code: e.target.value })}
          />
          <TextField
            label="Description"
            fullWidth
            margin="normal"
            value={editForm.description}
            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
          />
          <TextField
            label="Flow rate (L/hr)"
            type="number"
            fullWidth
            margin="normal"
            value={editForm.flow_rate_lph}
            onChange={(e) => setEditForm({ ...editForm, flow_rate_lph: e.target.value })}
          />
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          <Box>
            <Button color="error" onClick={() => editingZone && openDelete(editingZone)} sx={{ mr: 1 }}>
              Delete zone
            </Button>
            <Button onClick={() => editingZone && openManage(editingZone)}>
              Manage trees
            </Button>
          </Box>
          <Box>
            <Button onClick={closeEdit} sx={{ mr: 1 }}>Cancel</Button>
            <Button variant="contained" onClick={handleSaveEdit} disabled={saving || !editForm.zone_code.trim()}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deletingZone} onClose={closeDelete} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {deletingZone?.zone_code}?</DialogTitle>
        <DialogContent>
          {deleteBlockReason(deleteUsage) ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {deleteBlockReason(deleteUsage)}
            </Alert>
          ) : (
            <DialogContentText sx={{ mt: 1 }}>
              This permanently removes the irrigation zone. This cannot be undone.
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDelete}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disabled={deleting || !canDeleteZone(deleteUsage)}
          >
            {deleting ? 'Deleting…' : 'Delete zone'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default IrrigationZonesPage;
