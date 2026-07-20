import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';

const defaultOptionLabel = (option) => option?.label || '';
const defaultOptionValue = (option) => option?.id;

export default function AsyncSearchSelect({
  value, onChange, loadOptions, placeholder = 'Search…', label, getOptionLabel = defaultOptionLabel,
  getOptionValue = defaultOptionValue, disabled = false, required = false, filters = {}, minimumSearchLength = 0,
  pageSize = 20, selectedOption = null, helperText
}) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState(selectedOption ? [selectedOption] : []);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const filterKey = JSON.stringify(filters || {});

  useEffect(() => {
    if (!selectedOption) return;
    setOptions((current) => current.some((item) => String(getOptionValue(item)) === String(getOptionValue(selectedOption)))
      ? current : [selectedOption, ...current]);
  }, [selectedOption, getOptionValue]);

  useEffect(() => {
    const query = input.trim();
    if (query.length < minimumSearchLength) {
      setOptions(selectedOption ? [selectedOption] : []);
      setHasMore(false);
      return undefined;
    }
    const timer = setTimeout(async () => {
      const request = ++requestRef.current;
      setLoading(true);
      setError('');
      try {
        const result = await loadOptions(query, 1, pageSize, filters);
        if (request !== requestRef.current) return;
        const items = result?.items || result || [];
        setOptions(selectedOption && !items.some((item) => String(getOptionValue(item)) === String(getOptionValue(selectedOption)))
          ? [selectedOption, ...items] : items);
        setPage(1);
        setHasMore(Boolean(result?.hasMore));
      } catch (requestError) {
        if (request === requestRef.current) setError(requestError.response?.data?.message || 'Unable to load options.');
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [input, filterKey, loadOptions, minimumSearchLength, pageSize, selectedOption, getOptionValue]);

  const selected = useMemo(() => options.find((item) => String(getOptionValue(item)) === String(value)) || selectedOption || null,
    [options, selectedOption, value, getOptionValue]);

  const loadMore = async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const nextPage = page + 1;
      const result = await loadOptions(input.trim(), nextPage, pageSize, filters);
      const items = result?.items || result || [];
      setOptions((current) => [...current, ...items.filter((item) => !current.some((old) => String(getOptionValue(old)) === String(getOptionValue(item))))]);
      setPage(nextPage);
      setHasMore(Boolean(result?.hasMore));
    } finally { setLoading(false); }
  };

  return <Autocomplete
    fullWidth disabled={disabled} options={options} value={selected} loading={loading} filterOptions={(items) => items}
    getOptionLabel={(option) => getOptionLabel(option) || ''}
    isOptionEqualToValue={(option, candidate) => String(getOptionValue(option)) === String(getOptionValue(candidate))}
    onInputChange={(_, next, reason) => { if (reason !== 'reset') setInput(next); }}
    onChange={(_, option) => onChange(option)}
    noOptionsText={input.trim().length < minimumSearchLength ? `Type at least ${minimumSearchLength} characters` : error || 'No results found'}
    ListboxProps={{ onScroll: (event) => { const node = event.currentTarget; if (hasMore && node.scrollTop + node.clientHeight >= node.scrollHeight - 8) loadMore(); } }}
    renderOption={(props, option) => <Box component="li" {...props} key={getOptionValue(option)}><Typography variant="body2">{getOptionLabel(option)}</Typography></Box>}
    renderInput={(params) => <TextField {...params} required={required} label={label} placeholder={placeholder} helperText={helperText || (hasMore ? 'Scroll for more results' : error)}
      InputProps={{ ...params.InputProps, endAdornment: <>{loading && <CircularProgress color="inherit" size={18} />}{params.InputProps.endAdornment}</> }} />}
    PaperComponent={({ children, ...props }) => <Box {...props} sx={{ bgcolor: 'background.paper', boxShadow: 8 }}>{children}{hasMore && <Button fullWidth size="small" onMouseDown={(event) => event.preventDefault()} onClick={loadMore}>Load more</Button>}</Box>}
  />;
}
