import React from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, FormControlLabel,
  IconButton, InputAdornment, MenuItem, Stack, Switch, TextField, Tooltip, Typography
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import * as service from '../services/smsGateway.service';

const emptySettings = {
  isEnabled: false,
  activeProvider: 'smsgo',
  availableProviders: [{ id: 'smsgo', label: 'SMSGo.lk' }],
  capabilities: {},
  webhookUrl: null,
  providerConfig: { mode: 'sandbox', defaultMask: '', sandboxApiKeyConfigured: false, liveApiKeyConfigured: false },
  lastTestStatus: null,
  lastTestAt: null,
  lastTestError: null
};

export default function SmsGatewaySettingsPage() {
  const [settings, setSettings] = React.useState(emptySettings);
  const [form, setForm] = React.useState({ isEnabled: false, activeProvider: 'smsgo', mode: 'sandbox', defaultMask: '', sandboxApiKey: '', liveApiKey: '' });
  const [masks, setMasks] = React.useState([]);
  const [balance, setBalance] = React.useState(null);
  const [message, setMessage] = React.useState(null);
  const [errors, setErrors] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [fetchingMasks, setFetchingMasks] = React.useState(false);
  const [fetchingBalance, setFetchingBalance] = React.useState(false);
  const [testTo, setTestTo] = React.useState('');
  const [testMessage, setTestMessage] = React.useState('');
  const [sendingTest, setSendingTest] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const { data } = await service.getSmsGatewaySettings();
      setSettings(data.data);
      setForm({
        isEnabled: data.data.isEnabled,
        activeProvider: data.data.activeProvider,
        mode: data.data.providerConfig?.mode || 'sandbox',
        defaultMask: data.data.providerConfig?.defaultMask || '',
        sandboxApiKey: '',
        liveApiKey: ''
      });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true); setMessage(null); setErrors({});
    try {
      const { data } = await service.saveSmsGatewaySettings({
        isEnabled: form.isEnabled,
        activeProvider: form.activeProvider,
        providerConfig: { mode: form.mode, defaultMask: form.defaultMask, sandboxApiKey: form.sandboxApiKey, liveApiKey: form.liveApiKey }
      });
      setSettings(data.data);
      setForm((prev) => ({ ...prev, sandboxApiKey: '', liveApiKey: '' }));
      setMessage({ severity: 'success', text: 'SMS Gateway settings saved.' });
    } catch (error) {
      const fieldErrors = error.response?.data?.errors || {};
      setErrors(fieldErrors);
      setMessage({ severity: 'error', text: Object.values(fieldErrors)[0] || error.response?.data?.message || error.message });
    } finally { setSaving(false); }
  };

  const testConnection = async () => {
    if (testing) return;
    setTesting(true); setMessage(null);
    try {
      const { data } = await service.testSmsGatewayConnection();
      setBalance(data.data.result?.balance ?? null);
      setMessage({ severity: 'success', text: `Connection successful (${data.data.provider}).` });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally {
      setTesting(false);
      await load();
    }
  };

  const fetchMasks = async () => {
    if (fetchingMasks) return;
    setFetchingMasks(true); setMessage(null);
    try {
      const { data } = await service.getSmsGatewayMasks();
      const list = Array.isArray(data.data) ? data.data : (data.data?.masks || []);
      setMasks(list);
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setFetchingMasks(false); }
  };

  const fetchBalance = async () => {
    if (fetchingBalance) return;
    setFetchingBalance(true); setMessage(null);
    try {
      const { data } = await service.getSmsGatewayBalance();
      setBalance(data.data);
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setFetchingBalance(false); }
  };

  const sendTest = async () => {
    if (sendingTest) return;
    if (!testTo.trim() || !testMessage.trim()) {
      setMessage({ severity: 'error', text: 'Enter a phone number and message to send a test SMS.' });
      return;
    }
    setSendingTest(true); setMessage(null);
    try {
      await service.sendTestSms({ to: testTo.trim(), message: testMessage.trim() });
      setMessage({ severity: 'success', text: `Test SMS sent to ${testTo.trim()}.` });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.message || error.message });
    } finally { setSendingTest(false); }
  };

  const copyWebhookUrl = async () => {
    if (!settings.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(settings.webhookUrl);
      setMessage({ severity: 'success', text: 'Webhook URL copied to clipboard.' });
    } catch {
      setMessage({ severity: 'error', text: 'Could not copy automatically — select and copy the URL manually.' });
    }
  };

  const capabilities = settings.capabilities || {};

  return <Box>
    <Typography variant="h4">SMS Gateway</Typography>
    <Alert severity="info" sx={{ my: 2 }}>
      API keys are encrypted on the server and never displayed again. Leave a key field blank to keep the currently configured key.
    </Alert>
    {message && <Alert severity={message.severity} sx={{ mb: 2 }}>{message.text}</Alert>}

    <Card>
      <CardContent>
        <Stack spacing={2}>
          <FormControlLabel
            control={<Switch checked={form.isEnabled} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />}
            label={form.isEnabled ? 'SMS sending enabled' : 'SMS sending disabled'}
          />
          <TextField
            select label="Provider" value={form.activeProvider}
            onChange={(e) => setForm({ ...form, activeProvider: e.target.value })}
            sx={{ maxWidth: 240 }}
            helperText="More providers can be added later without affecting campaigns or reminders."
          >
            {(settings.availableProviders || []).map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
          </TextField>
          {capabilities.sandbox && <TextField select label="Mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} sx={{ maxWidth: 240 }}>
            <MenuItem value="sandbox">Sandbox</MenuItem>
            <MenuItem value="live">Live</MenuItem>
          </TextField>}
          {capabilities.masks && <TextField
            label="Default sender mask"
            value={form.defaultMask}
            onChange={(e) => setForm({ ...form, defaultMask: e.target.value })}
            helperText="Used when a send doesn't specify its own mask."
          />}
          {masks.length > 0 && <Stack direction="row" spacing={1} flexWrap="wrap">
            {masks.map((entry) => {
              const label = typeof entry === 'string' ? entry : (entry.mask || entry.name || JSON.stringify(entry));
              return <Chip key={label} label={label} onClick={() => setForm({ ...form, defaultMask: label })} clickable size="small" />;
            })}
          </Stack>}
          <TextField
            type="password" autoComplete="new-password"
            label={settings.providerConfig?.sandboxApiKeyConfigured ? 'Sandbox API key (configured — leave blank to keep)' : 'Sandbox API key'}
            value={form.sandboxApiKey}
            error={Boolean(errors.sandboxApiKey)}
            helperText={errors.sandboxApiKey}
            onChange={(e) => setForm({ ...form, sandboxApiKey: e.target.value })}
          />
          <TextField
            type="password" autoComplete="new-password"
            label={settings.providerConfig?.liveApiKeyConfigured ? 'Live API key (configured — leave blank to keep)' : 'Live API key'}
            value={form.liveApiKey}
            error={Boolean(errors.liveApiKey)}
            helperText={errors.liveApiKey}
            onChange={(e) => setForm({ ...form, liveApiKey: e.target.value })}
          />
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="contained" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
            <Button disabled={testing} onClick={testConnection}>{testing ? 'Testing…' : 'Test Connection'}</Button>
            {capabilities.masks && <Button disabled={fetchingMasks} onClick={fetchMasks}>{fetchingMasks ? 'Fetching…' : 'Fetch Masks'}</Button>}
            {capabilities.balance && <Button disabled={fetchingBalance} onClick={fetchBalance}>{fetchingBalance ? 'Fetching…' : 'Fetch Balance'}</Button>}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Last test: {settings.lastTestStatus || 'Not tested'}{settings.lastTestAt ? ` at ${new Date(settings.lastTestAt).toLocaleString()}` : ''}
            {settings.lastTestError ? ` — ${settings.lastTestError}` : ''}
          </Typography>
          {balance != null && <Typography variant="body2">Balance: {typeof balance === 'object' ? JSON.stringify(balance) : balance}</Typography>}
        </Stack>
      </CardContent>
    </Card>

    <Divider sx={{ my: 3 }} />

    {settings.webhookUrl && <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 1 }}>Delivery webhook</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Enter this URL as the delivery callback in the {settings.availableProviders.find((p) => p.id === settings.activeProvider)?.label || settings.activeProvider} dashboard so delivery status updates flow back into SMS History.
        </Typography>
        <TextField
          fullWidth
          value={settings.webhookUrl}
          InputProps={{
            readOnly: true,
            endAdornment: <InputAdornment position="end">
              <Tooltip title="Copy">
                <IconButton onClick={copyWebhookUrl} edge="end"><ContentCopyIcon fontSize="small" /></IconButton>
              </Tooltip>
            </InputAdornment>
          }}
          onFocus={(e) => e.target.select()}
        />
      </CardContent>
    </Card>}

    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>Send test SMS</Typography>
        <Stack spacing={2} sx={{ maxWidth: 480 }}>
          <TextField label="Phone number" placeholder="94771234567 or 0771234567" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <TextField label="Message" multiline minRows={2} value={testMessage} onChange={(e) => setTestMessage(e.target.value)} />
          <Button variant="outlined" disabled={sendingTest} onClick={sendTest} sx={{ alignSelf: 'flex-start' }}>
            {sendingTest ? 'Sending…' : 'Send Test SMS'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  </Box>;
}
