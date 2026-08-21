import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Button, FormControl, InputLabel, Select, MenuItem, Alert, Chip,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { formatDate, getTreeDisplayId } from '../../utils/formatters';
import PageHeader from '../../components/common/PageHeader';
import {
  buildOpenActionAlerts,
  getAlertNavigationPath,
  isSoilNutrientAlert,
  refreshSoilNutrientAlerts,
} from '../../utils/soilAlerts';

function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [message, setMessage] = useState(null);
  const [statusFilter, setStatusFilter] = useState('Open');

  const load = useCallback(async () => {
    const { data: soilObservations } = await supabase
      .from('soil_observations')
      .select('*, trees(tree_positions(position_code))')
      .order('observed_at', { ascending: false })
      .limit(500);

    await refreshSoilNutrientAlerts(supabase);

    let query = supabase
      .from('tree_alerts')
      .select('*, trees(tree_positions(position_code))')
      .order('alert_date', { ascending: false })
      .limit(100);

    if (statusFilter !== 'All') {
      query = query.eq('status', statusFilter);
    }

    const { data } = await query;

    if (statusFilter === 'Open') {
      setAlerts(buildOpenActionAlerts(data, soilObservations));
      return;
    }

    setAlerts(data || []);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, status) => {
    const payload = { status };
    if (status === 'Resolved') payload.resolved_at = new Date().toISOString();
    const { error } = await supabase.from('tree_alerts').update(payload).eq('id', id);
    if (error) setMessage({ type: 'error', text: error.message });
    else load();
  };

  return (
    <Box>
      <PageHeader
        section="Monitoring"
        title="Alerts"
        subtitle="Open issues across the orchard, including nutrients below required levels from soil sensors."
      />
      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <FormControl size="small" sx={{ minWidth: 160, mb: 2 }}>
        <InputLabel>Status</InputLabel>
        <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
          <MenuItem value="Open">Open</MenuItem>
          <MenuItem value="Investigating">Investigating</MenuItem>
          <MenuItem value="Resolved">Resolved</MenuItem>
          <MenuItem value="All">All</MenuItem>
        </Select>
      </FormControl>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell><TableCell>Tree</TableCell><TableCell>Type</TableCell>
              <TableCell>Severity</TableCell><TableCell>Reason</TableCell><TableCell>Status</TableCell><TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {alerts.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{formatDate(a.alert_date)}</TableCell>
                <TableCell>
                  <Typography component={RouterLink} to={getAlertNavigationPath(a)} sx={{ color: 'primary.main', textDecoration: 'none' }}>
                    {getTreeDisplayId(a.trees || {})}
                  </Typography>
                </TableCell>
                <TableCell>
                  {isSoilNutrientAlert(a) ? 'Nutrients Below Required' : a.alert_type}
                </TableCell>
                <TableCell><Chip label={a.severity || '—'} size="small" color={isSoilNutrientAlert(a) ? 'warning' : 'default'} /></TableCell>
                <TableCell>{a.reason}</TableCell>
                <TableCell>{a.status}</TableCell>
                <TableCell>
                  {!a.synthetic && a.status === 'Open' && (
                    <>
                      <Button size="small" onClick={() => updateStatus(a.id, 'Investigating')}>Investigate</Button>
                      <Button size="small" onClick={() => updateStatus(a.id, 'Resolved')}>Resolve</Button>
                    </>
                  )}
                  {a.synthetic && (
                    <Button size="small" component={RouterLink} to="/monitoring/soil">View in Soil</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {alerts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">No alerts for this filter.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

export default AlertsPage;
