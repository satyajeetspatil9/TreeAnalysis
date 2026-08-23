import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Container, Typography } from '@mui/material';
import PublicGrowthForm from '../components/PublicGrowthForm';

function PublicAddGrowthPage() {
  const [searchParams] = useSearchParams();
  const accessKey = searchParams.get('key') || process.env.REACT_APP_PUBLIC_ADD_TREE_KEY || '';

  if (!accessKey) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="error">
          Missing access key. Open this page with a link like /add-growth?key=ta_your_key
        </Alert>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 4 }}>
      <Container maxWidth="sm">
        <Typography variant="h4" gutterBottom fontWeight={700}>
          Record Tree Growth
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Scan QR, enter height, trunk, and canopy measurements — no login required.
        </Typography>
        <PublicGrowthForm publicAccessKey={accessKey} />
      </Container>
    </Box>
  );
}

export default PublicAddGrowthPage;
