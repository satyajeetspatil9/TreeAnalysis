import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Grid,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import {
  isMissingScheduleTable,
  scheduleTableHint,
  timeToInputValue,
  WEEKDAY_LABELS,
} from '../../utils/irrigationSchedule';

const DEFAULT_START = '06:00';
const DEFAULT_END = '14:00';

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
      .order('weekday');

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

    const byDay = new Map((data || []).map((r) => [r.weekday, r]));
    const merged = WEEKDAY_LABELS.map((label, weekday) => {
      const existing = byDay.get(weekday);
      return {
        id: existing?.id || null,
        weekday,
        label,
        enabled: existing ? existing.enabled : [1, 2, 3, 4].includes(weekday),
        start_time: timeToInputValue(existing?.start_time || DEFAULT_START),
        end_time: timeToInputValue(existing?.end_time || DEFAULT_END),
      };
    });
    setRows(merged);
    setMessage(null);
    setLoading(false);
  }, [farmId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateRow = (weekday, patch) => {
    setRows((prev) => prev.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));
  };

  const save = async () => {
    if (!farmId) return;
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

    const inserts = rows
      .filter((r) => r.enabled)
      .map((r) => ({
        farm_id: farmId,
        weekday: r.weekday,
        start_time: `${r.start_time}:00`,
        end_time: `${r.end_time}:00`,
        enabled: true,
        updated_at: new Date().toISOString(),
      }));

    if (inserts.length) {
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

  const applyWeekdaysPreset = () => {
    setRows((prev) => prev.map((r) => ({
      ...r,
      enabled: [1, 2, 3, 4].includes(r.weekday),
      start_time: DEFAULT_START,
      end_time: DEFAULT_END,
    })));
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
        Watering jobs only run inside these hours (farm timezone Asia/Kolkata).
        Example: Mon–Thu 06:00–14:00. Jobs pause when the window ends and continue the next allowed day until liters are done.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" onClick={applyWeekdaysPreset}>
          Preset Mon–Thu 6am–2pm
        </Button>
        <Button size="small" variant="contained" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save allowed hours'}
        </Button>
      </Box>

      <Grid container spacing={1.5}>
        {rows.map((row) => (
          <Grid item xs={12} sm={6} md={4} key={row.weekday}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <FormControlLabel
                control={(
                  <Switch
                    checked={row.enabled}
                    onChange={(e) => updateRow(row.weekday, { enabled: e.target.checked })}
                  />
                )}
                label={<Typography fontWeight={700}>{row.label}</Typography>}
              />
              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <TextField
                  size="small"
                  label="Start"
                  type="time"
                  value={row.start_time}
                  disabled={!row.enabled}
                  onChange={(e) => updateRow(row.weekday, { start_time: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
                <TextField
                  size="small"
                  label="End"
                  type="time"
                  value={row.end_time}
                  disabled={!row.enabled}
                  onChange={(e) => updateRow(row.weekday, { end_time: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

export default IrrigationAllowedHoursPanel;
