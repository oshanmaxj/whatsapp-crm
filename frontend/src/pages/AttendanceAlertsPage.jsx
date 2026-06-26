import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import SendIcon from '@mui/icons-material/Send';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import {
  getDueAttendanceAlerts,
  getAttendanceAlertHistory,
  sendAttendanceAlert,
  sendBulkAttendanceAlerts
} from '../services/attendanceAlert.service';
import { listBatches, listCourses, listStudents } from '../services/education.service';
import { getSettings, saveSetting } from '../services/production.service';

const tabs = ['Due Alerts', 'Absent Today', 'Consecutive Absent', 'Low Attendance', 'Sent', 'Failed', 'History'];
const alertTypes = ['absent_today', 'consecutive_absent_2', 'consecutive_absent_3', 'attendance_below_75', 'attendance_below_50', 'manual'];
const recipientTypes = ['student', 'guardian', 'both'];
const statuses = ['pending', 'sent', 'failed', 'cancelled'];
const defaultSettings = {
  attendance_alert_auto_send_enabled: false,
  attendance_alert_absent_today_enabled: true,
  attendance_alert_consecutive_2_enabled: true,
  attendance_alert_consecutive_3_enabled: true,
  attendance_alert_below_75_enabled: true,
  attendance_alert_below_50_enabled: true,
  attendance_alert_send_to_student_enabled: true,
  attendance_alert_send_to_guardian_enabled: true
};

