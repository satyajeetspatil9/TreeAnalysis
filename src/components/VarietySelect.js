import React, { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { FormControl, InputLabel, Select, MenuItem, Alert, Link } from '@mui/material';
import { useTreeVarieties } from '../hooks/useTreeVarieties';

/** Dropdown of farm-configured varieties (Settings). Includes legacy value if not in list. */
export default function VarietySelect({
  value,
  onChange,
  required = false,
  margin = 'normal',
  disabled = false,
  label = 'Variety',
}) {
  const { varieties, loading } = useTreeVarieties();

  const options = useMemo(() => {
    const names = varieties.map((v) => v.name);
    if (value && !names.includes(value)) return [value, ...names];
    return names;
  }, [varieties, value]);

  if (!loading && options.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: margin === 'normal' ? 2 : 0, mb: 1 }}>
        No varieties configured. Add them in{' '}
        <Link component={RouterLink} to="/admin/settings" fontWeight={600}>
          Settings → Tree varieties
        </Link>
        .
      </Alert>
    );
  }

  return (
    <FormControl fullWidth margin={margin} required={required} disabled={disabled || loading}>
      <InputLabel>{label}</InputLabel>
      <Select
        value={value}
        label={label}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((name) => (
          <MenuItem key={name} value={name}>{name}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
