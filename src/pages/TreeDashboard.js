import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Typography, Tabs, Tab, Paper, CircularProgress, Alert, Button, Chip,
} from '@mui/material';
import { supabase } from '../supabaseClient';
import { getTreeDisplayId, formatDate } from '../utils/formatters';
import { fetchTreeByPositionCode, getIrrigationZoneCode } from '../utils/schema';
import HealthIndicator from '../components/common/HealthIndicator';
import ReplaceTreeDialog from '../components/trees/ReplaceTreeDialog';
import OverviewTab from '../components/tree-dashboard/OverviewTab';
import SoilTab from '../components/tree-dashboard/SoilTab';
import IrrigationTab from '../components/tree-dashboard/IrrigationTab';
import FertilizerTab from '../components/tree-dashboard/FertilizerTab';
import DiseaseTab from '../components/tree-dashboard/DiseaseTab';
import PhotosTab from '../components/tree-dashboard/PhotosTab';
import GrowthTab from '../components/tree-dashboard/GrowthTab';
import CostTab from '../components/tree-dashboard/CostTab';
import YieldTab from '../components/tree-dashboard/YieldTab';
import HistoryTab from '../components/tree-dashboard/HistoryTab';

const TAB_LABELS = [
  'Overview', 'Soil', 'Irrigation', 'Fertilizer',
  'Disease', 'Photos', 'Growth', 'Cost', 'Yield', 'History',
];

function TreeDashboard() {
  const { treeId } = useParams();
  const [tab, setTab] = useState(0);
  const [tree, setTree] = useState(null);
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showReplace, setShowReplace] = useState(false);

  const fetchTree = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTreeByPositionCode(supabase, treeId);
      if (!data) throw new Error(`No tree found at position ${treeId}`);

      setInstances(data.all_instances || []);
      setTree(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
  }, [treeId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !tree) {
    return <Alert severity="error">{error || 'Tree not found'}</Alert>;
  }

  const zoneCode = getIrrigationZoneCode(tree);
  const hasActiveInstance = instances.some((t) => t.status === 'Active');
  const showPlantButton = !hasActiveInstance;

  const tabComponents = [
    <OverviewTab key="overview" tree={tree} zoneCode={zoneCode} />,
    <SoilTab key="soil" tree={tree} />,
    <IrrigationTab key="irrigation" tree={tree} zoneCode={zoneCode} />,
    <FertilizerTab key="fertilizer" tree={tree} zoneCode={zoneCode} />,
    <DiseaseTab key="disease" tree={tree} onUpdate={fetchTree} />,
    <PhotosTab key="photos" tree={tree} />,
    <GrowthTab key="growth" tree={tree} />,
    <CostTab key="cost" tree={tree} />,
    <YieldTab key="yield" tree={tree} />,
    <HistoryTab key="history" tree={tree} instances={instances} />,
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>{getTreeDisplayId(tree)}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            <Chip label={`🌱 ${tree.variety || 'Unknown'}`} size="small" />
            <Chip label={`📅 ${formatDate(tree.planting_date)}`} size="small" />
            <Chip label={`💧 Zone ${zoneCode}`} size="small" />
            <Chip label={`Gen ${instances.length}`} size="small" variant="outlined" />
            <HealthIndicator tree={tree} showLabel />
          </Box>
        </Box>
        {showPlantButton && (
          <Button variant="contained" onClick={() => setShowReplace(true)}>
            Plant New Tree
          </Button>
        )}
      </Box>

      {!hasActiveInstance && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No active tree at this position. Showing the latest instance. Plant a new tree to resume live tracking.
        </Alert>
      )}

      <Paper sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
          {TAB_LABELS.map((label) => (<Tab key={label} label={label} />))}
        </Tabs>
      </Paper>

      <Box>{tabComponents[tab]}</Box>

      {showReplace && (
        <ReplaceTreeDialog
          oldTree={tree}
          open={showReplace}
          onClose={() => setShowReplace(false)}
          onSuccess={() => { setShowReplace(false); fetchTree(); }}
        />
      )}
    </Box>
  );
}

export default TreeDashboard;
