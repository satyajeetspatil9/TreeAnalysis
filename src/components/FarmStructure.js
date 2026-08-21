// src/components/FarmStructure.js
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Collapse,
  IconButton,
  TextField,
  Button,
  CircularProgress,
} from '@mui/material';
import { ExpandLess, ExpandMore, AddCircleOutline } from '@mui/icons-material';

function FarmStructure() {
  const [farms, setFarms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});
  const [newItemName, setNewItemName] = useState('');
  // State to track the selected parent for adding new items
  const [selectedFarm, setSelectedFarm] = useState(null);
  const [selectedPhase, setSelectedPhase] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: farmsData, error: farmsError } = await supabase
      .from('farms')
      .select(`
        *,
        phases (
          *,
          sections (
            *,
            rows (
              *,
              lots (*)
            )
          )
        )
      `);

    if (farmsError) {
      console.error('Error fetching farm structure:', farmsError);
    } else {
      setFarms(farmsData);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = (id) => {
    const [type, entityId] = id.split('-');
    const numericId = parseInt(entityId, 10);

    // Reset lower-level selections when a higher-level item is clicked
    if (type === 'farm') {
      setSelectedFarm(numericId);
      setSelectedPhase(null);
      setSelectedSection(null);
      setSelectedRow(null);
    } else if (type === 'phase') {
      setSelectedPhase(numericId);
    } // Add more for section, row if needed
    setOpen((prevOpen) => ({ ...prevOpen, [id]: !prevOpen[id] }));
  };

  const handleAddItem = async (table, parentIdColumn, parentId) => {
    if (!newItemName.trim()) return;

    const { data, error } = await supabase
      .from(table)
      .insert([{ name: newItemName, [parentIdColumn]: parentId }])
      .select();

    if (error) {
      alert(`Error adding item: ${error.message}`);
    } else {
      setNewItemName('');
      fetchData(); // Re-fetch all data to reflect the new structure
    }
  };

  const renderNestedList = (items, level, parentInfo) => {
    if (!items || items.length === 0) {
      return (
        <ListItem sx={{ pl: level * 2 }}>
          <ListItemText primary={`No ${parentInfo.child_type}s found.`} />
        </ListItem>
      );
    }

    return items.map((item) => (
      <React.Fragment key={item.id}>
        <ListItem button onClick={() => handleToggle(`${parentInfo.type}-${item.id}`)} sx={{ pl: level * 2 }}>
          <ListItemText primary={`${parentInfo.child_type}: ${item.name}`} />
          {open[`${parentInfo.type}-${item.id}`] ? <ExpandLess /> : <ExpandMore />}
        </ListItem>
        <Collapse in={open[`${parentInfo.type}-${item.id}`]} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {parentInfo.children && renderNestedList(item[parentInfo.children.name], level + 1, parentInfo.children)}
          </List>
        </Collapse>
      </React.Fragment>
    ));
  };

  if (loading) return <CircularProgress />;

  return (
    <Box sx={{ mt: 4, p: 2, border: '1px solid #ccc', borderRadius: '8px' }}>
      <Typography variant="h5" component="h2" gutterBottom>
        Farm Structure
      </Typography>
      <List>
        {farms.map((farm) => (
          <React.Fragment key={farm.id}>
            <ListItem button onClick={() => handleToggle(`farm-${farm.id}`)}>
              <ListItemText primary={`Farm: ${farm.name}`} secondary={`ID: ${farm.id}`} />
              {open[`farm-${farm.id}`] ? <ExpandLess /> : <ExpandMore />}
            </ListItem>
            <Collapse in={open[`farm-${farm.id}`]} timeout="auto" unmountOnExit>
              <List component="div" disablePadding>
                {renderNestedList(farm.phases, 2, {
                  type: 'farm',
                  child_type: 'Phase',
                  children: {
                    name: 'sections',
                    type: 'phase',
                    child_type: 'Section',
                    children: {
                      name: 'rows',
                      type: 'section',
                      child_type: 'Row',
                      children: {
                        name: 'lots',
                        type: 'row',
                        child_type: 'Lot',
                      },
                    },
                  },
                })}
              </List>
            </Collapse>
          </React.Fragment>
        ))}
      </List>
      <Box sx={{ mt: 2, p: 2, borderTop: '1px solid #eee' }}>
        <Typography variant="h6">Add New Structural Item</Typography>
        <TextField
          label="New Item Name (e.g., P3, S4, R12, L05)"
          fullWidth
          margin="normal"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
        />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2 }}>
          <Button
            variant="outlined"
            onClick={() => handleAddItem('farms', 'name', null)} // Special case for adding a new farm
            disabled={!newItemName.trim()}
          >
            Add as New Farm
          </Button>
          <Button
            variant="outlined"
            onClick={() => handleAddItem('phases', 'farm_id', selectedFarm)}
            disabled={!newItemName.trim() || !selectedFarm}
            title={!selectedFarm ? "Select a farm to add a phase" : ""}
          >
            Add Phase
          </Button>
          <Button
            variant="outlined"
            onClick={() => handleAddItem('sections', 'phase_id', selectedPhase)}
            disabled={!newItemName.trim() || !selectedPhase}
            title={!selectedPhase ? "Select a phase to add a section" : ""}
          >
            Add Section
          </Button>
          <Button
            variant="outlined"
            onClick={() => handleAddItem('rows', 'section_id', selectedSection)}
            disabled={true} // Simplified for now, would require deeper selection tracking
          >
            Add Row (Select Section)
          </Button>
        </Box>
        <Typography variant="caption" display="block" sx={{mt: 1}}>
            Note: Select a farm or phase from the list above to enable the 'Add' buttons.
        </Typography>
      </Box>
    </Box>
  );
}

export default FarmStructure;