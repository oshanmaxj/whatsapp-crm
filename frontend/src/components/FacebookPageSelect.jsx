import React, { useEffect, useState } from 'react';
import { MenuItem, TextField } from '@mui/material';
import { getFacebookPages } from '../services/facebookPage.service';

export default function FacebookPageSelect({
  value = '', onChange, label = 'Facebook Page', allowAll = false, required = false,
  size = 'small', fullWidth = false, sx, pages: suppliedPages, onError
}) {
  const [loadedPages, setLoadedPages] = useState([]);
  const [loadError, setLoadError] = useState('');
  const pages = suppliedPages || loadedPages;

  useEffect(() => {
    if (suppliedPages) return;
    setLoadError('');
    getFacebookPages().then((response) => {
      const rows = (response.data.data || []).filter((page) => page.active !== false);
      setLoadedPages(rows);
      if (!allowAll && !value && rows.length === 1) onChange?.(rows[0].id);
    }).catch((error) => {
      const text = error.response?.data?.message || 'Unable to load permitted Facebook Pages.';
      setLoadError(text);
      onError?.(text);
    });
  }, [suppliedPages]);

  return (
    <TextField select label={label} value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} required={required} size={size} fullWidth={fullWidth} sx={sx} error={Boolean(loadError)} helperText={loadError || (!pages.length ? 'No connected Facebook Pages are available.' : '')}>
      {allowAll && <MenuItem value="">All Facebook Pages</MenuItem>}
      {pages.map((page) => (
        <MenuItem key={page.id} value={page.id}>{page.name}</MenuItem>
      ))}
    </TextField>
  );
}
