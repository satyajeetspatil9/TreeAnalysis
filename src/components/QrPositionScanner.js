import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert, Typography, Box,
} from '@mui/material';
import { Html5Qrcode } from 'html5-qrcode';

const SCANNER_ELEMENT_ID = 'tree-qr-scanner-view';

async function stopScannerInstance(scanner) {
  if (!scanner) return;
  try {
    if (scanner.isScanning) {
      await scanner.stop();
    }
  } catch (_) {
    // Camera may already be stopped.
  }
  try {
    scanner.clear();
  } catch (_) {
    // Ignore cleanup errors.
  }
}

function QrPositionScanner({ open, onClose, onScan }) {
  const scannerRef = useRef(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    await stopScannerInstance(scanner);
  }, []);

  const startScanner = useCallback(async () => {
    setError(null);
    setStarting(true);

    if (!document.getElementById(SCANNER_ELEMENT_ID)) {
      setError('Scanner could not start. Please try again.');
      setStarting(false);
      return;
    }

    await stopScanner();

    try {
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          onScanRef.current(decodedText);
        },
        () => {},
      );
    } catch (err) {
      scannerRef.current = null;
      setError(err?.message || 'Could not access the camera. Allow camera permission and try again.');
    } finally {
      setStarting(false);
    }
  }, [stopScanner]);

  const handleClose = useCallback(() => {
    stopScanner().finally(onClose);
  }, [onClose, stopScanner]);

  useEffect(() => () => {
    stopScanner();
  }, [stopScanner]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      keepMounted
      TransitionProps={{
        onEntered: startScanner,
        onExited: stopScanner,
      }}
    >
      <DialogTitle>Scan tree QR code</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Point the camera at the tree tag. The position code (e.g. A-R01-L01-T01) will fill in automatically.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box
          id={SCANNER_ELEMENT_ID}
          sx={{
            width: '100%',
            minHeight: 280,
            overflow: 'hidden',
            borderRadius: 2,
            bgcolor: 'background.default',
            '& video': {
              borderRadius: 2,
              width: '100% !important',
              height: 'auto !important',
              objectFit: 'cover',
            },
            '& #qr-shaded-region': {
              borderRadius: 2,
            },
          }}
        />
        {starting && !error && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Starting camera…
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button type="button" onClick={handleClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

export default QrPositionScanner;
