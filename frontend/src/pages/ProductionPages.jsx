import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Alert, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid,
  IconButton, InputAdornment, LinearProgress, MenuItem, Paper, Stack, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BackupIcon from '@mui/icons-material/Backup';
import BusinessIcon from '@mui/icons-material/Business';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import EmailIcon from '@mui/icons-material/Email';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import SecurityIcon from '@mui/icons-material/Security';
import SendIcon from '@mui/icons-material/Send';
import SettingsIcon from '@mui/icons-material/Settings';
import StorageIcon from '@mui/icons-material/Storage';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import {
  downloadBackupUrl, enqueueMessage, exportBackup, getBackups, getNotifications, getQueue, getQueueStats,
  getReportByType, getReportOptions, getSettings, markNotificationRead, processQueue, saveSetting
} from '../services/production.service';
import {
  getWhatsappSettings,
  saveWhatsappSettings,
  testWhatsappConnection,
  testWhatsappSend
} from '../services/whatsappConnect.service';
import { API_BASE_URL } from '../config/apiConfig';

function JsonField({ value, onChange, minRows = 4 }) {
  return <TextField value={value} onChange={(e) => onChange(e.target.value)} multiline minRows={minRows} fullWidth />;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char]));
}

function reportTableRows(report) {
  const columns = report?.columns || [];
  const rows = report?.rows || [];
  return [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => row[column.key] ?? ''))
  ];
}

function exportReportCsv(report) {
  const csv = reportTableRows(report)
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadFile(`${report.title || 'report'}.csv`, csv, 'text/csv');
}

