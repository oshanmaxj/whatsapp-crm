import React, { useEffect, useState } from 'react';
import { MenuItem, TextField } from '@mui/material';
import { getWhatsAppAccounts } from '../services/whatsappAccount.service';

export default function WhatsAppAccountSelect({
  value = '', onChange, label = 'WhatsApp Number', allowAll = false, required = false,
  size = 'small', fullWidth = false, sx, accounts: suppliedAccounts, onAccountsLoaded, onError
}) {
  const [loadedAccounts, setLoadedAccounts] = useState([]);
  const [loadError, setLoadError] = useState('');
  const accounts = suppliedAccounts || loadedAccounts;

  useEffect(() => {
    if (suppliedAccounts) return;
    setLoadError('');
    getWhatsAppAccounts().then((response) => {
      const rows = response.data.data || [];
      setLoadedAccounts(rows);
      onAccountsLoaded?.(rows);
      if (!allowAll && !value && rows.length) onChange?.(rows.find((item) => item.isDefault)?.id || rows[0].id);
    }).catch((error) => {
      const text = error.response?.data?.message || 'Unable to load permitted WhatsApp numbers.';
      setLoadError(text);
      onError?.(text);
    });
  }, [suppliedAccounts]);

  return (
    <TextField select label={label} value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} required={required} size={size} fullWidth={fullWidth} sx={sx} error={Boolean(loadError)} helperText={loadError || (!accounts.length ? 'No permitted WhatsApp numbers are available.' : '')}>
      {allowAll && <MenuItem value="">All WhatsApp numbers</MenuItem>}
      {accounts.map((account) => (
        <MenuItem key={account.id} value={account.id}>
          {account.name}{account.phoneNumber ? ` · ${account.phoneNumber}` : ''}{account.isDefault ? ' (Default)' : ''}
        </MenuItem>
      ))}
    </TextField>
  );
}
