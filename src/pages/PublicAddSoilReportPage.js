import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Container, Typography } from '@mui/material';
import PublicSoilReportForm from '../components/PublicSoilReportForm';
import { buildSoilReportCurlExample } from '../utils/publicSoilReportApi';

function PublicAddSoilReportPage() {
  const [searchParams] = useSearchParams();
  const accessKey = searchParams.get('key') || process.env.REACT_APP_PUBLIC_ADD_TREE_KEY || '';

  if (!accessKey) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="error">
          Missing access key. Open this page with a link like /add-soil-report?key=ta_your_key
        </Alert>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 4 }}>
      <Container maxWidth="sm">
        <Typography variant="h4" gutterBottom fontWeight={700}>
          Add Soil Report
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          7-in-1 sensor only. Scan QR, fetch readings, and save — no login required.
        </Typography>
        <PublicSoilReportForm publicAccessKey={accessKey} />
        <Typography variant="caption" color="text.secondary" component="pre" sx={{ mt: 3, display: 'block', whiteSpace: 'pre-wrap' }}>
          curl example (Windows):
          {'\n'}
          {buildSoilReportCurlExample(accessKey)}
        </Typography>
      </Container>
    </Box>
  );
}

export default PublicAddSoilReportPage;