function exportReportExcel(report) {
  const rows = reportTableRows(report);
  const htmlRows = rows.map((row, index) => `<tr>${row.map((cell) => index === 0 ? `<th>${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
  downloadFile(`${report.title || 'report'}.xls`, `<table>${htmlRows}</table>`, 'application/vnd.ms-excel');
}

function exportReportPdf(report, filters = {}) {
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) return;
  const columns = report?.columns || [];
  const rows = report?.rows || [];
  const summary = report?.summary || [];
  const filterRows = Object.entries(filters).filter(([, value]) => value).map(([key, value]) => `<span>${escapeHtml(key)}: <strong>${escapeHtml(value)}</strong></span>`).join('');
  reportWindow.document.write(`
    <html>
      <head><title>${escapeHtml(report?.title || 'CRM Report')}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111827}.brand{font-size:13px;color:#667085;text-transform:uppercase;letter-spacing:.08em}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card{border:1px solid #e5e7eb;border-radius:8px;padding:12px}.card b{display:block;font-size:20px;margin-top:4px}.filters{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 18px}.filters span{background:#f3f4f6;border-radius:999px;padding:6px 10px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f9fafb}.footer{margin-top:24px;color:#667085;font-size:11px}@media print{button{display:none}.summary{grid-template-columns:repeat(4,1fr)}}</style></head>
      <body>
        <div class="brand">First Of Education International</div>
        <h1>${escapeHtml(report?.title || 'CRM Report')}</h1>
        <p>Generated ${new Date().toLocaleString()}</p>
        <div class="filters">${filterRows || '<span>No filters selected</span>'}</div>
        <div class="summary">${summary.map((item) => `<div class="card">${escapeHtml(item.label)}<b>${escapeHtml(item.value)}</b></div>`).join('')}</div>
        <table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>
          ${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key] ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length || 1}">No data available</td></tr>`}
        </tbody></table>
        <div class="footer">Generated by CRM Report Center</div>
      </body>
    </html>
  `);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function mergeReportOptions(fallbackOptions, apiOptions = {}) {
  return Object.fromEntries(Object.entries(fallbackOptions).map(([key, fallbackValue]) => [
    key,
    Array.isArray(apiOptions[key]) ? apiOptions[key] : fallbackValue
  ]));
}

export function QueuePage() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [formOpen, setFormOpen] = useState(false);
  const [payload, setPayload] = useState('{"messageType":"text","to":"+94770000000","payload":{"text":"Production queue test"}}');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    const [queueRes, statsRes] = await Promise.all([getQueue(), getQueueStats()]);
    setRows(queueRes.data.data || []);
    setStats(statsRes.data.data || {});
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    await enqueueMessage(JSON.parse(payload));
    setFormOpen(false);
    setNotice('Message queued.');
    await load();
  };

  const run = async () => {
    await processQueue(5);
    setNotice('Queue worker processed due messages.');
    await load();
  };

  return <Stack spacing={2.5}>
    {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
    <Grid container spacing={2}>{Object.entries(stats).map(([key, value]) => <Grid item xs={6} md={3} key={key}><Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}><Typography variant="h4" fontWeight={850}>{value}</Typography><Typography color="text.secondary">{key}</Typography></Paper></Grid>)}</Grid>
    <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}><Stack direction={{ xs: 'column', md: 'row' }} spacing={2}><Box sx={{ flex: 1 }}><Typography variant="h5" fontWeight={850}>Message Queue</Typography><Typography color="text.secondary">Retry, rate-limit, and process WhatsApp sends in the background.</Typography></Box><Button startIcon={<PlayArrowIcon />} onClick={run}>Process Now</Button><Button variant="contained" startIcon={<AddIcon />} onClick={() => setFormOpen(true)}>Queue Message</Button></Stack></Paper>
    <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>{loading && <LinearProgress />}<TableContainer><Table><TableHead><TableRow><TableCell>ID</TableCell><TableCell>Type</TableCell><TableCell>To</TableCell><TableCell>Status</TableCell><TableCell>Attempts</TableCell><TableCell>Error</TableCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>{row.id}</TableCell><TableCell>{row.messageType}</TableCell><TableCell>{row.toNumber}</TableCell><TableCell><Chip size="small" label={row.status} /></TableCell><TableCell>{row.attempts}/{row.maxAttempts}</TableCell><TableCell>{row.lastError || '-'}</TableCell></TableRow>)}</TableBody></Table></TableContainer></Paper>
    <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="md" fullWidth><DialogTitle>Queue WhatsApp Message</DialogTitle><DialogContent><JsonField value={payload} onChange={setPayload} /></DialogContent><DialogActions><Button onClick={() => setFormOpen(false)}>Cancel</Button><Button variant="contained" onClick={submit}>Queue</Button></DialogActions></Dialog>
  </Stack>;
}

export function NotificationsPage() {
  const [rows, setRows] = useState([]);
  const load = async () => setRows((await getNotifications()).data.data || []);
  useEffect(() => { load(); }, []);
  return <Stack spacing={2.5}><Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}><Typography variant="h5" fontWeight={850}>Notification Center</Typography><Typography color="text.secondary">Lead assignments, reminders, appointments, and fee alerts.</Typography></Paper><Paper sx={{ border: '1px solid #e8edf2' }} elevation={0}><TableContainer><Table><TableHead><TableRow><TableCell>Title</TableCell><TableCell>Type</TableCell><TableCell>Message</TableCell><TableCell>Status</TableCell><TableCell /></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>{row.title}</TableCell><TableCell>{row.type}</TableCell><TableCell>{row.message || '-'}</TableCell><TableCell>{row.readAt ? 'Read' : 'Unread'}</TableCell><TableCell><Button size="small" onClick={async () => { await markNotificationRead(row.id); await load(); }}>Mark read</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer></Paper></Stack>;
}

export function ProductionSettingsPage() {
  const location = useLocation();
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || 'company');
  const [settings, setSettings] = useState({});
  const [company, setCompany] = useState({ name: '', phone: '', email: '', address: '', website: '', logoUrl: '' });
  const [branding, setBranding] = useState({ primaryColor: '#25d366', sidebarColor: '#0b1f1a', logoUrl: '', darkModeDefault: false });
  const [whatsapp, setWhatsapp] = useState({ accessToken: '', phoneNumberId: '', businessAccountId: '', verifyToken: '', webhookUrl: '' });
  const [smtp, setSmtp] = useState({ host: '', port: 587, username: '', password: '', secure: false, fromEmail: '', fromName: '' });
  const [security, setSecurity] = useState({ timeoutMinutes: 120, passwordMinLength: 6, requireStrongPassword: false, loginHistoryEnabled: true });
  const [assignmentNotificationsEnabled, setAssignmentNotificationsEnabled] = useState(true);
  const [backups, setBackups] = useState([]);
  const [showSecrets, setShowSecrets] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('Settings test message');
  const [testEmail, setTestEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const backendUrl = API_BASE_URL;
  const frontendUrl = window.location.origin;
  const appVersion = process.env.REACT_APP_VERSION || '0.1.0';

  const settingMap = (rows) => rows.reduce((acc, row) => {
    acc[`${row.namespace}.${row.key}`] = row.value || {};
    return acc;
  }, {});

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [settingsRes, backupsRes, whatsappRes] = await Promise.all([
        getSettings(),
        getBackups(),
        getWhatsappSettings().catch(() => ({ data: { data: {} } }))
      ]);
      const map = settingMap(settingsRes.data.data || []);
      const companyProfile = map['company.profile'] || {};
      const brandingTheme = map['branding.theme'] || {};
      const smtpSettings = map['smtp.settings'] || {};
      const securitySession = map['security.session'] || {};
      const whatsappSettings = whatsappRes.data.data || map['whatsapp.cloud_api'] || {};
      const assignmentSettings = map['notifications.assignments'] || {};

      setSettings(map);
      setCompany({
        name: companyProfile.name || '',
        phone: companyProfile.phone || '',
        email: companyProfile.email || '',
        address: companyProfile.address || '',
        website: companyProfile.website || '',
        logoUrl: companyProfile.logoUrl || brandingTheme.logoUrl || ''
      });
      setBranding({
        primaryColor: brandingTheme.primaryColor || '#25d366',
        sidebarColor: brandingTheme.sidebarColor || '#0b1f1a',
        logoUrl: brandingTheme.logoUrl || companyProfile.logoUrl || '',
        darkModeDefault: Boolean(brandingTheme.darkModeDefault)
      });
      setWhatsapp({
        accessToken: whatsappSettings.accessToken || '',
        phoneNumberId: whatsappSettings.phoneNumberId || '',
        businessAccountId: whatsappSettings.businessAccountId || '',
        verifyToken: whatsappSettings.verifyToken || '',
        webhookUrl: whatsappSettings.webhookUrl || `${backendUrl}/webhooks/whatsapp`,
        status: whatsappSettings.status || 'Not Connected'
      });
      setSmtp({
        host: smtpSettings.host || '',
        port: smtpSettings.port || 587,
        username: smtpSettings.username || '',
        password: smtpSettings.password || '',
        secure: Boolean(smtpSettings.secure),
        fromEmail: smtpSettings.fromEmail || '',
        fromName: smtpSettings.fromName || ''
      });
      setSecurity({
        timeoutMinutes: securitySession.timeoutMinutes || 120,
        passwordMinLength: securitySession.passwordMinLength || 6,
        requireStrongPassword: Boolean(securitySession.requireStrongPassword),
        loginHistoryEnabled: securitySession.loginHistoryEnabled !== false
      });
      setAssignmentNotificationsEnabled(assignmentSettings.assignmentNotificationsEnabled !== false);
      setBackups(backupsRes.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    setTab(new URLSearchParams(location.search).get('tab') || 'company');
  }, [location.search]);

  const mask = (value) => {
    if (!value) return '';
    if (showSecrets) return value;
    if (String(value).includes('****')) return value;
    return `${String(value).slice(0, 4)}****${String(value).slice(-4)}`;
  };

  const secretProps = (field, value, setter, object) => ({
    type: showSecrets ? 'text' : 'password',
    value: showSecrets ? value : mask(value),
    onChange: (event) => setter({ ...object, [field]: event.target.value }),
    InputProps: {
      endAdornment: (
        <InputAdornment position="end">
          <IconButton onClick={() => setShowSecrets((current) => !current)} edge="end">
            {showSecrets ? <VisibilityOffIcon /> : <VisibilityIcon />}
          </IconButton>
        </InputAdornment>
      )
    }
  });

  const uploadLogo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCompany((current) => ({ ...current, logoUrl: reader.result }));
      setBranding((current) => ({ ...current, logoUrl: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const saveCompany = async () => {
    await saveSetting('company', 'profile', company);
    await saveSetting('branding', 'theme', { ...branding, logoUrl: company.logoUrl || branding.logoUrl });
    setNotice('Company profile saved.');
  };

  const saveBranding = async () => {
    await saveSetting('branding', 'theme', branding);
    setNotice('Branding saved.');
  };

  const saveWhatsapp = async () => {
    await Promise.all([
      saveWhatsappSettings({
        ...whatsapp,
        accessToken: String(whatsapp.accessToken).includes('****') ? '' : whatsapp.accessToken
      }),
      saveSetting('notifications', 'assignments', { assignmentNotificationsEnabled })
    ]);
    setNotice('WhatsApp API settings saved.');
  };

  const saveSmtp = async () => {
    const current = settings['smtp.settings'] || {};
    await saveSetting('smtp', 'settings', {
      ...smtp,
      password: String(smtp.password).includes('****') ? current.password || '' : smtp.password
    });
    setNotice('SMTP settings saved.');
  };

  const saveSecurity = async () => {
    await saveSetting('security', 'session', security);
    setNotice('Security settings saved.');
  };

  const runBackup = async () => {
    await exportBackup();
    setNotice('Backup exported.');
    await load();
  };

  const runWhatsappTest = async () => {
    await testWhatsappConnection();
    setNotice('WhatsApp connection test succeeded.');
    await load();
  };

  const runTestSend = async () => {
    await testWhatsappSend({ to: testPhone, message: testMessage });
    setNotice('WhatsApp test message request completed.');
  };

  const runTestEmail = async () => {
    if (!testEmail) {
      setError('Enter a test email address first.');
      return;
    }
    setNotice('SMTP settings look ready. A real send endpoint is not configured yet.');
  };

  const copy = async (value, label) => {
    await navigator.clipboard.writeText(value || '');
    setNotice(`${label} copied.`);
  };

  const submit = async (handler) => {
    setError('');
    try {
      await handler();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save settings.');
    }
  };

  const latestBackup = backups.find((backup) => backup.status === 'completed') || backups[0];

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {loading && <LinearProgress />}
      <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>Settings</Typography>
            <Typography color="text.secondary">Manage company, branding, integrations, security, backups, and system status.</Typography>
          </Box>
          <Button variant="contained" startIcon={<BackupIcon />} onClick={() => submit(runBackup)}>Export Backup</Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }} elevation={0}>
        <Box sx={{ p: { xs: 2, md: 3 } }}>
          {tab === 'company' && (
            <Grid container spacing={2.5}>
              <Grid item xs={12} md={3}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                  <Avatar src={company.logoUrl || branding.logoUrl} sx={{ width: 110, height: 110, mx: 'auto', mb: 2 }}>{company.name?.charAt(0) || 'C'}</Avatar>
                  <Button component="label" variant="outlined" fullWidth>
                    Upload Logo
                    <input hidden accept="image/*" type="file" onChange={uploadLogo} />
                  </Button>
                </Paper>
              </Grid>
              <Grid item xs={12} md={9}>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}><TextField label="Company name" value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} fullWidth /></Grid>
                  <Grid item xs={12} md={6}><TextField label="Website" value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} fullWidth /></Grid>
                  <Grid item xs={12} md={6}><TextField label="Phone" value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} fullWidth /></Grid>
                  <Grid item xs={12} md={6}><TextField label="Email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} fullWidth /></Grid>
                  <Grid item xs={12}><TextField label="Address" value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} fullWidth multiline minRows={3} /></Grid>
                </Grid>
                <Button sx={{ mt: 2 }} variant="contained" startIcon={<SaveIcon />} onClick={() => submit(saveCompany)}>Save Company Profile</Button>
              </Grid>
            </Grid>
          )}

          {tab === 'branding' && (
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}><TextField label="Primary color" type="color" value={branding.primaryColor} onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })} fullWidth /></Grid>
              <Grid item xs={12} md={4}><TextField label="Sidebar color" type="color" value={branding.sidebarColor} onChange={(e) => setBranding({ ...branding, sidebarColor: e.target.value })} fullWidth /></Grid>
              <Grid item xs={12} md={4}><FormControlLabel control={<Switch checked={branding.darkModeDefault} onChange={(e) => setBranding({ ...branding, darkModeDefault: e.target.checked })} />} label="Dark mode default" /></Grid>
              <Grid item xs={12}>
                <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', bgcolor: branding.sidebarColor, color: '#fff' }}>
                  <Avatar src={branding.logoUrl || company.logoUrl}>{company.name?.charAt(0) || 'C'}</Avatar>
                  <Box><Typography fontWeight={850}>{company.name || 'Company Name'}</Typography><Typography variant="body2">Logo preview</Typography></Box>
                </Paper>
              </Grid>
              <Grid item xs={12}><Button variant="contained" startIcon={<SaveIcon />} onClick={() => submit(saveBranding)}>Save Branding</Button></Grid>
            </Grid>
          )}

          {tab === 'whatsapp' && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Switch checked={assignmentNotificationsEnabled} onChange={(e) => setAssignmentNotificationsEnabled(e.target.checked)} />}
                  label="Send WhatsApp notification when chat is assigned"
                />
              </Grid>
              <Grid item xs={12} md={6}><TextField label="Access token" fullWidth {...secretProps('accessToken', whatsapp.accessToken, setWhatsapp, whatsapp)} /></Grid>
              <Grid item xs={12} md={6}><TextField label="Phone number ID" value={whatsapp.phoneNumberId} onChange={(e) => setWhatsapp({ ...whatsapp, phoneNumberId: e.target.value })} fullWidth /></Grid>
              <Grid item xs={12} md={6}><TextField label="Business account ID" value={whatsapp.businessAccountId} onChange={(e) => setWhatsapp({ ...whatsapp, businessAccountId: e.target.value })} fullWidth /></Grid>
              <Grid item xs={12} md={6}><TextField label="Verify token" fullWidth {...secretProps('verifyToken', whatsapp.verifyToken, setWhatsapp, whatsapp)} /></Grid>
              <Grid item xs={12}><TextField label="Webhook callback URL" value={whatsapp.webhookUrl} onChange={(e) => setWhatsapp({ ...whatsapp, webhookUrl: e.target.value })} fullWidth InputProps={{ endAdornment: <InputAdornment position="end"><Tooltip title="Copy"><IconButton onClick={() => copy(whatsapp.webhookUrl, 'Webhook URL')}><ContentCopyIcon /></IconButton></Tooltip></InputAdornment> }} /></Grid>
              <Grid item xs={12} md={6}><TextField label="Test phone" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} fullWidth /></Grid>
              <Grid item xs={12} md={6}><TextField label="Test message" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} fullWidth /></Grid>
              <Grid item xs={12}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}><Button variant="contained" startIcon={<SaveIcon />} onClick={() => submit(saveWhatsapp)}>Save WhatsApp API</Button><Button variant="outlined" onClick={() => submit(runWhatsappTest)}>Test Connection</Button><Button variant="outlined" startIcon={<SendIcon />} onClick={() => submit(runTestSend)} disabled={!testPhone}>Test Send Message</Button></Stack></Grid>
            </Grid>
          )}

          {tab === 'smtp' && (
            <Grid container spacing={2}>
              <Grid item xs={12} md={8}><TextField label="Host" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} fullWidth /></Grid>
              <Grid item xs={12} md={4}><TextField label="Port" type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} fullWidth /></Grid>
              <Grid item xs={12} md={6}><TextField label="Username" value={smtp.username} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} fullWidth /></Grid>
              <Grid item xs={12} md={6}><TextField label="Password" fullWidth {...secretProps('password', smtp.password, setSmtp, smtp)} /></Grid>
              <Grid item xs={12} md={6}><TextField label="From email" value={smtp.fromEmail} onChange={(e) => setSmtp({ ...smtp, fromEmail: e.target.value })} fullWidth /></Grid>
              <Grid item xs={12} md={6}><TextField label="Test email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} fullWidth /></Grid>
              <Grid item xs={12}><FormControlLabel control={<Switch checked={smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} />} label="Secure SMTP connection" /></Grid>
              <Grid item xs={12}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}><Button variant="contained" startIcon={<SaveIcon />} onClick={() => submit(saveSmtp)}>Save SMTP</Button><Button variant="outlined" startIcon={<SendIcon />} onClick={() => submit(runTestEmail)}>Test Email</Button></Stack></Grid>
            </Grid>
          )}

          {tab === 'security' && (
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}><TextField label="Session timeout minutes" type="number" value={security.timeoutMinutes} onChange={(e) => setSecurity({ ...security, timeoutMinutes: Number(e.target.value) })} fullWidth /></Grid>
              <Grid item xs={12} md={6}><TextField label="Password minimum length" type="number" value={security.passwordMinLength} onChange={(e) => setSecurity({ ...security, passwordMinLength: Number(e.target.value) })} fullWidth /></Grid>
              <Grid item xs={12} md={6}><FormControlLabel control={<Switch checked={security.requireStrongPassword} onChange={(e) => setSecurity({ ...security, requireStrongPassword: e.target.checked })} />} label="Require strong password" /></Grid>
              <Grid item xs={12} md={6}><FormControlLabel control={<Switch checked={security.loginHistoryEnabled} onChange={(e) => setSecurity({ ...security, loginHistoryEnabled: e.target.checked })} />} label="Login history enabled" /></Grid>
              <Grid item xs={12}><Button variant="contained" startIcon={<SaveIcon />} onClick={() => submit(saveSecurity)}>Save Security Settings</Button></Grid>
            </Grid>
          )}

          {tab === 'backup' && (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="h6" fontWeight={850}>Backup</Typography>
                <Typography color="text.secondary">Last backup: {latestBackup?.createdAt ? new Date(latestBackup.createdAt).toLocaleString() : 'No backups yet'}</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
                  <Button variant="contained" startIcon={<BackupIcon />} onClick={() => submit(runBackup)}>Export Backup</Button>
                  <Button variant="outlined" startIcon={<DownloadIcon />} disabled={!latestBackup?.filePath} href={latestBackup?.id ? downloadBackupUrl(latestBackup.id) : undefined}>Download Backup File</Button>
                </Stack>
              </Paper>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small"><TableHead><TableRow><TableCell>ID</TableCell><TableCell>Status</TableCell><TableCell>Created</TableCell><TableCell>File</TableCell></TableRow></TableHead><TableBody>{backups.map((backup) => <TableRow key={backup.id}><TableCell>{backup.id}</TableCell><TableCell><Chip size="small" label={backup.status} /></TableCell><TableCell>{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : '-'}</TableCell><TableCell>{backup.filePath || '-'}</TableCell></TableRow>)}</TableBody></Table>
              </TableContainer>
            </Stack>
          )}

          {tab === 'system' && (
            <Grid container spacing={2}>
              {[
                ['Backend URL', backendUrl],
                ['Frontend URL', frontendUrl],
                ['Database status', Object.keys(settings).length ? 'Connected' : 'Unknown'],
                ['WhatsApp status', whatsapp.status || (whatsapp.phoneNumberId ? 'Configured' : 'Not Connected')],
                ['App version', appVersion]
              ].map(([label, value]) => <Grid item xs={12} md={6} key={label}><Paper variant="outlined" sx={{ p: 2 }}><Typography color="text.secondary">{label}</Typography><Typography fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>{value}</Typography></Paper></Grid>)}
            </Grid>
          )}
        </Box>
      </Paper>
    </Stack>
  );
}

export function ReportsPage() {
  const fallbackOptions = {
    courses: [],
    batches: [],
    agents: [],
    leadStatuses: ['New', 'Contacted', 'Interested', 'Not Interested', 'Converted', 'Lost'],
    leadSources: ['Facebook Ads', 'WhatsApp Ads', 'Website', 'Instagram', 'TikTok', 'Google Search', 'Referral', 'Organic', 'Manual Entry'],
    studentStatuses: ['enrolled', 'active', 'pending', 'completed', 'dropped', 'suspended'],
    paymentStatuses: ['paid', 'pending', 'partial', 'overdue', 'cancelled'],
    paymentMethods: ['Cash', 'Bank Deposit', 'Bank Transfer', 'Card', 'Online Payment', 'Cheque', 'Other'],
    campaignStatuses: ['Draft', 'Scheduled', 'Processing', 'Completed', 'Failed', 'Cancelled', 'simulated_sent'],
    attendanceStatuses: ['Present', 'Absent', 'Late', 'Excused'],
    departments: [],
    whatsappAccounts: []
  };
  const reportTypes = [
    ['overview', 'Overview Report'],
    ['leads', 'Lead Report'],
    ['students', 'Student Report'],
    ['finance', 'Finance Report'],
    ['daily-collection', 'Daily Collection Report'],
    ['monthly-revenue', 'Monthly Revenue Report'],
    ['outstanding', 'Fee Outstanding Report'],
    ['overdue-installments', 'Overdue Installment Report'],
    ['fee-reminders', 'Fee Reminder Report'],
    ['class-reminders', 'Class Reminder Report'],
    ['automations', 'Automation Report'],
    ['attendance-alerts', 'Attendance Alert Report'],
    ['birthday-wishes', 'Birthday Wish Report'],
    ['compliance', 'WhatsApp Compliance Report'],
    ['campaigns', 'Campaign Report'],
    ['campaign-roi', 'Campaign ROI Report'],
    ['agents', 'Agent Performance Report'],
    ['course-income', 'Course Income Report'],
    ['batch-income', 'Batch Income Report'],
    ['attendance', 'Attendance Summary Report'],
    ['student-completion', 'Student Completion Report'],
    ['lead-source-conversion', 'Lead Source Conversion Report'],
    ['follow-up-pending', 'Follow-up Pending Report']
  ];
  const blankFilters = {
    fromDate: '',
    toDate: '',
    courseId: '',
    batchId: '',
    agentId: '',
    leadStatus: '',
    leadSource: '',
    studentStatus: '',
    paymentStatus: '',
    paymentMethod: '',
    campaignStatus: '',
    attendanceStatus: '',
    departmentId: '',
    whatsappAccountId: ''
  };
  const [reportType, setReportType] = useState('overview');
  const [filters, setFilters] = useState(blankFilters);
  const [options, setOptions] = useState(fallbackOptions);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReport = async (nextType = reportType, nextFilters = filters) => {
    try {
      setLoading(true);
      setError('');
      const typeKey = reportTypes.some(([value]) => value === nextType) ? nextType : 'overview';
      if (process.env.NODE_ENV === 'development') {
        console.debug('reports:request', { type: typeKey, filters: nextFilters });
      }
      const response = await getReportByType(typeKey, nextFilters);
      setReport(response.data.data);
      if (process.env.NODE_ENV === 'development') {
        console.debug('reports:response', { type: typeKey, rows: response.data.data?.rows?.length || 0 });
      }
    } catch (err) {
      console.error('Report API failed', err.response?.data || err);
      setError(err.response?.data?.message || 'Unable to load report.');
      setReport({
        title: reportTypes.find(([value]) => value === nextType)?.[1] || 'Report',
        filters: nextFilters,
        summary: [],
        columns: [],
        rows: [],
        charts: []
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getReportOptions()
      .then((response) => {
        const nextOptions = mergeReportOptions(fallbackOptions, response.data.data || {});
        if (process.env.NODE_ENV === 'development') {
          console.debug('reports:options', {
            courses: nextOptions.courses.length,
            batches: nextOptions.batches.length,
            agents: nextOptions.agents.length
          });
        }
        setOptions(nextOptions);
        setFilters((current) => ({
          ...current,
          courseId: current.courseId && !nextOptions.courses.some((course) => String(course.id) === String(current.courseId)) ? '' : current.courseId,
          batchId: current.batchId && !nextOptions.batches.some((batch) => String(batch.id) === String(current.batchId)) ? '' : current.batchId,
          agentId: current.agentId && !nextOptions.agents.some((agent) => String(agent.id) === String(current.agentId)) ? '' : current.agentId
        }));
      })
      .catch((err) => {
        console.error('Report options API failed', err.response?.data || err);
        setOptions(fallbackOptions);
        setError('Report filters loaded with defaults.');
      });
    loadReport('overview', blankFilters);
  }, []);

  const updateFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }));
  const clearFilters = () => {
    setFilters(blankFilters);
    loadReport(reportType, blankFilters);
  };
  const activeFilters = Object.entries(filters).filter(([, value]) => value);
  const filteredBatches = filters.courseId
    ? (options.batches || []).filter((batch) => String(batch.courseId) === String(filters.courseId))
    : (options.batches || []);
  const maxChart = Math.max(1, ...(report?.charts || []).map((row) => Number(row.value || 0)));

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} alignItems={{ lg: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>Report Center</Typography>
            <Typography color="text.secondary">Filtered operational, education, finance, campaign, and agent reports.</Typography>
          </Box>
          <Button startIcon={<DownloadIcon />} variant="outlined" disabled={!report} onClick={() => exportReportPdf(report, filters)}>Export PDF</Button>
          <Button startIcon={<DownloadIcon />} variant="outlined" disabled={!report} onClick={() => exportReportCsv(report)}>Export CSV</Button>
          <Button startIcon={<DownloadIcon />} variant="contained" disabled={!report} onClick={() => exportReportExcel(report)}>Export Excel</Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}><TextField select label="Report Type" value={reportType} onChange={(e) => { setReportType(e.target.value); loadReport(e.target.value, filters); }} fullWidth>{reportTypes.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField type="date" label="From Date" value={filters.fromDate} onChange={(e) => updateFilter('fromDate', e.target.value)} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
          <Grid item xs={12} md={4}><TextField type="date" label="To Date" value={filters.toDate} onChange={(e) => updateFilter('toDate', e.target.value)} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
          <Grid item xs={12} md={4}><TextField select label="Course" value={filters.courseId || ''} onChange={(e) => setFilters((current) => ({ ...current, courseId: e.target.value, batchId: '' }))} fullWidth><MenuItem value="">All Courses</MenuItem>{(options.courses || []).map((course) => <MenuItem key={course.id} value={course.id}>{[course.code, course.name, course.category].filter(Boolean).join(' - ')}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Batch" value={filters.batchId || ''} onChange={(e) => updateFilter('batchId', e.target.value)} fullWidth><MenuItem value="">All Batches</MenuItem>{filteredBatches.map((batch) => <MenuItem key={batch.id} value={batch.id}>{[batch.name, batch.courseName || batch.course?.name, batch.schedule].filter(Boolean).join(' - ')}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Agent" value={filters.agentId || ''} onChange={(e) => updateFilter('agentId', e.target.value)} fullWidth><MenuItem value="">All Agents</MenuItem>{(options.agents || []).map((agent) => <MenuItem key={agent.id} value={agent.id}>{[agent.name, agent.department].filter(Boolean).join(' - ')}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Department" value={filters.departmentId || ''} onChange={(e) => updateFilter('departmentId', e.target.value)} fullWidth><MenuItem value="">All Departments</MenuItem>{(options.departments || []).map((department) => <MenuItem key={department.id} value={department.id}>{department.name}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="WhatsApp Account" value={filters.whatsappAccountId || ''} onChange={(e) => updateFilter('whatsappAccountId', e.target.value)} fullWidth><MenuItem value="">All WhatsApp Accounts</MenuItem>{(options.whatsappAccounts || []).map((account) => <MenuItem key={account.id} value={account.id}>{account.name}{account.phoneNumber ? ` · ${account.phoneNumber}` : ''}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Lead Status" value={filters.leadStatus} onChange={(e) => updateFilter('leadStatus', e.target.value)} fullWidth><MenuItem value="">All Statuses</MenuItem>{(options.leadStatuses || []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Lead Source" value={filters.leadSource} onChange={(e) => updateFilter('leadSource', e.target.value)} fullWidth><MenuItem value="">All Sources</MenuItem>{(options.leadSources || []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Student Status" value={filters.studentStatus} onChange={(e) => updateFilter('studentStatus', e.target.value)} fullWidth><MenuItem value="">All Statuses</MenuItem>{(options.studentStatuses || []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Payment Status" value={filters.paymentStatus} onChange={(e) => updateFilter('paymentStatus', e.target.value)} fullWidth><MenuItem value="">All Statuses</MenuItem>{(options.paymentStatuses || []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Payment Method" value={filters.paymentMethod} onChange={(e) => updateFilter('paymentMethod', e.target.value)} fullWidth><MenuItem value="">All Methods</MenuItem>{(options.paymentMethods || []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Campaign Status" value={filters.campaignStatus} onChange={(e) => updateFilter('campaignStatus', e.target.value)} fullWidth><MenuItem value="">All Statuses</MenuItem>{(options.campaignStatuses || []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select label="Attendance Status" value={filters.attendanceStatus} onChange={(e) => updateFilter('attendanceStatus', e.target.value)} fullWidth><MenuItem value="">All Statuses</MenuItem>{(options.attendanceStatuses || []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12}><Stack direction="row" spacing={1.5} flexWrap="wrap"><Button variant="contained" onClick={() => loadReport()}>Apply Filters</Button><Button variant="outlined" onClick={clearFilters}>Clear Filters</Button></Stack></Grid>
        </Grid>
      </Paper>

      {loading && <LinearProgress />}

      {report && (
        <Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}>
          <Stack spacing={1}>
            <Typography variant="h6" fontWeight={850}>{report.title}</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {activeFilters.length === 0 && <Chip size="small" label="No filters selected" />}
              {activeFilters.map(([key, value]) => <Chip size="small" key={key} label={`${key}: ${value}`} />)}
            </Stack>
          </Stack>
        </Paper>
      )}

      <Grid container spacing={2}>
        {(report?.summary || []).map((item) => (
          <Grid item xs={12} sm={6} md={3} key={item.label}><Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}><Typography variant="h5" fontWeight={850}>{item.value}</Typography><Typography color="text.secondary">{item.label}</Typography></Paper></Grid>
        ))}
      </Grid>

      {(report?.charts || []).length > 0 && (
        <Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}>
          <Typography variant="h6" fontWeight={850}>Quick Breakdown</Typography>
          <Stack spacing={1.5} sx={{ mt: 2 }}>{report.charts.map((row) => <Box key={row.label}><Stack direction="row" justifyContent="space-between"><Typography>{row.label}</Typography><Typography fontWeight={850}>{row.value}</Typography></Stack><LinearProgress variant="determinate" value={(Number(row.value || 0) / maxChart) * 100} sx={{ height: 8, borderRadius: 999, mt: 0.5 }} /></Box>)}</Stack>
        </Paper>
      )}

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow>{(report?.columns || []).map((column) => <TableCell key={column.key}>{column.label}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {(report?.rows || []).map((row, index) => (
                <TableRow key={index}>{(report?.columns || []).map((column) => <TableCell key={column.key}>{row[column.key] || '-'}</TableCell>)}</TableRow>
              ))}
              {!loading && (report?.rows || []).length === 0 && <TableRow><TableCell colSpan={(report?.columns || []).length || 1}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={850}>No data found</Typography><Typography color="text.secondary">Try changing filters or selecting another report type.</Typography></Box></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}
