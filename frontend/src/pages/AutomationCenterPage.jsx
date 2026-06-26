import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditCalendarOutlinedIcon from '@mui/icons-material/EditCalendarOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HistoryIcon from '@mui/icons-material/History';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined';
import {
  getAutomation,
  getAutomations,
  getAutomationStats,
  runAutomation,
  toggleAutomation,
  updateAutomation
} from '../services/automation.service';

const categories = ['Education', 'Finance', 'Marketing', 'System'];
const channels = ['whatsapp', 'email', 'sms', 'notification', 'multi_channel'];
const scheduleTypes = ['manual', 'hourly', 'daily', 'weekly', 'monthly'];
const emptyStats = { activeAutomations: 0, todayRuns: 0, successRate: 0, failedJobs: 0 };

function dateTime(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

function titleCase(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function scheduleText(row) {
  if (row.scheduleType === 'manual') return 'Manual';
  return `${titleCase(row.scheduleType)}${row.scheduleValue ? ` · ${row.scheduleValue}` : ''}`;
}

function StatCard({ label, value, icon, color }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="body2" color="text.secondary" fontWeight={700}>{label}</Typography>
          <Typography variant="h5" fontWeight={850} sx={{ mt: 0.5 }}>{value}</Typography>
        </Box>
        <Box sx={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 1.5, bgcolor: `${color}18`, color }}>
          {icon}
        </Box>
      </Stack>
    </Paper>
  );
}

