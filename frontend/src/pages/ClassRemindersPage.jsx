import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Grid, LinearProgress, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tabs, TextField, Typography, Switch, FormControlLabel
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import HistoryIcon from '@mui/icons-material/History';
import SendIcon from '@mui/icons-material/Send';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  getClassReminderHistory,
  getDueClassReminders,
  sendBulkClassReminders,
  sendClassReminder
} from '../services/classReminder.service';
import { listBatches, listCourses } from '../services/education.service';
import { getSettings, saveSetting } from '../services/production.service';

const tabLabels = ['Upcoming', 'Today', 'One Hour', 'Sent', 'Failed', 'History'];
const reminderTypes = ['day_before', 'same_day_morning', 'one_hour_before', 'manual'];
const statuses = ['pending', 'sent', 'failed', 'cancelled'];
const defaultSettings = {
  class_reminder_auto_send_enabled: false,
  class_reminder_day_before_enabled: true,
  class_reminder_same_day_enabled: true,
  class_reminder_one_hour_enabled: true
};

function dateText(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function reminderStudent(row) {
  return row.student || {};
}

function ClassReminderTable({ rows, onSend, sending }) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            {['Student', 'Course', 'Batch', 'Class Date', 'Type', 'Scheduled', 'Status', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const student = reminderStudent(row);
            return (
              <TableRow key={row.id} hover>
                <TableCell>{student.name || '-'}</TableCell>
                <TableCell>{row.batch?.course?.name || '-'}</TableCell>
                <TableCell>{row.batch?.name || '-'}</TableCell>
                <TableCell>{row.scheduleDate || '-'}</TableCell>
                <TableCell><Chip size="small" label={row.reminderType} /></TableCell>
                <TableCell>{dateText(row.scheduledTime)}</TableCell>
                <TableCell><Chip size="small" label={row.status} color={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'error' : 'default'} /></TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <Button size="small" startIcon={<SendIcon />} onClick={() => onSend(row.batchId)} disabled={sending}>Send</Button>
                    <Button size="small" startIcon={<VisibilityIcon />} component={RouterLink} to={`/students/${student.id}`}>Student</Button>
                    <Button size="small" startIcon={<EventAvailableIcon />} component={RouterLink} to="/batches">Batch</Button>
                    <Button size="small" startIcon={<ChatIcon />} component={RouterLink} to="/chat">Chat</Button>
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && <TableRow><TableCell colSpan={8}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No class reminders found</Typography><Typography color="text.secondary">Generated reminders will appear here.</Typography></Box></TableCell></TableRow>}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ClassRemindersPage() {
  const [tab, setTab] = useState(0);
  const [due, setDue] = useState({ upcoming: [], today: [], due: [] });
  const [history, setHistory] = useState([]);
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [filters, setFilters] = useState({ courseId: '', batchId: '', date: '', reminderType: '', status: '' });
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const baseRows = tab === 0
    ? due.upcoming
    : tab === 1
      ? due.today
      : tab === 2
        ? due.oneHour || []
        : tab === 3
          ? history.filter((row) => row.status === 'sent')
          : tab === 4
            ? history.filter((row) => row.status === 'failed')
            : history;
  const visibleRows = useMemo(() => baseRows
    .filter((row) => !filters.courseId || String(row.batch?.courseId) === String(filters.courseId))
    .filter((row) => !filters.batchId || String(row.batchId) === String(filters.batchId))
    .filter((row) => !filters.date || row.scheduleDate === filters.date)
    .filter((row) => !filters.reminderType || row.reminderType === filters.reminderType)
    .filter((row) => !filters.status || row.status === filters.status), [baseRows, filters]);
  const filteredBatches = batches.filter((batch) => !filters.courseId || String(batch.courseId) === String(filters.courseId));

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [dueRes, historyRes, coursesRes, batchesRes, settingsRes] = await Promise.all([
        getDueClassReminders(),
        getClassReminderHistory(filters),
        listCourses(),
        listBatches(),
        getSettings()
      ]);
      setDue(dueRes.data.data || { upcoming: [], today: [], due: [] });
      setHistory(historyRes.data.data || []);
      setCourses(coursesRes.data.data || []);
      setBatches(batchesRes.data.data || []);
      const row = (settingsRes.data.data || []).find((item) => item.namespace === 'class_reminders' && item.key === 'automation');
      setSettings({ ...defaultSettings, ...(row?.value || {}) });
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load class reminders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sendOne = async (batchId) => {
    try {
      setSending(true);
      const response = await sendClassReminder(batchId);
      const result = response.data.data || {};
      setSuccess(`Batch reminder complete. Sent: ${result.sent || 0}, Failed: ${result.failed || 0}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to send reminder.');
    } finally {
      setSending(false);
    }
  };

  const sendBulk = async () => {
    try {
      setSending(true);
      const response = await sendBulkClassReminders();
      const result = response.data.data || {};
      setSuccess(`Bulk send complete. Sent: ${result.sent || 0}, Failed: ${result.failed || 0}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to send bulk reminders.');
    } finally {
      setSending(false);
    }
  };

  const updateSetting = async (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    try {
      await saveSetting('class_reminders', 'automation', next);
      setSuccess('Class reminder settings saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save class reminder settings.');
    }
  };

  return (
    <Stack spacing={2.5}>
      {loading && <LinearProgress />}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>Class Reminder Automation</Typography>
            <Typography color="text.secondary">Notify students before classes using WhatsApp compliance rules.</Typography>
          </Box>
          <Chip label={settings.class_reminder_auto_send_enabled ? 'Auto Send ON' : 'Auto Send OFF'} color={settings.class_reminder_auto_send_enabled ? 'success' : 'default'} />
          <Button variant="contained" startIcon={<SendIcon />} onClick={sendBulk} disabled={sending}>Bulk Send Due</Button>
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight={850} sx={{ mb: 1 }}>Automation Settings</Typography>
        <Grid container spacing={1}>
          <Grid item xs={12} md={3}><FormControlLabel control={<Switch checked={settings.class_reminder_auto_send_enabled} onChange={(event) => updateSetting('class_reminder_auto_send_enabled', event.target.checked)} />} label="Auto Send" /></Grid>
          <Grid item xs={12} md={3}><FormControlLabel control={<Switch checked={settings.class_reminder_day_before_enabled} onChange={(event) => updateSetting('class_reminder_day_before_enabled', event.target.checked)} />} label="Day Before" /></Grid>
          <Grid item xs={12} md={3}><FormControlLabel control={<Switch checked={settings.class_reminder_same_day_enabled} onChange={(event) => updateSetting('class_reminder_same_day_enabled', event.target.checked)} />} label="Same Day Morning" /></Grid>
          <Grid item xs={12} md={3}><FormControlLabel control={<Switch checked={settings.class_reminder_one_hour_enabled} onChange={(event) => updateSetting('class_reminder_one_hour_enabled', event.target.checked)} />} label="One Hour Before" /></Grid>
        </Grid>
      </Paper>

      <Grid container spacing={2}>
        {[
          ['Upcoming', due.upcoming.length],
          ['Today', due.today.length],
          ['One Hour', (due.oneHour || []).length],
          ['Sent', history.filter((row) => row.status === 'sent').length],
          ['Failed', history.filter((row) => row.status === 'failed').length]
        ].map(([label, value]) => <Grid item xs={12} sm={6} md={3} key={label}><Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}><Typography variant="h5" fontWeight={900}>{value}</Typography><Typography color="text.secondary">{label}</Typography></Paper></Grid>)}
      </Grid>

      <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={2.4}><TextField select label="Course" value={filters.courseId} onChange={(e) => setFilters((current) => ({ ...current, courseId: e.target.value, batchId: '' }))} fullWidth><MenuItem value="">All Courses</MenuItem>{courses.map((course) => <MenuItem key={course.id} value={course.id}>{course.name}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={2.4}><TextField select label="Batch" value={filters.batchId} onChange={(e) => setFilters((current) => ({ ...current, batchId: e.target.value }))} fullWidth><MenuItem value="">All Batches</MenuItem>{filteredBatches.map((batch) => <MenuItem key={batch.id} value={batch.id}>{batch.name}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={2.4}><TextField type="date" label="Date" value={filters.date} onChange={(e) => setFilters((current) => ({ ...current, date: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
          <Grid item xs={12} md={2.4}><TextField select label="Reminder Type" value={filters.reminderType} onChange={(e) => setFilters((current) => ({ ...current, reminderType: e.target.value }))} fullWidth><MenuItem value="">All Types</MenuItem>{reminderTypes.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={2.4}><TextField select label="Status" value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))} fullWidth><MenuItem value="">All Statuses</MenuItem>{statuses.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12}><Button variant="outlined" startIcon={<HistoryIcon />} onClick={load}>Apply Filters</Button></Grid>
        </Grid>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
          {tabLabels.map((label) => <Tab key={label} label={label} />)}
        </Tabs>
        <ClassReminderTable rows={visibleRows} onSend={sendOne} sending={sending} />
      </Paper>
    </Stack>
  );
}

export default ClassRemindersPage;
