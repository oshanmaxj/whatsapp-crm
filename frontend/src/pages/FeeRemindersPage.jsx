import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Grid, LinearProgress, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tabs, TextField, Typography
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import HistoryIcon from '@mui/icons-material/History';
import PaymentsIcon from '@mui/icons-material/Payments';
import SendIcon from '@mui/icons-material/Send';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  getDueFeeReminders,
  getFeeReminderHistory,
  sendBulkFeeReminders,
  sendFeeReminder
} from '../services/feeReminder.service';
import { listBatches, listCourses } from '../services/education.service';

const tabLabels = ['Upcoming', 'Due Today', 'Overdue', 'History'];
const statusOptions = ['pending', 'sent', 'failed', 'cancelled'];

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function dateText(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
}

function reminderAmount(row) {
  const installment = row.installment || {};
  return Math.max(Number(installment.amount || 0) - Number(installment.paidAmount || 0), 0);
}

function reminderStudent(row) {
  return row.student || row.fee?.student || {};
}

function ReminderTable({ rows, onSend, sending }) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            {['Student', 'Course', 'Batch', 'Type', 'Due Date', 'Amount', 'Status', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const student = reminderStudent(row);
            return (
              <TableRow key={row.id} hover>
                <TableCell>{student.name || '-'}</TableCell>
                <TableCell>{row.fee?.course?.name || '-'}</TableCell>
                <TableCell>{row.fee?.batch?.name || '-'}</TableCell>
                <TableCell><Chip size="small" label={row.reminderType} /></TableCell>
                <TableCell>{dateText(row.installment?.dueDate || row.scheduledDate)}</TableCell>
                <TableCell>Rs.{money(reminderAmount(row))}</TableCell>
                <TableCell><Chip size="small" label={row.status} color={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'error' : 'default'} /></TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <Button size="small" startIcon={<SendIcon />} onClick={() => onSend(row.installmentId)} disabled={sending}>Send</Button>
                    <Button size="small" startIcon={<VisibilityIcon />} component={RouterLink} to={`/students/${student.id}`}>Student</Button>
                    <Button size="small" startIcon={<ChatIcon />} component={RouterLink} to="/chat">Chat</Button>
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && <TableRow><TableCell colSpan={8}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No reminders found</Typography><Typography color="text.secondary">Generated reminders will appear here.</Typography></Box></TableCell></TableRow>}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function FeeRemindersPage() {
  const [tab, setTab] = useState(0);
  const [due, setDue] = useState({ upcoming7: [], upcoming3: [], upcoming1: [], dueToday: [], overdue: [] });
  const [history, setHistory] = useState([]);
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [filters, setFilters] = useState({ courseId: '', batchId: '', status: '', fromDate: '', toDate: '' });
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const upcomingRows = useMemo(() => [...due.upcoming7, ...due.upcoming3, ...due.upcoming1], [due]);
  const activeRows = tab === 0 ? upcomingRows : tab === 1 ? due.dueToday : tab === 2 ? due.overdue : history;
  const visibleRows = activeRows
    .filter((row) => !filters.courseId || String(row.fee?.courseId) === String(filters.courseId))
    .filter((row) => !filters.batchId || String(row.fee?.batchId) === String(filters.batchId))
    .filter((row) => !filters.status || row.status === filters.status)
    .filter((row) => !filters.fromDate || String(row.scheduledDate || row.installment?.dueDate) >= filters.fromDate)
    .filter((row) => !filters.toDate || String(row.scheduledDate || row.installment?.dueDate) <= filters.toDate);
  const forecast = visibleRows.reduce((sum, row) => sum + reminderAmount(row), 0);
  const filteredBatches = batches.filter((batch) => !filters.courseId || String(batch.courseId) === String(filters.courseId));

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [dueRes, historyRes, coursesRes, batchesRes] = await Promise.all([
        getDueFeeReminders(),
        getFeeReminderHistory(filters),
        listCourses(),
        listBatches()
      ]);
      setDue(dueRes.data.data || { upcoming7: [], upcoming3: [], upcoming1: [], dueToday: [], overdue: [] });
      setHistory(historyRes.data.data || []);
      setCourses(coursesRes.data.data || []);
      setBatches(batchesRes.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load fee reminders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const applyFilters = () => load();

  const sendOne = async (installmentId) => {
    try {
      setSending(true);
      const response = await sendFeeReminder(installmentId);
      const status = response.data.data?.status;
      setSuccess(status === 'sent' ? 'Reminder sent.' : 'Reminder attempted. Check history for delivery status.');
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
      const response = await sendBulkFeeReminders();
      const result = response.data.data || {};
      setSuccess(`Bulk send complete. Sent: ${result.sent || 0}, Failed: ${result.failed || 0}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to send bulk reminders.');
    } finally {
      setSending(false);
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
            <Typography variant="h5" fontWeight={850}>Fee Reminder Automation</Typography>
            <Typography color="text.secondary">Upcoming, due today, overdue, and sent reminder history.</Typography>
          </Box>
          <Button variant="contained" startIcon={<SendIcon />} onClick={sendBulk} disabled={sending}>Bulk Send Pending</Button>
        </Stack>
      </Paper>

      <Grid container spacing={2}>
        {[
          ['Upcoming', upcomingRows.length],
          ['Due Today', due.dueToday.length],
          ['Overdue', due.overdue.length],
          ['Collection Forecast', `Rs.${money(forecast)}`]
        ].map(([label, value]) => <Grid item xs={12} sm={6} md={3} key={label}><Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}><Typography variant="h5" fontWeight={900}>{value}</Typography><Typography color="text.secondary">{label}</Typography></Paper></Grid>)}
      </Grid>

      <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}><TextField select label="Course" value={filters.courseId} onChange={(e) => setFilters((current) => ({ ...current, courseId: e.target.value, batchId: '' }))} fullWidth><MenuItem value="">All Courses</MenuItem>{courses.map((course) => <MenuItem key={course.id} value={course.id}>{course.name}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={3}><TextField select label="Batch" value={filters.batchId} onChange={(e) => setFilters((current) => ({ ...current, batchId: e.target.value }))} fullWidth><MenuItem value="">All Batches</MenuItem>{filteredBatches.map((batch) => <MenuItem key={batch.id} value={batch.id}>{batch.name}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={2}><TextField select label="Status" value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))} fullWidth><MenuItem value="">All Statuses</MenuItem>{statusOptions.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={2}><TextField type="date" label="From" value={filters.fromDate} onChange={(e) => setFilters((current) => ({ ...current, fromDate: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
          <Grid item xs={12} md={2}><TextField type="date" label="To" value={filters.toDate} onChange={(e) => setFilters((current) => ({ ...current, toDate: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
          <Grid item xs={12}><Button variant="outlined" startIcon={<HistoryIcon />} onClick={applyFilters}>Apply Filters</Button></Grid>
        </Grid>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
          {tabLabels.map((label) => <Tab key={label} label={label} />)}
        </Tabs>
        <ReminderTable rows={visibleRows} onSend={sendOne} sending={sending} />
      </Paper>
    </Stack>
  );
}

export default FeeRemindersPage;
