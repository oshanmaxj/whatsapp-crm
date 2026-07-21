import React, { useMemo, useState } from 'react';
import { Autocomplete, Box, CircularProgress, TextField, Typography } from '@mui/material';
import { createLabel } from '../services/chat.service';
import { hasPermission } from '../utils/access';

const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');

export default function LabelMultiSelect({
  label = 'Labels', options = [], value = [], onChange, onOptionsChange,
  loading = false, disabled = false, helperText = ''
}) {
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [color, setColor] = useState('#25d366');
  const canCreate = hasPermission('labels.create');
  const selected = useMemo(() => options.filter((item) => value.map(String).includes(String(item.id))), [options, value]);

  const choose = async (rows) => {
    const createOption = rows.find((item) => item?.inputValue);
    if (!createOption) {
      onChange(rows.map((item) => item.id));
      return;
    }
    const name = normalize(createOption.inputValue);
    const duplicate = options.find((item) => normalize(item.name).toLowerCase() === name.toLowerCase());
    if (duplicate) {
      onChange([...selected, duplicate].filter((item, index, all) => all.findIndex((row) => String(row.id) === String(item.id)) === index).map((item) => item.id));
      return;
    }
    setCreating(true); setError('');
    try {
      const response = await createLabel({ name, color });
      const created = response.data.data;
      const nextOptions = [...options, created].sort((a, b) => a.name.localeCompare(b.name));
      onOptionsChange?.(nextOptions);
      onChange([...selected.map((item) => item.id), created.id]);
    } catch (requestError) {
      const existing = requestError.response?.data?.existingLabel;
      if (existing?.id) onChange([...selected.map((item) => item.id), existing.id]);
      else setError(requestError.response?.data?.message || 'Unable to create label.');
    } finally { setCreating(false); }
  };

  return <Autocomplete
    multiple freeSolo size="small" disabled={disabled || creating} loading={loading || creating}
    options={options} value={selected}
    isOptionEqualToValue={(a, b) => String(a.id) === String(b.id)}
    getOptionLabel={(item) => typeof item === 'string' ? item : (item.name || item.inputValue || '')}
    filterOptions={(items, params) => {
      const query = normalize(params.inputValue);
      const filtered = items.filter((item) => normalize(item.name).toLowerCase().includes(query.toLowerCase()));
      const exists = items.some((item) => normalize(item.name).toLowerCase() === query.toLowerCase());
      if (query && canCreate && !exists) filtered.push({ inputValue: query, name: `+ Create “${query}”` });
      return filtered;
    }}
    onChange={(_, rows) => choose(rows)}
    renderOption={(props, item) => <Box component="li" {...props} key={item.id || `new-${item.inputValue}`} sx={{ gap: 1 }}>
      {!item.inputValue && <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: item.color || '#25d366', flexShrink: 0 }} />}
      <Typography variant="body2">{item.name}</Typography>
    </Box>}
    renderTags={(items, getTagProps) => items.map((item, index) => <Box component="span" {...getTagProps({ index })} key={item.id} sx={{ display: 'inline-flex', alignItems: 'center', gap: .5, px: 1, py: .25, borderRadius: 2, bgcolor: `${item.color || '#25d366'}22`, border: '1px solid', borderColor: item.color || '#25d366', fontSize: 12 }}>{item.name}</Box>)}
    renderInput={(params) => <TextField {...params} label={label} error={Boolean(error)} helperText={error || helperText || (canCreate ? 'Search or type a new label. Choose a color before creating.' : 'Search existing labels.')} InputProps={{ ...params.InputProps, endAdornment: <>{canCreate && <input aria-label="New label color" title="New label color" type="color" value={color} onChange={(event) => setColor(event.target.value)} style={{ width: 28, height: 28, padding: 0, border: 0, background: 'transparent' }} />}{creating && <CircularProgress size={18} />}{params.InputProps.endAdornment}</> }} />}
  />;
}
