import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { supabase } from '../../supabaseClient';
import {
  isMissingScheduleTable,
  scheduleTableHint,
  timeToInputValue,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

const DEFAULT_START = '06:00';
const DEFAULT_END = '14:00';

/** Flat list of power slots: { key, weekday, start_time, end_time } */
function rowsFromWindows(data) {
  return (data || []).map((row, idx) => ({
    key: `${row.id || 'n'}-${idx}`,
    weekday: Number(row.weekday),
    start_time: timeToInputValue(row.start_time || DEFAULT_START),
    end_time: timeToInputValue(row.end_time || DEFAULT_END),
  }));
}

function IrrigationAllowedHoursPanel({ farmId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('irrigation_allowed_windows')
      .select('*')
      .eq('farm_id', farmId)
      .order('weekday')
      .order('start_time');

    if (error) {
      setMessage({
        type: isMissingScheduleTable(error) ? 'warning' : 'error',
        text: isMissingScheduleTable(error)
          ? 'Run migration 039_irrigation_schedule_control.sql in Supabase, then reload.'
          : scheduleTableHint(error.message),
      });
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(rowsFromWindows(data));
    setMessage(null);
    setLoading(false);
  }, [farmId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateRow = (key, patch) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        weekday: 1,
        start_time: DEFAULT_START,
        end_time: DEFAULT_END,
      },
    ]);
  };

  const removeRow = (key) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const applyMonThu = () => {
    setRows([1, 2, 3, 4].map((weekday) => ({
      key: `preset-${weekday}`,
      weekday,
      start_time: DEFAULT_START,
      end_time: DEFAULT_END,
    })));
  };

  const save = async () => {
    if (!farmId) return;

    for (const row of rows) {
      if (!row.start_time || !row.end_time) {
        setMessage({ type: 'error', text: 'Each row needs start and end time.' });
        return;
      }
      if (row.end_time <= row.start_time) {
        setMessage({
          type: 'error',
          text: `${WEEKDAY_LABELS[row.weekday]}: end must be after start.`,
        });
        return;
      }
    }

    setSaving(true);
    setMessage(null);

    const { error: delError } = await supabase
      .from('irrigation_allowed_windows')
      .delete()
      .eq('farm_id', farmId);

    if (delError) {
      setMessage({
        type: isMissingScheduleTable(delError) ? 'warning' : 'error',
        text: scheduleTableHint(delError.message),
      });
      setSaving(false);
      return;
    }

    if (rows.length) {
      const inserts = rows.map((r) => ({
        farm_id: farmId,
        weekday: r.weekday,
        start_time: `${r.start_time}:00`,
        end_time: `${r.end_time}:00`,
        enabled: true,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('irrigation_allowed_windows').insert(inserts);
      if (error) {
        setMessage({ type: 'error', text: scheduleTableHint(error.message) });
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setMessage({ type: 'success', text: 'Allowed hours saved.' });
    await load();
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Times when farm power is on. Programs only water during these hours.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" onClick={applyMonThu}>
          Mon–Thu 6am–2pm
        </Button>
        <Button size="small" startIcon={<AddIcon />} onClick={addRow}>
          Add time
        </Button>
        <Button size="small" variant="contained" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Box>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Day</TableCell>
              <TableCell>From</TableCell>
              <TableCell>To</TableCell>
              <TableCell align="right" width={56} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No times set. Tap “Add time” or use Mon–Thu 6am–2pm.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <TextField
                    select
                    size="small"
                    value={row.weekday}
                    onChange={(e) => updateRow(row.key, { weekday: Number(e.target.value) })}
                    SelectProps={{ native: true }}
                    sx={{ minWidth: 88 }}
                  >
                    {WEEKDAY_LABELS.map((label, day) => (
                      <option key={label} value={day}>{label}</option>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="time"
                    value={row.start_time}
                    onChange={(e) => updateRow(row.key, { start_time: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="time"
                    value={row.end_time}
                    onChange={(e) => updateRow(row.key, { end_time: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => removeRow(row.key)} aria-label="Remove">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        Need two power slots on the same day? Add two rows for that day.
      </Typography>
    </Box>
  );
}

export default IrrigationAllowedHoursPanel;
