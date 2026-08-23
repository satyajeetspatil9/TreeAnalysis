import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, Alert, Container } from '@mui/material';
import AddTreeForm from '../components/AddTreeForm';

function PublicAddTreePage() {
  const [searchParams] = useSearchParams();
  const accessKey = searchParams.get('key') || process.env.REACT_APP_PUBLIC_ADD_TREE_KEY || '';

  if (!accessKey) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="error">
          Missing access key. Open this page with a link like /add-tree?key=ta_your_key
        </Alert>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 4 }}>
      <Container maxWidth="sm">
        <Typography variant="h4" gutterBottom fontWeight={700}>
          Add Tree
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Scan the tree QR tag, confirm details, and save. No login required.
        </Typography>
        <AddTreeForm publicAccessKey={accessKey} />
      </Container>
    </Box>
  );
}

export default PublicAddTreePage;
