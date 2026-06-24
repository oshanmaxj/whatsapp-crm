import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  FormControlLabel,
  Grid,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import EmailIcon from '@mui/icons-material/Email';
import SaveIcon from '@mui/icons-material/Save';
import { getSettings, saveSetting } from '../services/production.service';

const defaultCompany = { name: '', email: '', phone: '', address: '', website: '', registrationNo: '' };
const defaultBranding = { primaryColor: '#25d366', logoUrl: '' };
const defaultSmtp = { host: '', port: 587, secure: false, username: '', password: '', fromEmail: '', fromName: '' };

function settingsMap(rows) {
  return rows.reduce((acc, row) => {
    acc[`${row.namespace}.${row.key}`] = row.value || {};
    return acc;
  }, {});
}

export function CompanyProfilePage() {
  const [company, setCompany] = useState(defaultCompany);
  const [branding, setBranding] = useState(defaultBranding);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings()
      .then((res) => {
        const map = settingsMap(res.data.data || []);
        setCompany({ ...defaultCompany, ...(map['company.profile'] || {}) });
        setBranding({ ...defaultBranding, ...(map['branding.theme'] || {}) });
      })
      .catch((err) => setError(err.response?.data?.message || 'Unable to load company profile.'));
  }, []);

  const uploadLogo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBranding((current) => ({ ...current, logoUrl: reader.result }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    try {
      await Promise.all([
        saveSetting('company', 'profile', company),
        saveSetting('branding', 'theme', branding)
      ]);
      setNotice('Company profile saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save company profile.');
    }
  };

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Avatar src={branding.logoUrl} sx={{ width: 72, height: 72, bgcolor: 'success.light' }}>
            <BusinessIcon />
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>Company Profile</Typography>
            <Typography color="text.secondary">Branding, contact details, and logo used across the admin panel.</Typography>
          </Box>
          <Button component="label" variant="outlined" startIcon={<CloudUploadIcon />}>
            Upload Logo
            <input hidden accept="image/*" type="file" onChange={uploadLogo} />
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}><TextField label="Company Name" value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="Website" value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="Email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="Phone" value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="Registration Number" value={company.registrationNo} onChange={(e) => setCompany({ ...company, registrationNo: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="Primary Color" value={branding.primaryColor} onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12}><TextField label="Address" value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} fullWidth multiline minRows={3} /></Grid>
        </Grid>
        <Button variant="contained" startIcon={<SaveIcon />} sx={{ mt: 2.5 }} onClick={save}>Save Profile</Button>
      </Paper>
    </Stack>
  );
}

export function SmtpSettingsPage() {
  const [smtp, setSmtp] = useState(defaultSmtp);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const maskedPassword = useMemo(() => String(smtp.password || ''), [smtp.password]);

  useEffect(() => {
    getSettings()
      .then((res) => {
        const map = settingsMap(res.data.data || []);
        setSmtp({ ...defaultSmtp, ...(map['smtp.settings'] || {}) });
      })
      .catch((err) => setError(err.response?.data?.message || 'Unable to load SMTP settings.'));
  }, []);

  const save = async () => {
    try {
      await saveSetting('smtp', 'settings', smtp);
      setNotice('SMTP settings saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save SMTP settings.');
    }
  };

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar sx={{ bgcolor: 'primary.light' }}><EmailIcon /></Avatar>
          <Box>
            <Typography variant="h5" fontWeight={850}>SMTP Settings</Typography>
            <Typography color="text.secondary">Configure outgoing email credentials for notifications and reports.</Typography>
          </Box>
        </Stack>
      </Paper>
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}><TextField label="SMTP Host" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={4}><TextField label="Port" type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="Username" value={smtp.username} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="Password" type="password" value={maskedPassword} onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="From Email" value={smtp.fromEmail} onChange={(e) => setSmtp({ ...smtp, fromEmail: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="From Name" value={smtp.fromName} onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12}><FormControlLabel control={<Switch checked={Boolean(smtp.secure)} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} />} label="Use secure SMTP connection" /></Grid>
        </Grid>
        <Button variant="contained" startIcon={<SaveIcon />} sx={{ mt: 2.5 }} onClick={save}>Save SMTP Settings</Button>
      </Paper>
    </Stack>
  );
}
