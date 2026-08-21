import React, { useEffect, useState } from 'react';
import {
  Paper, Typography, List, ListItem, ListItemText, CircularProgress, Box, Chip,
} from '@mui/material';
import { supabase } from '../../supabaseClient';
import { formatDate, getTreeDisplayId } from '../../utils/formatters';

function HistoryTab({ tree, instances = [] }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      const timeline = [];

      (instances.length ? instances : [tree]).forEach((inst) => {
        timeline.push({
          date: inst.planting_date,
          text: `Instance planted — ${inst.variety} (${inst.status})`,
          kind: 'instance',
        });
        if (inst.removed_date) {
          timeline.push({
            date: inst.removed_date,
            text: `Instance ended — ${inst.status}`,
            kind: 'removed',
          });
        }
      });

      const { data: replacements } = await supabase
        .from('tree_replacements')
        .select('*')
        .or(`old_tree_id.eq.${tree.id},new_tree_id.eq.${tree.id},position_id.eq.${tree.position_id || tree.tree_positions?.id}`)
        .order('replacement_date', { ascending: false });

      (replacements || []).forEach((r) => {
        timeline.push({
          date: r.replacement_date,
          text: `Replacement — ${r.reason || 'New generation planted'}`,
          kind: 'replacement',
        });
      });

      const { data: growth } = await supabase
        .from('tree_growth')
        .select('measurement_date, height_cm')
        .eq('tree_id', tree.id)
        .order('measurement_date', { ascending: false })
        .limit(5);

      (growth || []).forEach((g) => {
        timeline.push({ date: g.measurement_date, text: `Growth — ${g.height_cm} cm`, kind: 'growth' });
      });

      const { data: disease } = await supabase
        .from('disease_observations')
        .select('observed_at, problem_type, result')
        .eq('tree_id', tree.id)
        .order('observed_at', { ascending: false })
        .limit(5);

      (disease || []).forEach((d) => {
        timeline.push({
          date: d.observed_at,
          text: `${d.problem_type}${d.result ? ` — ${d.result}` : ''}`,
          kind: 'disease',
        });
      });

      timeline.sort((a, b) => new Date(b.date) - new Date(a.date));
      setEvents(timeline);
      setLoading(false);
    }

    loadHistory();
  }, [tree, instances]);

  if (loading) return <CircularProgress size={24} />;

  return (
    <Box>
      <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
        <Typography variant="h6" gutterBottom>
          Generations at {getTreeDisplayId(tree)}
        </Typography>
        <List dense>
          {(instances.length ? instances : [tree])
            .sort((a, b) => new Date(a.planting_date) - new Date(b.planting_date))
            .map((inst) => (
              <ListItem key={inst.id}>
                <ListItemText
                  primary={`${inst.variety || 'Unknown'} — ${inst.status}`}
                  secondary={`${formatDate(inst.planting_date)} → ${inst.removed_date ? formatDate(inst.removed_date) : 'present'}`}
                />
                {inst.id === tree.id && <Chip label="Viewing" size="small" color="primary" />}
              </ListItem>
            ))}
        </List>
      </Paper>

      <Paper sx={{ p: 2 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Timeline</Typography>
        <List dense>
          {events.map((event, idx) => (
            <ListItem key={idx}>
              <ListItemText primary={formatDate(event.date)} secondary={event.text} />
            </ListItem>
          ))}
          {events.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 2 }}>No history events yet.</Typography>
          )}
        </List>
      </Paper>
    </Box>
  );
}

export default HistoryTab;