function titleCase(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateText(value) {
  return value ? new Date(value).toLocaleDateString() : '-';
}

function AttendanceAlertsPage() {
  const [tab, setTab] = useState(0);
  const [due, setDue] = useState([]);
  const [history, setHistory] = useState([]);
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [students, setStudents] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [filters, setFilters] = useState({ courseId: '', batchId: '', studentId: '', alertType: '', recipientType: '', status: '', date: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const baseRows = tab === 0
    ? due
    : tab === 1
      ? history.filter((row) => row.alertType === 'absent_today' && row.scheduledDate === today)
      : tab === 2
        ? history.filter((row) => row.alertType.startsWith('consecutive_absent'))
        : tab === 3
          ? history.filter((row) => row.alertType.startsWith('attendance_below'))
          : tab === 4
            ? history.filter((row) => row.status === 'sent')
            : tab === 5
              ? history.filter((row) => row.status === 'failed')
              : history;

  const visibleRows = useMemo(() => baseRows
    .filter((row) => !filters.courseId || String(row.student?.courseId) === String(filters.courseId))
    .filter((row) => !filters.batchId || String(row.student?.batchId) === String(filters.batchId))
    .filter((row) => !filters.studentId || String(row.studentId) === String(filters.studentId))
    .filter((row) => !filters.alertType || row.alertType === filters.alertType)
    .filter((row) => !filters.recipientType || row.recipientType === filters.recipientType)
    .filter((row) => !filters.status || row.status === filters.status)
    .filter((row) => !filters.date || row.scheduledDate === filters.date), [baseRows, filters]);

  const filteredBatches = batches.filter((batch) => !filters.courseId || String(batch.courseId) === String(filters.courseId));
  const filteredStudents = students.filter((student) =>
    (!filters.courseId || String(student.courseId) === String(filters.courseId))
    && (!filters.batchId || String(student.batchId) === String(filters.batchId)));

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [dueResponse, historyResponse, courseResponse, batchResponse, studentResponse, settingsResponse] = await Promise.all([
        getDueAttendanceAlerts(),
        getAttendanceAlertHistory(),
        listCourses(),
        listBatches(),
        listStudents(),
        getSettings()
      ]);
      setDue(dueResponse.data.data || []);
      setHistory(historyResponse.data.data || []);
      setCourses(courseResponse.data.data || []);
      setBatches(batchResponse.data.data || []);
      setStudents(studentResponse.data.data || []);
      const row = (settingsResponse.data.data || []).find((item) => item.namespace === 'attendance_alerts' && item.key === 'automation');
      setSettings({ ...defaultSettings, ...(row?.value || {}) });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load attendance alerts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sendOne = async (studentId, recipientType = 'both') => {
    try {
      setBusy(true);
      setError('');
      const response = await sendAttendanceAlert(studentId, { recipientType });
      setSuccess(response.data.data?.status === 'sent' ? 'Attendance alert sent.' : 'Attendance alert completed with delivery errors.');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to send attendance alert.');
    } finally {
      setBusy(false);
    }
  };

  const sendBulk = async () => {
    try {
      setBusy(true);
      setError('');
      const response = await sendBulkAttendanceAlerts();
      const result = response.data.data || {};
      setSuccess(result.skipped ? 'Auto send is disabled.' : `${result.sent || 0} sent, ${result.failed || 0} failed.`);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to send pending alerts.');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    try {
      setBusy(true);
      await saveSetting('attendance_alerts', 'automation', settings);
      setSuccess('Attendance alert settings saved.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save attendance alert settings.');
    } finally {
      setBusy(false);
    }
  };

  const settingLabels = [
    ['attendance_alert_auto_send_enabled', 'Auto Send'],
    ['attendance_alert_absent_today_enabled', 'Absent Today'],
    ['attendance_alert_consecutive_2_enabled', '2 Consecutive Absences'],
    ['attendance_alert_consecutive_3_enabled', '3 Consecutive Absences'],
    ['attendance_alert_below_75_enabled', 'Below 75%'],
    ['attendance_alert_below_50_enabled', 'Below 50%'],
    ['attendance_alert_send_to_student_enabled', 'Send to Student'],
    ['attendance_alert_send_to_guardian_enabled', 'Send to Guardian']
  ];

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1}>
        <Box>
          <Typography variant="h5" fontWeight={850}>Attendance Alerts</Typography>
          <Typography color="text.secondary">Manage absence and low-attendance notifications.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<AssessmentOutlinedIcon />} component={RouterLink} to="/reports">Report</Button>
          <Button variant="contained" startIcon={<SendIcon />} onClick={sendBulk} disabled={busy}>Bulk Send</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography fontWeight={850} sx={{ mb: 1 }}>Automation Settings</Typography>
        <Grid container spacing={0.5}>
          {settingLabels.map(([key, label]) => (
            <Grid item xs={12} sm={6} md={3} key={key}>
              <FormControlLabel
                control={<Switch size="small" checked={settings[key] === true} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked }))} />}
                label={label}
              />
            </Grid>
          ))}
        </Grid>
        <Button size="small" variant="outlined" onClick={saveSettings} disabled={busy} sx={{ mt: 1 }}>Save Settings</Button>
      </Paper>

      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
          {tabs.map((label) => <Tab key={label} label={label} />)}
        </Tabs>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <TextField select size="small" label="Course" value={filters.courseId} onChange={(event) => setFilters((current) => ({ ...current, courseId: event.target.value, batchId: '', studentId: '' }))} sx={{ minWidth: 160 }}>
            <MenuItem value="">All courses</MenuItem>{courses.map((course) => <MenuItem key={course.id} value={course.id}>{course.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Batch" value={filters.batchId} onChange={(event) => setFilters((current) => ({ ...current, batchId: event.target.value, studentId: '' }))} sx={{ minWidth: 150 }}>
            <MenuItem value="">All batches</MenuItem>{filteredBatches.map((batch) => <MenuItem key={batch.id} value={batch.id}>{batch.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Student" value={filters.studentId} onChange={(event) => setFilters((current) => ({ ...current, studentId: event.target.value }))} sx={{ minWidth: 180 }}>
            <MenuItem value="">All students</MenuItem>{filteredStudents.map((student) => <MenuItem key={student.id} value={student.id}>{student.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Alert Type" value={filters.alertType} onChange={(event) => setFilters((current) => ({ ...current, alertType: event.target.value }))} sx={{ minWidth: 185 }}>
            <MenuItem value="">All types</MenuItem>{alertTypes.map((type) => <MenuItem key={type} value={type}>{titleCase(type)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Recipients" value={filters.recipientType} onChange={(event) => setFilters((current) => ({ ...current, recipientType: event.target.value }))} sx={{ minWidth: 145 }}>
            <MenuItem value="">All recipients</MenuItem>{recipientTypes.map((type) => <MenuItem key={type} value={type}>{titleCase(type)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} sx={{ minWidth: 130 }}>
            <MenuItem value="">All statuses</MenuItem>{statuses.map((status) => <MenuItem key={status} value={status}>{titleCase(status)}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Date" type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} InputLabelProps={{ shrink: true }} />
        </Stack>

        <TableContainer>
          <Table sx={{ minWidth: 1120 }}>
            <TableHead><TableRow>{['Student', 'Course / Batch', 'Alert', 'Guardian', 'Recipients', 'Date', 'Status', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {visibleRows.map((row) => {
                const student = row.student || {};
                const whatsapp = row.guardian?.whatsapp || row.guardian?.phone || student.contact?.whatsappId || student.phone || '';
                const whatsappUrl = whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, '')}` : '';
                return (
                  <TableRow key={row.id} hover>
                    <TableCell><Typography fontWeight={750}>{student.name || '-'}</Typography><Typography variant="caption" color="text.secondary">{student.studentNo || ''}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{student.course?.name || '-'}</Typography><Typography variant="caption" color="text.secondary">{student.batch?.name || '-'}</Typography></TableCell>
                    <TableCell><Chip size="small" label={titleCase(row.alertType)} /></TableCell>
                    <TableCell>{row.guardian?.name || '-'}</TableCell>
                    <TableCell>{titleCase(row.recipientType)}</TableCell>
                    <TableCell>{dateText(row.scheduledDate)}</TableCell>
                    <TableCell><Chip size="small" label={titleCase(row.status)} color={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'error' : 'default'} /></TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" startIcon={<SendIcon />} onClick={() => sendOne(row.studentId, row.recipientType)} disabled={busy}>Send</Button>
                        <Button size="small" startIcon={<PersonOutlineIcon />} component={RouterLink} to={`/students/${row.studentId}`}>Student</Button>
                        <Button size="small" startIcon={<FactCheckOutlinedIcon />} component={RouterLink} to="/attendance">Attendance</Button>
                        <Button size="small" startIcon={<WhatsAppIcon />} component="a" href={whatsappUrl || undefined} target="_blank" rel="noreferrer" disabled={!whatsappUrl}>WhatsApp</Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && visibleRows.length === 0 && <TableRow><TableCell colSpan={8}><Box sx={{ py: 6, textAlign: 'center' }}><Typography fontWeight={800}>No attendance alerts found</Typography><Typography color="text.secondary">Generated alerts will appear here.</Typography></Box></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}

export default AttendanceAlertsPage;
