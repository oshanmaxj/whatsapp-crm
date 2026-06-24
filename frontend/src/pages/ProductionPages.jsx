import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, LinearProgress,
  Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BackupIcon from '@mui/icons-material/Backup';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {
  enqueueMessage, exportBackup, getAuditLogs, getBackups, getNotifications, getQueue, getQueueStats,
  getReportsSummary, getSettings, markNotificationRead, processQueue, saveSetting
} from '../services/production.service';

function JsonField({ value, onChange, minRows = 4 }) {
  return <TextField value={value} onChange={(e) => onChange(e.target.value)} multiline minRows={minRows} fullWidth />;
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
  return <Stack spacing={2.5}><Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}><Stack direction={{ xs: 'column', md: 'row' }} spacing={2}><Box sx={{ flex: 1 }}><Typography variant="h5" fontWeight={850}>Production Settings</Typography><Typography color="text.secondary">Company profile, WhatsApp, SMTP, permissions, branding, backups.</Typography></Box><Button startIcon={<BackupIcon />} onClick={async () => { await exportBackup(); await load(); }}>Export Backup</Button></Stack></Paper><Grid container spacing={2}>{rows.map((row) => <Grid item xs={12} md={6} key={row.id}><Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}><Typography fontWeight={850}>{row.namespace}.{row.key}</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.value, null, 2)}</Typography><Button sx={{ mt: 1 }} onClick={() => { setEditing(row); setValue(JSON.stringify(row.value, null, 2)); }}>Edit</Button></Paper></Grid>)}</Grid><Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}><Typography variant="h6" fontWeight={850}>Backups</Typography>{backups.map((job) => <Typography key={job.id} variant="body2">{job.id} - {job.status} - {job.filePath || '-'}</Typography>)}</Paper><Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="md" fullWidth><DialogTitle>Edit Setting</DialogTitle><DialogContent><JsonField value={value} onChange={setValue} /></DialogContent><DialogActions><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="contained" onClick={save}>Save</Button></DialogActions></Dialog></Stack>;
}

export function ReportsPage() {
  const [summary, setSummary] = useState(null);
  const [audit, setAudit] = useState([]);
  useEffect(() => { getReportsSummary().then((res) => setSummary(res.data.data)); getAuditLogs({ limit: 50 }).then((res) => setAudit(res.data.data || [])); }, []);
  return <Stack spacing={2.5}><Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}><Typography variant="h5" fontWeight={850}>Reporting & Audit Logs</Typography><Typography color="text.secondary">Lead, student, revenue, campaign, agent performance, and user actions.</Typography></Paper>{summary && <Grid container spacing={2}>{Object.entries(summary).map(([key, value]) => <Grid item xs={12} md={4} key={key}><Paper sx={{ p: 2, border: '1px solid #e8edf2' }} elevation={0}><Typography fontWeight={850}>{key}</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</Typography></Paper></Grid>)}</Grid>}<Paper sx={{ border: '1px solid #e8edf2' }} elevation={0}><TableContainer><Table><TableHead><TableRow><TableCell>Action</TableCell><TableCell>Entity</TableCell><TableCell>User</TableCell><TableCell>Path</TableCell></TableRow></TableHead><TableBody>{audit.map((row) => <TableRow key={row.id}><TableCell>{row.action}</TableCell><TableCell>{row.entityType}</TableCell><TableCell>{row.userId || '-'}</TableCell><TableCell>{row.path}</TableCell></TableRow>)}</TableBody></Table></TableContainer></Paper></Stack>;
}