function AutomationCenterPage() {
  const [automations, setAutomations] = useState([]);
  const [stats, setStats] = useState(emptyStats);
  const [filters, setFilters] = useState({ category: '', enabled: '', channel: '' });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [logRow, setLogRow] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);

  const visibleRows = useMemo(() => automations
    .filter((row) => !filters.category || row.category === filters.category)
    .filter((row) => filters.enabled === '' || row.enabled === (filters.enabled === 'true'))
    .filter((row) => !filters.channel || row.channel === filters.channel), [automations, filters]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [listResponse, statsResponse] = await Promise.all([getAutomations(), getAutomationStats()]);
      setAutomations(listResponse.data.data || []);
      setStats(statsResponse.data.data || emptyStats);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load automations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (row, enabled) => {
    try {
      setBusyId(row.id);
      setError('');
      setSuccess('');
      await toggleAutomation(row.id, enabled);
      setSuccess(`${row.name} ${enabled ? 'enabled' : 'disabled'}.`);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update automation status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRun = async (row) => {
    try {
      setBusyId(row.id);
      setError('');
      setSuccess('');
      const response = await runAutomation(row.id);
      setSuccess(response.data.data?.log?.message || `${row.name} completed.`);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Automation execution failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSave = async () => {
    try {
      setBusyId(editRow.id);
      setError('');
      await updateAutomation(editRow.id, {
        name: editRow.name,
        description: editRow.description,
        enabled: editRow.enabled,
        channel: editRow.channel,
        scheduleType: editRow.scheduleType,
        scheduleValue: editRow.scheduleType === 'manual' ? null : editRow.scheduleValue
      });
      setSuccess(`${editRow.name} settings saved.`);
      setEditRow(null);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save automation settings.');
    } finally {
      setBusyId(null);
    }
  };

  const openLogs = async (row) => {
    try {
      setLogsLoading(true);
      setLogRow({ ...row, logs: [] });
      const response = await getAutomation(row.id);
      setLogRow(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load automation logs.');
      setLogRow(null);
    } finally {
      setLogsLoading(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1}>
        <Box>
          <Typography variant="h5" fontWeight={850}>Automation Center</Typography>
          <Typography color="text.secondary">Manage schedules, channels, execution, and run history.</Typography>
        </Box>
        <Button variant="outlined" startIcon={<AssessmentOutlinedIcon />} href="/reports">Automation Report</Button>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Grid container spacing={2}>
        <Grid item xs={6} md={3}><StatCard label="Active Automations" value={stats.activeAutomations} icon={<SettingsSuggestOutlinedIcon />} color="#087f5b" /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Today's Runs" value={stats.todayRuns} icon={<PlayArrowIcon />} color="#1769aa" /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Success Rate" value={`${stats.successRate || 0}%`} icon={<CheckCircleOutlineIcon />} color="#238636" /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Failed Jobs" value={stats.failedJobs} icon={<ErrorOutlineIcon />} color="#ba1a1a" /></Grid>
      </Grid>

      <Paper variant="outlined">
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }}>
          <TextField select size="small" label="Category" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} sx={{ minWidth: 180 }}>
            <MenuItem value="">All categories</MenuItem>
            {categories.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Status" value={filters.enabled} onChange={(event) => setFilters((current) => ({ ...current, enabled: event.target.value }))} sx={{ minWidth: 150 }}>
            <MenuItem value="">All statuses</MenuItem>
            <MenuItem value="true">Enabled</MenuItem>
            <MenuItem value="false">Disabled</MenuItem>
          </TextField>
          <TextField select size="small" label="Channel" value={filters.channel} onChange={(event) => setFilters((current) => ({ ...current, channel: event.target.value }))} sx={{ minWidth: 180 }}>
            <MenuItem value="">All channels</MenuItem>
            {channels.map((item) => <MenuItem key={item} value={item}>{titleCase(item)}</MenuItem>)}
          </TextField>
        </Stack>

        <TableContainer>
          <Table sx={{ minWidth: 1160 }}>
            <TableHead>
              <TableRow>
                {['Name', 'Category', 'Status', 'Channel', 'Schedule', 'Last Run', 'Next Run', 'Success', 'Failed', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ minWidth: 210 }}>
                    <Typography fontWeight={800}>{row.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{row.code}</Typography>
                  </TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell><Chip size="small" color={row.enabled ? 'success' : 'default'} label={row.enabled ? 'Enabled' : 'Disabled'} /></TableCell>
                  <TableCell>{titleCase(row.channel)}</TableCell>
                  <TableCell>{scheduleText(row)}</TableCell>
                  <TableCell>{dateTime(row.lastRunAt)}</TableCell>
                  <TableCell>{dateTime(row.nextRunAt)}</TableCell>
                  <TableCell>{row.successCount}</TableCell>
                  <TableCell>{row.failureCount}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.25}>
                      <Tooltip title="Run now">
                        <span><IconButton size="small" color="primary" disabled={!row.enabled || busyId !== null} onClick={() => handleRun(row)}><PlayArrowIcon /></IconButton></span>
                      </Tooltip>
                      <Tooltip title={row.enabled ? 'Disable' : 'Enable'}>
                        <span><Switch size="small" checked={row.enabled} disabled={busyId !== null} onChange={(event) => handleToggle(row, event.target.checked)} /></span>
                      </Tooltip>
                      <Tooltip title="Edit settings">
                        <IconButton size="small" onClick={() => setEditRow({ ...row })}><EditCalendarOutlinedIcon /></IconButton>
                      </Tooltip>
                      <Tooltip title="View logs">
                        <IconButton size="small" onClick={() => openLogs(row)}><HistoryIcon /></IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10}>
                    <Box sx={{ py: 6, textAlign: 'center' }}>
                      <Typography fontWeight={800}>No automations found</Typography>
                      <Typography color="text.secondary">Change the filters to view registered automations.</Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={Boolean(editRow)} onClose={() => setEditRow(null)} fullWidth maxWidth="sm">
        <DialogTitle>Automation Settings</DialogTitle>
        {editRow && (
          <DialogContent dividers>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <FormControlLabel
                control={<Switch checked={editRow.enabled} onChange={(event) => setEditRow((current) => ({ ...current, enabled: event.target.checked }))} />}
                label={editRow.enabled ? 'Enabled' : 'Disabled'}
              />
              <TextField label="Name" value={editRow.name} onChange={(event) => setEditRow((current) => ({ ...current, name: event.target.value }))} fullWidth />
              <TextField label="Description" value={editRow.description || ''} onChange={(event) => setEditRow((current) => ({ ...current, description: event.target.value }))} multiline minRows={3} fullWidth />
              <TextField select label="Channel" value={editRow.channel} onChange={(event) => setEditRow((current) => ({ ...current, channel: event.target.value }))} fullWidth>
                {channels.map((item) => <MenuItem key={item} value={item}>{titleCase(item)}</MenuItem>)}
              </TextField>
              <TextField select label="Schedule Type" value={editRow.scheduleType} onChange={(event) => setEditRow((current) => ({ ...current, scheduleType: event.target.value, scheduleValue: event.target.value === 'manual' ? '' : current.scheduleValue }))} fullWidth>
                {scheduleTypes.map((item) => <MenuItem key={item} value={item}>{titleCase(item)}</MenuItem>)}
              </TextField>
              {editRow.scheduleType !== 'manual' && (
                <TextField label="Schedule Value" value={editRow.scheduleValue || ''} onChange={(event) => setEditRow((current) => ({ ...current, scheduleValue: event.target.value }))} fullWidth required />
              )}
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setEditRow(null)}>Cancel</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={busyId !== null || (editRow?.scheduleType !== 'manual' && !editRow?.scheduleValue)}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(logRow)} onClose={() => setLogRow(null)} fullWidth maxWidth="md">
        <DialogTitle>{logRow?.name || 'Automation'} Logs</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {logsLoading && <LinearProgress />}
          <TableContainer sx={{ maxHeight: 520 }}>
            <Table stickyHeader sx={{ minWidth: 720 }}>
              <TableHead><TableRow>{['Status', 'Started', 'Completed', 'Message'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {(logRow?.logs || []).map((log) => (
                  <TableRow key={log.id}>
                    <TableCell><Chip size="small" label={titleCase(log.status)} color={log.status === 'success' ? 'success' : log.status === 'failed' ? 'error' : 'default'} /></TableCell>
                    <TableCell>{dateTime(log.startedAt)}</TableCell>
                    <TableCell>{dateTime(log.completedAt)}</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>{log.message || '-'}</TableCell>
                  </TableRow>
                ))}
                {!logsLoading && (logRow?.logs || []).length === 0 && <TableRow><TableCell colSpan={4} sx={{ py: 5, textAlign: 'center' }}>No execution logs yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions><Button onClick={() => setLogRow(null)}>Close</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

export default AutomationCenterPage;
