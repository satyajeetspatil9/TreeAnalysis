import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Grid,
  IconButton,
  Paper,
  Switch,
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

function defaultSlot() {
  return { start_time: DEFAULT_START, end_time: DEFAULT_END };
}

function emptyDay(weekday, label, enabled = false) {
  return {
    weekday,
    label,
    enabled,
    slots: enabled ? [defaultSlot()] : [],
  };
}

function IrrigationAllowedHoursPanel({ farmId }) {
  const [days, setDays] = useState([]);
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
      setDays([]);
      setLoading(false);
      return;
    }

    const byDay = new Map();
    (data || []).forEach((row) => {
      const list = byDay.get(row.weekday) || [];
      list.push({
        start_time: timeToInputValue(row.start_time || DEFAULT_START),
        end_time: timeToInputValue(row.end_time || DEFAULT_END),
      });
      byDay.set(row.weekday, list);
    });

    const merged = WEEKDAY_LABELS.map((label, weekday) => {
      const slots = byDay.get(weekday) || [];
      return {
        weekday,
        label,
        enabled: slots.length > 0,
        slots: slots.length > 0 ? slots : [],
      };
    });
    setDays(merged);
    setMessage(null);
    setLoading(false);
  }, [farmId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleDay = (weekday, enabled) => {
    setDays((prev) => prev.map((d) => {
      if (d.weekday !== weekday) return d;
      if (!enabled) return { ...d, enabled: false, slots: [] };
      return {
        ...d,
        enabled: true,
        slots: d.slots.length ? d.slots : [defaultSlot()],
      };
    }));
  };

  const updateSlot = (weekday, index, patch) => {
    setDays((prev) => prev.map((d) => {
      if (d.weekday !== weekday) return d;
      const slots = d.slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot));
      return { ...d, slots };
    }));
  };

  const addSlot = (weekday) => {
    setDays((prev) => prev.map((d) => {
      if (d.weekday !== weekday) return d;
      return {
        ...d,
        enabled: true,
        slots: [...(d.slots.length ? d.slots : []), defaultSlot()],
      };
    }));
  };

  const removeSlot = (weekday, index) => {
    setDays((prev) => prev.map((d) => {
      if (d.weekday !== weekday) return d;
      const slots = d.slots.filter((_, i) => i !== index);
      return {
        ...d,
        slots,
        enabled: slots.length > 0,
      };
    }));
  };

  const validateSlots = () => {
    for (const day of days) {
      if (!day.enabled) continue;
      for (const slot of day.slots) {
        if (!slot.start_time || !slot.end_time) {
          return `${day.label}: each MSEB slot needs start and end.`;
        }
        if (slot.end_time <= slot.start_time) {
          return `${day.label}: end time must be after start (${slot.start_time}–${slot.end_time}). Overnight slots are not supported yet.`;
        }
      }
      const sorted = [...day.slots].sort((a, b) => a.start_time.localeCompare(b.start_time));
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i].start_time < sorted[i - 1].end_time) {
          return `${day.label}: MSEB slots overlap (${sorted[i - 1].start_time}–${sorted[i - 1].end_time} and ${sorted[i].start_time}–${sorted[i].end_time}).`;
        }
      }
    }
    return null;
  };

  const save = async () => {
    if (!farmId) return;
    const validationError = validateSlots();
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
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

    const inserts = [];
    days.forEach((day) => {
      if (!day.enabled) return;
      day.slots.forEach((slot) => {
        inserts.push({
          farm_id: farmId,
          weekday: day.weekday,
          start_time: `${slot.start_time}:00`,
          end_time: `${slot.end_time}:00`,
          enabled: true,
          updated_at: new Date().toISOString(),
        });
      });
    });

    if (inserts.length) {
      const { error } = await supabase.from('irrigation_allowed_windows').insert(inserts);
      if (error) {
        setMessage({ type: 'error', text: scheduleTableHint(error.message) });
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setMessage({ type: 'success', text: 'MSEB allowed hours saved.' });
    await load();
  };

  const applyWeekdaysPreset = () => {
    setDays(WEEKDAY_LABELS.map((label, weekday) => (
      [1, 2, 3, 4].includes(weekday)
        ? emptyDay(weekday, label, true)
        : emptyDay(weekday, label, false)
    )));
  };

  const applyTwoSlotPreset = () => {
    setDays(WEEKDAY_LABELS.map((label, weekday) => {
      if (![1, 2, 3, 4].includes(weekday)) return emptyDay(weekday, label, false);
      return {
        weekday,
        label,
        enabled: true,
        slots: [
          { start_time: '06:00', end_time: '10:00' },
          { start_time: '18:00', end_time: '22:00' },
        ],
      };
    }));
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
        These are MSEB electricity-available hours (farm timezone Asia/Kolkata).
        Add multiple slots per day when power comes in more than one window.
        Watering jobs only run inside these slots; they pause when power ends and continue in the next allowed slot until liters are done.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" onClick={applyWeekdaysPreset}>
          Preset Mon–Thu one slot (6–2)
        </Button>
        <Button size="small" variant="outlined" onClick={applyTwoSlotPreset}>
          Preset Mon–Thu two slots (6–10 & 6–10pm)
        </Button>
        <Button size="small" variant="contained" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save allowed hours'}
        </Button>
      </Box>

      <Grid container spacing={1.5}>
        {days.map((day) => (
          <Grid item xs={12} sm={6} md={6} lg={4} key={day.weekday}>
            <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={day.enabled}
                      onChange={(e) => toggleDay(day.weekday, e.target.checked)}
                    />
                  )}
                  label={<Typography fontWeight={700}>{day.label}</Typography>}
                />
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => addSlot(day.weekday)}
                >
                  Add slot
                </Button>
              </Box>

              {!day.enabled && (
                <Typography variant="caption" color="text.secondary">
                  No MSEB power window this day
                </Typography>
              )}

              {day.enabled && day.slots.map((slot, index) => (
                <Box key={`${day.weekday}-${index}`} sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
                  <TextField
                    size="small"
                    label={`Slot ${index + 1} start`}
                    type="time"
                    value={slot.start_time}
                    onChange={(e) => updateSlot(day.weekday, index, { start_time: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  />
                  <TextField
                    size="small"
                    label="End"
                    type="time"
                    value={slot.end_time}
                    onChange={(e) => updateSlot(day.weekday, index, { end_time: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  />
                  <IconButton
                    aria-label="Remove slot"
                    size="small"
                    disabled={day.slots.length <= 1}
                    onClick={() => removeSlot(day.weekday, index)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}

              {day.enabled && (
                <Button
                  size="small"
                  sx={{ mt: 1 }}
                  startIcon={<AddIcon />}
                  onClick={() => addSlot(day.weekday)}
                >
                  Another MSEB timing
                </Button>
              )}
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

export default IrrigationAllowedHoursPanel;
