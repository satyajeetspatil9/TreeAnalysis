import React, { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Grid, Paper, Typography, List, ListItem, ListItemText, Chip,
  CircularProgress, Alert, Button,
} from '@mui/material';
import ForestIcon from '@mui/icons-material/Forest';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PaidIcon from '@mui/icons-material/Paid';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { supabase } from '../supabaseClient';
import { formatCurrency, getTreeDisplayId } from '../utils/formatters';
import { deriveHealthStatus } from '../utils/healthStatus';
import { buildTreeNutrientDeficiencyReport } from '../utils/soil';
import {
  buildOpenActionAlerts,
  getAlertNavigationPath,
  isSoilNutrientAlert,
  refreshSoilNutrientAlerts,
} from '../utils/soilAlerts';
import {
  loadFarmExpenses,
  loadFarmLabourEvents,
  loadFarmTrees,
  loadFarmZoneIds,
} from '../utils/farmScope';
import PageHeader from '../components/common/PageHeader';
import StatCard from '../components/common/StatCard';
import ProductionCockpit from '../components/farm-climate/ProductionCockpit';
import { quickActions } from '../layout/navConfig';
import { useFarm } from '../hooks/useFarm';
import { useAuth } from '../contexts/AuthContext';
import { authErrorMessage, isJwtClockSkewError } from '../utils/authErrors';

