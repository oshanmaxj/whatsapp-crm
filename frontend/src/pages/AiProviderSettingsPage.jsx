import React from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography
} from '@mui/material';
import * as service from '../services/aiProvider.service';

const blank = {
  providerType: 'openai',
  name: 'OpenAI',
  apiBaseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  apiKey: ''
};

function validate(form) {
  const errors = {};
  if (!form.name?.trim()) errors.name = 'Provider name is required.';
  if (!['openai', 'gemini', 'anthropic', 'openai_compatible'].includes(form.providerType?.toLowerCase())) errors.providerType = 'Choose a supported provider type.';
  if (!form.model?.trim()) errors.model = 'Model is required.';
  if (!form.id && !form.apiKey?.trim()) errors.apiKey = 'API key is required.';
  try {
    if (form.apiBaseUrl && new URL(form.apiBaseUrl).protocol !== 'https:') errors.apiBaseUrl = 'API Base URL must use HTTPS.';
  } catch { errors.apiBaseUrl = 'Enter a valid API Base URL.'; }
  return errors;
}

export default function AiProviderSettingsPage() {
  const [rows, setRows] = React.useState([]), [edit, setEdit] = React.useState(null);
  const [message, setMessage] = React.useState(null), [errors, setErrors] = React.useState({});
  const [saving, setSaving] = React.useState(false), [testingId, setTestingId] = React.useState(null);
  const load = React.useCallback(async () => {
    try { setRows((await service.listAiProviders()).data.data); }
    catch (error) { setMessage({ severity: 'error', text: error.response?.data?.message || error.message }); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const open = row => { setErrors({}); setMessage(null); setEdit(row ? { ...row, apiKey: '' } : { ...blank }); };
  const save = async () => {
    if (saving) return;
    const invalid = validate(edit);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      requestAnimationFrame(() => document.querySelector('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true); setMessage(null);
    try {
      await service.saveAiProvider(edit.id, {
        ...edit,
        name: edit.name.trim(),
        providerType: edit.providerType.trim().toLowerCase(),
        apiBaseUrl: edit.apiBaseUrl.trim().replace(/\/+$/, ''),
        model: edit.model.trim(),
        apiKey: edit.apiKey.trim()
      });
      setEdit(null);
      setMessage({ severity: 'success', text: 'Provider saved. Use Test to verify the server-side connection.' });
      await load();
    } catch (error) {
      const fieldErrors = error.response?.data?.errors || {};
      setErrors(fieldErrors);
      setMessage({ severity: 'error', text: Object.values(fieldErrors)[0] || error.response?.data?.message || error.message });
    } finally { setSaving(false); }
  };
  const test = async id => {
    if (testingId) return;
    setTestingId(id); setMessage(null);
    try {
      await service.testAiProvider(id);
      setMessage({ severity: 'success', text: 'Connection successful.' });
      await load();
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setTestingId(null); }
  };
  const invalid = edit ? Object.keys(validate(edit)).length > 0 : true;
  return <Box>
    <Typography variant="h4">AI Provider Settings</Typography>
    <Alert severity="info" sx={{ my: 2 }}>API keys are encrypted on the server and never displayed again. Leave the key blank when editing to keep the configured key.</Alert>
    <Button variant="contained" onClick={() => open()}>Add provider</Button>
    {message && <Alert severity={message.severity} sx={{ mt: 2 }}>{message.text}</Alert>}
    <Stack spacing={1} sx={{ mt: 2 }}>{rows.map(row => <Card key={row.id}><CardContent>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
        <Box><Typography variant="h6">{row.name}</Typography><Typography>{row.providerType} · {row.model} · Key: {row.keyConfigured ? 'Configured' : 'Not configured'}</Typography><Typography variant="caption">Last test: {row.lastTestStatus || 'Not tested'}</Typography></Box>
        <Stack direction="row" spacing={1}><Chip label={row.isDefault ? 'Default' : row.enabled ? 'Enabled' : 'Disabled'}/><Button onClick={() => open(row)}>Edit</Button><Button disabled={Boolean(testingId)} onClick={() => test(row.id)}>{testingId === row.id ? 'Testing…' : 'Test'}</Button></Stack>
      </Stack>
    </CardContent></Card>)}</Stack>
    <Dialog open={Boolean(edit)} onClose={() => !saving && setEdit(null)} fullWidth>
      <DialogTitle>AI provider</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="caption" color="error">* Required fields</Typography>
        <TextField required aria-required="true" label="Name" value={edit?.name || ''} error={Boolean(errors.name)} helperText={errors.name} onChange={event => setEdit({ ...edit, name: event.target.value })}/>
        <TextField required aria-required="true" select label="Provider type" value={edit?.providerType || ''} error={Boolean(errors.providerType)} helperText={errors.providerType} onChange={event => setEdit({ ...edit, providerType: event.target.value })}>{['openai', 'gemini', 'anthropic', 'openai_compatible'].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
        <TextField required aria-required="true" label="API Base URL" value={edit?.apiBaseUrl || ''} error={Boolean(errors.apiBaseUrl)} helperText={errors.apiBaseUrl} onChange={event => setEdit({ ...edit, apiBaseUrl: event.target.value })}/>
        <TextField required aria-required="true" label="Model" value={edit?.model || ''} error={Boolean(errors.model)} helperText={errors.model} onChange={event => setEdit({ ...edit, model: event.target.value })}/>
        <TextField required={!edit?.id} aria-required={edit?.id ? 'false' : 'true'} type="password" autoComplete="new-password" label={edit?.keyConfigured ? 'Replace key (leave blank to keep current)' : 'API key'} value={edit?.apiKey || ''} error={Boolean(errors.apiKey)} helperText={errors.apiKey} onChange={event => setEdit({ ...edit, apiKey: event.target.value })}/>
      </Stack></DialogContent>
      <DialogActions><Button disabled={saving} onClick={() => setEdit(null)}>Cancel</Button><Button variant="contained" disabled={saving || invalid} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button></DialogActions>
    </Dialog>
  </Box>;
}
