import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import LinkIcon from '@mui/icons-material/Link';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import {
  getWhatsappSettings,
  saveWhatsappSettings,
  testWhatsappConnection,
  testWhatsappSend
} from '../services/whatsappConnect.service';

const WEBHOOK_URL = 'http://localhost:4000/api/webhooks/whatsapp';

const emptyForm = {
  businessAccountId: '',
  phoneNumberId: '',
  accessToken: '',
  verifyToken: '',
  appId: '',
  appSecret: ''
};

function statusColor(status) {
  if (status === 'Connected' || status === 'Webhook Verified') return 'success';
  if (status === 'Token Invalid') return 'error';
  return 'default';
}

function statusIcon(status) {
  if (status === 'Connected' || status === 'Webhook Verified') return <CheckCircleOutlineIcon />;
  if (status === 'Token Invalid') return <ErrorOutlineIcon />;
  return <LinkIcon />;
}

function copyText(value, setNotice, label) {
  navigator.clipboard.writeText(value || '');
  setNotice(`${label} copied.`);
}

function ConnectWhatsAppPage() {
  const theme = useTheme();
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState('Not Connected');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('First Of Education International WhatsApp connection test');

  const webhookUrl = useMemo(() => WEBHOOK_URL, []);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getWhatsappSettings();
      const data = response.data.data || {};
      setForm({
        businessAccountId: data.businessAccountId || '',
        phoneNumberId: data.phoneNumberId || '',
        accessToken: data.accessToken || '',
        verifyToken: data.verifyToken || '',
        appId: data.appId || '',
        appSecret: data.appSecret || ''
      });
      setStatus(data.status || 'Not Connected');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load WhatsApp settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        accessToken: form.accessToken.includes('****') ? '' : form.accessToken,
        appSecret: form.appSecret.includes('****') ? '' : form.appSecret,
        webhookUrl
      };
      const response = await saveWhatsappSettings(payload);
      const data = response.data.data || {};
      setForm((current) => ({
        ...current,
        accessToken: data.accessToken || current.accessToken,
        appSecret: data.appSecret || current.appSecret
      }));
      setStatus(data.status || status);
      setNotice('WhatsApp settings saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save WhatsApp settings.');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await testWhatsappConnection();
      setStatus(response.data.data?.status || 'Connected');
      setNotice('WhatsApp Cloud API connection succeeded.');
    } catch (err) {
      setStatus(err.response?.status === 401 ? 'Token Invalid' : 'Not Connected');
      setError(err.response?.data?.message || 'Connection test failed.');
    } finally {
      setSaving(false);
    }
  };

  const testSend = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await testWhatsappSend({ to: testPhone, message: testMessage });
      setNotice(response.data.data?.simulated ? 'Test send simulated because real sending is disabled.' : 'Test message sent.');
    } catch (err) {
      setError(err.response?.data?.message || 'Test send failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 360 }}><CircularProgress /></Box>;
  }

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Paper
        elevation={0}
        sx={{
          overflow: 'hidden',
          border: '1px solid #d9eee3',
          bgcolor: '#071a15'
        }}
      >
        <Grid container>
          <Grid item xs={12} md={5}>
            <Box
              sx={{
                height: '100%',
                p: { xs: 3, md: 4 },
                color: '#fff',
                background: `linear-gradient(160deg, ${alpha(theme.palette.success.main, 0.28)}, transparent 64%)`
              }}
            >
              <Stack spacing={2.5}>
                <Box sx={{ width: 58, height: 58, borderRadius: 3, display: 'grid', placeItems: 'center', bgcolor: theme.palette.success.main, color: theme.palette.success.contrastText }}>
                  <WhatsAppIcon fontSize="large" />
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={900}>Connect WhatsApp</Typography>
                  <Typography sx={{ mt: 1, color: alpha(theme.palette.common.white, 0.72) }}>
                    Configure the First Of Education International WhatsApp Cloud API connection for inbound leads, inbox replies, and approved campaigns.
                  </Typography>
                </Box>
                <Chip
                  icon={statusIcon(status)}
                  label={status}
                  color={statusColor(status)}
                  sx={{ alignSelf: 'flex-start', fontWeight: 800 }}
                />
              </Stack>
            </Box>
          </Grid>

          <Grid item xs={12} md={7}>
            <Box sx={{ p: { xs: 3, md: 4 }, bgcolor: '#fff' }}>
              <Stack spacing={2}>
                <TextField
                  label="Webhook Callback URL"
                  value={webhookUrl}
                  fullWidth
                  InputProps={{
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => copyText(webhookUrl, setNotice, 'Webhook URL')}>Copy</Button>
                      </InputAdornment>
                    )
                  }}
                />
                <TextField
                  label="Verify Token"
                  value={form.verifyToken}
                  onChange={updateField('verifyToken')}
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => copyText(form.verifyToken, setNotice, 'Verify token')}>Copy</Button>
                      </InputAdornment>
                    )
                  }}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => copyText(webhookUrl, setNotice, 'Webhook URL')}>
                    Copy Webhook URL
                  </Button>
                  <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => copyText(form.verifyToken, setNotice, 'Verify token')}>
                    Copy Verify Token
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={8}>
          <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #e8edf2' }}>
            <Typography variant="h6" fontWeight={900}>Cloud API Settings</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>Secrets are saved in backend settings and masked in normal API responses.</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}><TextField label="WhatsApp Business Account ID" value={form.businessAccountId} onChange={updateField('businessAccountId')} fullWidth /></Grid>
              <Grid item xs={12} md={6}><TextField label="Phone Number ID" value={form.phoneNumberId} onChange={updateField('phoneNumberId')} fullWidth /></Grid>
              <Grid item xs={12}><TextField label="Access Token" value={form.accessToken} onChange={updateField('accessToken')} fullWidth type="password" helperText="Masked values are preserved unless replaced." /></Grid>
              <Grid item xs={12} md={6}><TextField label="App ID" value={form.appId} onChange={updateField('appId')} fullWidth /></Grid>
              <Grid item xs={12} md={6}><TextField label="App Secret" value={form.appSecret} onChange={updateField('appSecret')} fullWidth type="password" helperText="Masked values are preserved unless replaced." /></Grid>
            </Grid>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2.5 }}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving}>Save Settings</Button>
              <Button variant="outlined" startIcon={<LinkIcon />} onClick={testConnection} disabled={saving}>Test Connection</Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #e8edf2', mb: 2.5 }}>
            <Typography variant="h6" fontWeight={900}>Setup Checklist</Typography>
            <Stack spacing={1} sx={{ mt: 2 }}>
              {[
                ['Phone Number ID', form.phoneNumberId],
                ['Business Account ID', form.businessAccountId],
                ['Verify Token', form.verifyToken],
                ['Access Token', form.accessToken]
              ].map(([label, value]) => (
                <Stack key={label} direction="row" justifyContent="space-between" alignItems="center">
                  <Typography color="text.secondary">{label}</Typography>
                  <Chip size="small" label={value ? 'Ready' : 'Missing'} color={value ? 'success' : 'default'} />
                </Stack>
              ))}
            </Stack>
          </Paper>
          <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #e8edf2' }}>
            <Typography variant="h6" fontWeight={900}>Test Send Message</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Real sending only happens when `WHATSAPP_SEND_ENABLED=true`.
            </Typography>
            <Stack spacing={2}>
              <TextField label="Recipient Phone" value={testPhone} onChange={(event) => setTestPhone(event.target.value)} placeholder="94770000000" fullWidth />
              <TextField label="Message" value={testMessage} onChange={(event) => setTestMessage(event.target.value)} fullWidth multiline minRows={3} />
              <Button variant="contained" color="success" startIcon={<SendIcon />} onClick={testSend} disabled={saving || !testPhone}>Test Send Message</Button>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  );
}

export default ConnectWhatsAppPage;
