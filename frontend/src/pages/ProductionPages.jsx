import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, LinearProgress,
  Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BackupIcon from '@mui/icons-material/Backup';
import BusinessIcon from '@mui/icons-material/Business';
import DownloadIcon from '@mui/icons-material/Download';
import EmailIcon from '@mui/icons-material/Email';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SecurityIcon from '@mui/icons-material/Security';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import {
  enqueueMessage, exportBackup, getAuditLogs, getBackups, getNotifications, getQueue, getQueueStats,
  getReportsSummary, getSettings, markNotificationRead, processQueue, saveSetting
} from '../services/production.service';

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

function flattenReport(summary = {}, audit = []) {
  const rows = [['Section', 'Metric', 'Value']];
  Object.entries(summary || {}).forEach(([section, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value).forEach(([metric, metricValue]) => rows.push([section, metric, JSON.stringify(metricValue)]));
    } else {
      rows.push(['summary', section, JSON.stringify(value)]);
    }
  });
  audit.forEach((row) => rows.push(['audit', row.action || '-', `${row.entityType || '-'} ${row.path || ''}`.trim()]));
  return rows;
}

function exportExcel(summary, audit) {
  const rows = flattenReport(summary, audit);
  const htmlRows = rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell).replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]))}</td>`).join('')}</tr>`).join('');
  downloadFile('crm-report.xls', `<table>${htmlRows}</table>`, 'application/vnd.ms-excel');
}

function exportPdf(summary, audit) {
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) return;
  reportWindow.document.write(`
    <html>
      <head><title>CRM Report</title><style>body{font-family:Arial,sans-serif;padding:24px}pre{white-space:pre-wrap}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style></head>
      <body>
        <h1>CRM Report</h1>
        <h2>Summary</h2>
        <pre>${JSON.stringify(summary, null, 2)}</pre>
        <h2>Audit Logs</h2>
        <table><thead><tr><th>Action</th><th>Entity</th><th>User</th><th>Path</th></tr></thead><tbody>
          ${audit.map((row) => `<tr><td>${row.action || '-'}</td><td>${row.entityType || '-'}</td><td>${row.userId || '-'}</td><td>${row.path || '-'}</td></tr>`).join('')}
        </tbody></table>
      </body>
    </html>
  `);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
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
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('{}');
  const [backups, setBackups] = useState([]);
  const load = async () => {
    setRows((await getSettings()).data.data || []);
    setBackups((await getBackups()).data.data || []);
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    await saveSetting(editing.namespace, editing.key, JSON.parse(value));
    setEditing(null);
    await load();
  };
  const adminLinks = [
    { title: 'Company Profile', path: '/company-profile', icon: <BusinessIcon />, text: 'Logo, contact details, address, and branding.' },
    { title: 'SMTP Settings', path: '/smtp-settings', icon: <EmailIcon />, text: 'Outgoing mail host, credentials, and sender identity.' },
    { title: 'Connect WhatsApp', path: '/connect-whatsapp', icon: <WhatsAppIcon />, text: 'Cloud API credentials, webhook, and test sending.' },
    { title: 'User Manager', path: '/users', icon: <ManageAccountsIcon />, text: 'Users, roles, status, and password resets.' },
    { title: 'Permissions', path: '/permissions', icon: <SecurityIcon />, text: 'Role permissions and module access.' }
  ];

  return <Stack spacing={2.5}><Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}><Stack direction={{ xs: 'column', md: 'row' }} spacing={2}><Box sx={{ flex: 1 }}><Typography variant="h5" fontWeight={850}>Admin Settings</Typography><Typography color="text.secondary">Company profile, WhatsApp, SMTP, permissions, branding, and backups.</Typography></Box><Button startIcon={<BackupIcon />} onClick={async () => { await exportBackup(); await load(); }}>Export Backup</Button></Stack></Paper><Grid container spacing={2}>{adminLinks.map((item) => <Grid item xs={12} sm={6} lg={4} key={item.path}><Paper component={Link} to={item.path} sx={{ p: 2.5, border: '1px solid #e8edf2', display: 'block', textDecoration: 'none', color: 'text.primary', height: '100%' }} elevation={0}><Stack direction="row" spacing={1.5} alignItems="center"><Box sx={{ color: 'success.main' }}>{item.icon}</Box><Typography fontWeight={850}>{item.title}</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{item.text}</Typography></Paper></Grid>)}</Grid><Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}><Typography variant="h6" fontWeight={850} sx={{ mb: 1 }}>Advanced Settings</Typography><Grid container spacing={2}>{rows.map((row) => <Grid item xs={12} md={6} key={row.id}><Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}><Typography fontWeight={850}>{row.namespace}.{row.key}</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.value, null, 2)}</Typography><Button sx={{ mt: 1 }} onClick={() => { setEditing(row); setValue(JSON.stringify(row.value, null, 2)); }}>Edit JSON</Button></Paper></Grid>)}</Grid></Paper><Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}><Typography variant="h6" fontWeight={850}>Backups</Typography>{backups.map((job) => <Typography key={job.id} variant="body2">{job.id} - {job.status} - {job.filePath || '-'}</Typography>)}</Paper><Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="md" fullWidth><DialogTitle>Edit Setting</DialogTitle><DialogContent><JsonField value={value} onChange={setValue} /></DialogContent><DialogActions><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="contained" onClick={save}>Save</Button></DialogActions></Dialog></Stack>;
}

export function ReportsPage() {
  const [summary, setSummary] = useState(null);
  const [audit, setAudit] = useState([]);
  useEffect(() => { getReportsSummary().then((res) => setSummary(res.data.data)); getAuditLogs({ limit: 50 }).then((res) => setAudit(res.data.data || [])); }, []);
  return <Stack spacing={2.5}><Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}><Box sx={{ flex: 1 }}><Typography variant="h5" fontWeight={850}>Reporting & Audit Logs</Typography><Typography color="text.secondary">Lead, student, revenue, campaign, agent performance, and user actions.</Typography></Box><Button startIcon={<DownloadIcon />} variant="outlined" onClick={() => exportPdf(summary || {}, audit)}>Export PDF</Button><Button startIcon={<DownloadIcon />} variant="contained" onClick={() => exportExcel(summary || {}, audit)}>Export Excel</Button></Stack></Paper>{summary && <Grid container spacing={2}>{Object.entries(summary).map(([key, value]) => <Grid item xs={12} md={4} key={key}><Paper sx={{ p: 2, border: '1px solid #e8edf2', height: '100%' }} elevation={0}><Typography fontWeight={850}>{key}</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(value, null, 2)}</Typography></Paper></Grid>)}</Grid>}<Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}><TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Action</TableCell><TableCell>Entity</TableCell><TableCell>User</TableCell><TableCell>Path</TableCell></TableRow></TableHead><TableBody>{audit.map((row) => <TableRow key={row.id}><TableCell>{row.action}</TableCell><TableCell>{row.entityType}</TableCell><TableCell>{row.userId || '-'}</TableCell><TableCell>{row.path}</TableCell></TableRow>)}</TableBody></Table></TableContainer></Paper></Stack>;
}
