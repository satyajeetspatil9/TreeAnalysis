import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip, Button,
} from '@mui/material';
import PageHeader from '../../components/common/PageHeader';
import { FARM_INPUT_CATALOG } from '../../utils/farmInputCatalog';

function AvailableInputsPage() {
  return (
    <Box>
      <PageHeader
        section="Administration"
        title="Available inputs"
        subtitle="Farm-allowed organic, mineral, microbial, and botanical inputs. Fertilizer recommendation picks from this list."
        action={(
          <Button component={RouterLink} to="/inputs/optimizer" variant="outlined">
            Fertilizer rec.
          </Button>
        )}
      />
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Input</TableCell>
              <TableCell>Primary category</TableCell>
              <TableCell>Main purpose</TableCell>
              <TableCell>Used in fertilizer rec.</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {FARM_INPUT_CATALOG.map((item) => (
              <TableRow key={item.id} hover>
                <TableCell sx={{ fontWeight: 600 }}>{item.name}</TableCell>
                <TableCell>{item.category}</TableCell>
                <TableCell>{item.purpose}</TableCell>
                <TableCell>
                  {item.fertilizer ? (
                    <Chip size="small" color="success" label="Yes" />
                  ) : (
                    <Chip size="small" label="Pest only" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        Dashparni Ark and AgniAstra stay on this list for pest work; they are not mixed into fertilizer drafts.
      </Typography>
    </Box>
  );
}

export default AvailableInputsPage;
