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
  Typography
} from '@mui/material';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import CakeOutlinedIcon from '@mui/icons-material/CakeOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import SendIcon from '@mui/icons-material/Send';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import {
  getDueBirthdayWishes,
  getBirthdayWishHistory,
  sendBirthdayWish,
  sendBulkBirthdayWishes
} from '../services/birthdayWish.service';
import { getSettings, saveSetting } from '../services/production.service';

const tabs = ['Today', 'Upcoming', 'Sent', 'Failed', 'History'];
const defaultSettings = {
  birthday_auto_send_enabled: false,
  birthday_send_to_students_enabled: true,
  birthday_send_to_guardians_enabled: true
};

function titleCase(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateText(value) {
  return value ? new Date(value).toLocaleDateString() : '-';
}

function BirthdayWishesPage() {
  const [tab, setTab] = useState(0);
  const [due, setDue] = useState({ today: [], upcoming: [], due: [] });
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    if (tab === 0) return history.filter((row) => row.birthdayDate === today);
    if (tab === 1) return history.filter((row) => row.birthdayDate > today && row.status === 'pending');
    if (tab === 2) return history.filter((row) => row.status === 'sent');
    if (tab === 3) return history.filter((row) => row.status === 'failed');
    return history;
  }, [history, tab, today]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const dueResponse = await getDueBirthdayWishes();
      const [historyResponse, settingsResponse] = await Promise.all([
        getBirthdayWishHistory(),
        getSettings()
      ]);
      setDue(dueResponse.data.data || { today: [], upcoming: [], due: [] });
      setHistory(historyResponse.data.data || []);
      const setting = (settingsResponse.data.data || []).find((row) => row.namespace === 'birthday_wishes' && row.key === 'automation');
      setSettings({ ...defaultSettings, ...(setting?.value || {}) });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load birthday wishes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sendOne = async (row) => {
    try {
      setBusyId(row.id);
      setError('');
      const response = await sendBirthdayWish(row.studentId, {
        wishId: row.id,
        recipientType: row.recipientType,
        guardianId: row.guardianId
      });
      setSuccess(response.data.data?.status === 'sent' ? 'Birthday wish sent.' : 'Birthday wish failed.');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to send birthday wish.');
    } finally {
      setBusyId(null);
    }
  };

  const sendBulk = async () => {
    try {
      setBusyId('bulk');
      setError('');
      const response = await sendBulkBirthdayWishes();
      const result = response.data.data || {};
      setSuccess(result.skipped ? 'Birthday auto send is disabled.' : `${result.sent || 0} sent, ${result.failed || 0} failed.`);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to send birthday wishes.');
    } finally {
      setBusyId(null);
    }
  };

  const saveSettings = async () => {
    try {
      setBusyId('settings');
      await saveSetting('birthday_wishes', 'automation', settings);
      setSuccess('Birthday wish settings saved.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save birthday wish settings.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1}>
        <Box>
          <Typography variant="h5" fontWeight={850}>Birthday Wishes</Typography>
          <Typography color="text.secondary">Student and guardian birthday messaging.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<AssessmentOutlinedIcon />} component={RouterLink} to="/reports">Report</Button>
          <Button variant="contained" startIcon={<SendIcon />} onClick={sendBulk} disabled={busyId !== null}>Bulk Send</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Grid container spacing={2}>
        <Grid item xs={6} md={3}><Paper variant="outlined" sx={{ p: 2 }}><Typography color="text.secondary" fontWeight={700}>Today</Typography><Typography variant="h5" fontWeight={850}>{due.today?.length || 0}</Typography></Paper></Grid>
        <Grid item xs={6} md={3}><Paper variant="outlined" sx={{ p: 2 }}><Typography color="text.secondary" fontWeight={700}>Upcoming</Typography><Typography variant="h5" fontWeight={850}>{due.upcoming?.length || 0}</Typography></Paper></Grid>
        <Grid item xs={6} md={3}><Paper variant="outlined" sx={{ p: 2 }}><Typography color="text.secondary" fontWeight={700}>Sent</Typography><Typography variant="h5" fontWeight={850}>{history.filter((row) => row.status === 'sent').length}</Typography></Paper></Grid>
        <Grid item xs={6} md={3}><Paper variant="outlined" sx={{ p: 2 }}><Typography color="text.secondary" fontWeight={700}>Failed</Typography><Typography variant="h5" fontWeight={850}>{history.filter((row) => row.status === 'failed').length}</Typography></Paper></Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography fontWeight={850} sx={{ mb: 1 }}>Automation Settings</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 0, md: 2 }}>
          <FormControlLabel control={<Switch checked={settings.birthday_auto_send_enabled} onChange={(event) => setSettings((current) => ({ ...current, birthday_auto_send_enabled: event.target.checked }))} />} label="Auto Send" />
          <FormControlLabel control={<Switch checked={settings.birthday_send_to_students_enabled} onChange={(event) => setSettings((current) => ({ ...current, birthday_send_to_students_enabled: event.target.checked }))} />} label="Send to Students" />
          <FormControlLabel control={<Switch checked={settings.birthday_send_to_guardians_enabled} onChange={(event) => setSettings((current) => ({ ...current, birthday_send_to_guardians_enabled: event.target.checked }))} />} label="Send to Guardians" />
        </Stack>
        <Button size="small" variant="outlined" onClick={saveSettings} disabled={busyId !== null} sx={{ mt: 1 }}>Save Settings</Button>
      </Paper>

      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
          {tabs.map((label) => <Tab key={label} label={label} />)}
        </Tabs>
        <TableContainer>
          <Table sx={{ minWidth: 900 }}>
            <TableHead><TableRow>{['Recipient', 'Student', 'Course', 'Birthday', 'Type', 'Status', 'Actions'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {rows.map((row) => {
                const recipient = row.recipientType === 'guardian' ? row.guardian : row.student;
                const number = row.recipientType === 'guardian'
                  ? row.guardian?.whatsapp || row.guardian?.phone
                  : row.student?.contact?.whatsappId || row.student?.phone;
                const whatsappUrl = number ? `https://wa.me/${number.replace(/\D/g, '')}` : '';
                return (
                  <TableRow key={row.id} hover>
                    <TableCell><Stack direction="row" spacing={1} alignItems="center"><CakeOutlinedIcon color="primary" /><Typography fontWeight={750}>{recipient?.name || '-'}</Typography></Stack></TableCell>
                    <TableCell>{row.student?.name || '-'}</TableCell>
                    <TableCell>{row.student?.course?.name || '-'}</TableCell>
                    <TableCell>{dateText(row.birthdayDate)}</TableCell>
                    <TableCell>{titleCase(row.recipientType)}</TableCell>
                    <TableCell><Chip size="small" label={titleCase(row.status)} color={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'error' : 'default'} /></TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" startIcon={<SendIcon />} onClick={() => sendOne(row)} disabled={busyId !== null || row.status === 'sent'}>Send Wish</Button>
                        <Button size="small" startIcon={<PersonOutlineIcon />} component={RouterLink} to={`/students/${row.studentId}`}>Student 360</Button>
                        <Button size="small" startIcon={<WhatsAppIcon />} component="a" href={whatsappUrl || undefined} target="_blank" rel="noreferrer" disabled={!whatsappUrl}>WhatsApp</Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && rows.length === 0 && <TableRow><TableCell colSpan={7}><Box sx={{ py: 6, textAlign: 'center' }}><Typography fontWeight={800}>No birthday wishes found</Typography><Typography color="text.secondary">Upcoming birthdays will appear here.</Typography></Box></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}

export default BirthdayWishesPage;
