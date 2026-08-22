import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert, Typography, Box,
} from '@mui/material';
import { Html5Qrcode } from 'html5-qrcode';

function QrPositionScanner({ open, onClose, onScan }) {
  const regionId = useId().replace(/:/g, '');
  const scannerRef = useRef(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    const scanner = new Html5Qrcode(regionId);
    scannerRef.current = scanner;
    setError(null);
    setScanning(true);

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        if (cancelled) return;
        onScanRef.current(decodedText);
      },
      () => {},
    ).catch((err) => {
      if (cancelled) return;
      setError(err?.message || 'Could not access the camera. Allow camera permission and try again.');
      setScanning(false);
    });

    return () => {
      cancelled = true;
      setScanning(false);
      const active = scannerRef.current;
      scannerRef.current = null;
      if (!active) return;
      active.stop().then(() => active.clear()).catch(() => active.clear());
    };
  }, [open, regionId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Scan tree QR code</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Point the camera at the tree tag. The position code (e.g. A-R01-L01-T01) will fill in automatically.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box
          id={regionId}
          sx={{
            width: '100%',
            minHeight: 280,
            overflow: 'hidden',
            borderRadius: 2,
            bgcolor: 'background.default',
            '& video': { borderRadius: 2 },
          }}
        />
        {scanning && !error && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Scanning…
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

export default QrPositionScanner;
