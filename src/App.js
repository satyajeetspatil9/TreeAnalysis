import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { FarmProvider } from './contexts/FarmContext';
import Auth from './components/Auth';
import AppLayout from './layout/AppLayout';
import PublicAddTreePage from './pages/PublicAddTreePage';
import FarmDashboard from './pages/FarmDashboard';
import FarmMapPage from './pages/FarmMapPage';
import TreesPage from './pages/TreesPage';
import TreeDashboard from './pages/TreeDashboard';
import FarmSetup from './pages/FarmSetup';
import AddSoilReportPage from './pages/farm/AddSoilReportPage';
import IrrigationZonesPage from './pages/irrigation/IrrigationZonesPage';
import IrrigationEventsPage from './pages/irrigation/IrrigationEventsPage';
import FertigationPage from './pages/irrigation/FertigationPage';
import AddProductPage from './pages/inputs/AddProductPage';
import InventoryPage from './pages/inputs/InventoryPage';
import SprayPage from './pages/inputs/SprayPage';
import SoilApplicationPage from './pages/inputs/SoilApplicationPage';
import SoilMonitoringPage from './pages/monitoring/SoilMonitoringPage';
import DiseaseDashboardPage from './pages/monitoring/DiseaseDashboardPage';
import GrowthComparisonPage from './pages/monitoring/GrowthComparisonPage';
import AlertsPage from './pages/monitoring/AlertsPage';
import ExpensesPage from './pages/finance/ExpensesPage';
import LabourPage from './pages/finance/LabourPage';
import CostAnalysisPage from './pages/finance/CostAnalysisPage';
import HarvestPage from './pages/production/HarvestPage';
import RevenuePage from './pages/production/RevenuePage';
import SettingsPage from './pages/admin/SettingsPage';

function ProtectedApp() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', bgcolor: 'background.default' }}>
        <CircularProgress color="primary" />
      </Box>
    );
  }

  if (!session) {
    return <Auth />;
  }

  return (
    <FarmProvider>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<FarmDashboard />} />
          <Route path="orchard/map" element={<FarmMapPage />} />
          <Route path="orchard/trees" element={<TreesPage />} />
          <Route path="orchard/setup" element={<FarmSetup />} />
          <Route path="orchard/soil-report" element={<AddSoilReportPage />} />
          <Route path="orchard/soil-zones" element={<Navigate to="/" replace />} />
          <Route path="tree/:treeId" element={<TreeDashboard />} />
          <Route path="irrigation/zones" element={<IrrigationZonesPage />} />
          <Route path="irrigation/events" element={<IrrigationEventsPage />} />
          <Route path="irrigation/fertigation" element={<FertigationPage />} />
          <Route path="inputs/add-product" element={<AddProductPage />} />
          <Route path="inputs/inventory" element={<InventoryPage />} />
          <Route path="inputs/spray" element={<SprayPage />} />
          <Route path="inputs/soil-application" element={<SoilApplicationPage />} />
          <Route path="inputs/optimizer" element={<Navigate to="/inputs/inventory" replace />} />
          <Route path="monitoring/soil" element={<SoilMonitoringPage />} />
          <Route path="monitoring/satellite" element={<Navigate to="/monitoring/soil" replace />} />
          <Route path="monitoring/disease" element={<DiseaseDashboardPage />} />
          <Route path="monitoring/growth" element={<GrowthComparisonPage />} />
          <Route path="monitoring/alerts" element={<AlertsPage />} />
          <Route path="finance/expenses" element={<ExpensesPage />} />
          <Route path="finance/labour" element={<LabourPage />} />
          <Route path="finance/costs" element={<CostAnalysisPage />} />
          <Route path="production/flowering" element={<Navigate to="/production/harvest" replace />} />
          <Route path="production/fruit-set" element={<Navigate to="/production/harvest" replace />} />
          <Route path="production/harvest" element={<HarvestPage />} />
          <Route path="production/revenue" element={<RevenuePage />} />
          <Route path="admin/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </FarmProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/add-tree" element={<PublicAddTreePage />} />
      <Route path="*" element={<ProtectedApp />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