function FarmDashboard() {
  const { farm } = useFarm();
  const { signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    totalTrees: 0, healthy: 0, watch: 0, attention: 0,
    openAlerts: 0, monthlyFertilizerCost: 0, yearlyCost: 0,
  });
  const [alerts, setAlerts] = useState([]);
  const [nutrientDeficiencyCount, setNutrientDeficiencyCount] = useState(0);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      setError(null);

      if (!farm?.id) {
        setStats({
          totalTrees: 0, healthy: 0, watch: 0, attention: 0,
          openAlerts: 0, monthlyFertilizerCost: 0, yearlyCost: 0,
        });
        setAlerts([]);
        setNutrientDeficiencyCount(0);
        setLoading(false);
        return;
      }

      try {
        const trees = await loadFarmTrees(supabase, farm.id, {
          select: 'id, status, tree_positions(position_code)',
        });
        const treeIds = trees.map((t) => t.id);
        const zoneIds = await loadFarmZoneIds(supabase, farm.id);

        const healthCounts = { healthy: 0, watch: 0, attention: 0 };
        let soilObservations = [];
        if (treeIds.length) {
          const { data } = await supabase
            .from('soil_observations')
            .select('*, trees(tree_positions(position_code))')
            .in('tree_id', treeIds)
            .order('observed_at', { ascending: false })
            .limit(500);
          soilObservations = data || [];
        }

        await refreshSoilNutrientAlerts(supabase);

        const nutrientDeficiencyRows = buildTreeNutrientDeficiencyReport(soilObservations);
        setNutrientDeficiencyCount(nutrientDeficiencyRows.length);

        let alertData = [];
        if (treeIds.length) {
          const { data } = await supabase
            .from('tree_alerts')
            .select('*, trees(tree_positions(position_code))')
            .eq('status', 'Open')
            .in('tree_id', treeIds)
            .order('alert_date', { ascending: false })
            .limit(50);
          alertData = data || [];
        }

        const actionAlerts = buildOpenActionAlerts(alertData, soilObservations);
        const alertCountByTree = {};
        actionAlerts.forEach((alert) => {
          if (!alert.tree_id) return;
          alertCountByTree[alert.tree_id] = (alertCountByTree[alert.tree_id] || 0) + 1;
        });
        trees.forEach((tree) => {
          healthCounts[deriveHealthStatus(tree, alertCountByTree[tree.id] || 0)] += 1;
        });

        let monthlyFertilizerCost = 0;
        let yearlyCost = 0;
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

        const expenses = await loadFarmExpenses(supabase, farm.id, {
          zoneIds,
          treeIds,
          sinceDate: yearStart,
          select: 'id, amount, category, expense_date, notes',
        });
        const labour = await loadFarmLabourEvents(supabase, { zoneIds, treeIds, limit: 200 });
        const yearLabour = labour.filter((row) => row.event_date >= yearStart);

        expenses.forEach((exp) => {
          yearlyCost += Number(exp.amount) || 0;
          if (exp.expense_date >= monthStart && exp.category === 'Fertilizer') {
            monthlyFertilizerCost += Number(exp.amount) || 0;
          }
        });
        yearLabour.forEach((row) => {
          yearlyCost += Number(row.amount) || 0;
        });

        setStats({
          totalTrees: trees.length,
          ...healthCounts,
          openAlerts: actionAlerts.length,
          monthlyFertilizerCost,
          yearlyCost,
        });
        setAlerts(actionAlerts);
      } catch (err) {
        if (isJwtClockSkewError(err.message)) {
          await supabase.auth.signOut();
        }
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [farm?.id]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    const authErr = authErrorMessage(error);
    return (
      <Alert
        severity="error"
        action={
          authErr.recoverable ? (
            <Button color="inherit" size="small" onClick={signOut}>
              Sign out
            </Button>
          ) : undefined
        }
      >
        <Typography variant="subtitle2" fontWeight={600}>{authErr.title}</Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {authErr.detail}
        </Typography>
      </Alert>
    );
  }

  return (
    <Box>
      <PageHeader
        section="Orchard"
        title={farm?.name ? farm.name : 'My Orchard'}
        subtitle="Your farm at a glance — tree health, costs, and what needs attention today."
      />
      <ProductionCockpit />

      {nutrientDeficiencyCount > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          action={(
            <Button component={RouterLink} to="/monitoring/soil" color="inherit" size="small">
              View in Soil
            </Button>
          )}
        >
          {nutrientDeficiencyCount} tree{nutrientDeficiencyCount === 1 ? '' : 's'} ha
          {nutrientDeficiencyCount === 1 ? 's' : 've'} nutrients below required levels.
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
        {quickActions.map((action) => {
          const ActionIcon = action.icon;
          return (
            <Button
              key={action.path}
              component={RouterLink}
              to={action.path}
              variant="outlined"
              size="small"
              startIcon={<ActionIcon />}
            >
              {action.label}
            </Button>
          );
        })}
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <StatCard title="Active Trees" value={stats.totalTrees} icon={<ForestIcon />} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard title="Healthy" value={stats.healthy} color="success.main" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard title="Watch" value={stats.watch} color="warning.main" icon={<WarningAmberIcon />} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard title="Attention" value={stats.attention} color="error.main" />
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <StatCard title="Fertilizer This Month" value={formatCurrency(stats.monthlyFertilizerCost)} icon={<PaidIcon />} />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard title="Open Alerts" value={stats.openAlerts} icon={<NotificationsActiveIcon />} />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard
            title="Cost This Year"
            value={formatCurrency(stats.yearlyCost)}
            icon={<PaidIcon />}
            subtitle="Total expenses and labour"
          />
        </Grid>
      </Grid>

      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
          Today&apos;s Action List
        </Typography>
        {alerts.length === 0 ? (
          <Typography color="text.secondary">No open alerts — you&apos;re all caught up.</Typography>
        ) : (
          <List dense disablePadding>
            {alerts.map((alert) => (
              <ListItem
                key={alert.id}
                component={RouterLink}
                to={getAlertNavigationPath(alert)}
                sx={{
                  textDecoration: 'none',
                  color: 'inherit',
                  borderRadius: 2,
                  mb: 0.5,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <ListItemText
                  primary={getTreeDisplayId(alert.trees || {})}
                  secondary={alert.reason || alert.alert_type}
                />
                <Chip
                  label={isSoilNutrientAlert(alert) ? 'Nutrients Below Required' : alert.alert_type}
                  size="small"
                  color={isSoilNutrientAlert(alert) ? 'warning' : 'error'}
                  variant="outlined"
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );
}

export default FarmDashboard;
