import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import {
  cancelAppointment,
  confirmAppointment,
  createAppointment,
  deleteAppointment,
  getAppointments,
  sendAppointmentReminder,
  updateAppointment
} from '../services/appointment.service';
import { getAgents } from '../services/agent.service';

const statuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'];
const statusColors = { Pending: 'warning', Confirmed: 'success', Completed: 'info', Cancelled: 'default', 'No Show': 'error' };

const initialForm = {
  title: '',
  appointmentType: 'Consultation',
  visibility: 'private',
  status: 'Pending',
  appointmentAt: '',
  durationMinutes: 30,
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  contactId: '',
  leadId: '',
  conversationId: '',
  assignedAgentId: '',
  reminderAt: '',
  confirmationMessage: 'Hi {{customerName}}, your appointment is confirmed for {{date}}.',
  reminderMessage: 'Reminder: your appointment is scheduled for {{date}}.',
  notes: '',
  createRequest: true
};

function agentName(agent) {
  if (!agent) return 'Unassigned';
  return agent.name || [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email;
}

function toInputDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}

function toForm(appointment) {
  return {
    title: appointment.title || '',
    appointmentType: appointment.appointmentType || 'Consultation',
    visibility: appointment.visibility || 'private',
    status: appointment.status || 'Pending',
    appointmentAt: toInputDate(appointment.appointmentAt),
    durationMinutes: appointment.durationMinutes || 30,
    customerName: appointment.customerName || '',
    customerPhone: appointment.customerPhone || '',
    customerEmail: appointment.customerEmail || '',
    contactId: appointment.contactId || '',
    leadId: appointment.leadId || '',
    conversationId: '',
    assignedAgentId: appointment.assignedAgentId || '',
    reminderAt: toInputDate(appointment.reminderAt),
    confirmationMessage: appointment.confirmationMessage || initialForm.confirmationMessage,
    reminderMessage: appointment.reminderMessage || initialForm.reminderMessage,
    notes: appointment.notes || '',
    createRequest: false
  };
}

function toPayload(form) {
  const { conversationId, ...payload } = form;
  return {
    ...payload,
    assignedAgentId: form.assignedAgentId || null,
    contactId: form.contactId || null,
    leadId: form.leadId || null,
    appointmentAt: form.appointmentAt ? new Date(form.appointmentAt).toISOString() : null,
    reminderAt: form.reminderAt ? new Date(form.reminderAt).toISOString() : null,
    durationMinutes: Number(form.durationMinutes) || 30
  };
}

function contactDisplayName(contact = {}) {
  return contact.name
    || [contact.firstName, contact.lastName].filter(Boolean).join(' ')
    || contact.fullName
    || contact.phone
    || contact.whatsappId
    || '';
}

function formFromNavigationState(state = {}) {
  const conversation = state.selectedConversation || state.conversation || {};
  const contact = state.selectedContact || state.contact || conversation.contact || {};
  const name = contactDisplayName(contact);
  const conversationId = conversation.id || state.conversationId || '';
  return {
    ...initialForm,
    title: name ? `Appointment with ${name}` : initialForm.title,
    customerName: name,
    customerPhone: contact.phone || contact.whatsappId || '',
    customerEmail: contact.email || '',
    contactId: contact.id || conversation.contactId || '',
    leadId: conversation.leadId || conversation.lead?.id || '',
    conversationId,
    assignedAgentId: conversation.assignedTo || conversation.assignee?.id || '',
    notes: conversationId ? `Created from chat conversation #${conversationId}` : initialForm.notes
  };
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function AppointmentsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const consumedNavigationStateRef = useRef(false);
  const [appointments, setAppointments] = useState([]);
  const [agents, setAgents] = useState([]);
  const [filters, setFilters] = useState({ status: '', assignedAgentId: '', visibility: '' });
  const [form, setForm] = useState(initialForm);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const totals = useMemo(() => {
    const base = { total: appointments.length, Pending: 0, Confirmed: 0, Completed: 0 };
    appointments.forEach((appointment) => { base[appointment.status] = (base[appointment.status] || 0) + 1; });
    return base;
  }, [appointments]);

  const load = async () => {
    try {
      setLoading(true);
      const response = await getAppointments({
        status: filters.status || undefined,
        assignedAgentId: filters.assignedAgentId || undefined,
        visibility: filters.visibility || undefined
      });
      setAppointments(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load appointments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { getAgents().then((response) => setAgents(response.data.data || [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [filters]);

  useEffect(() => {
    const state = location.state || {};
    if (!state.openCreate || consumedNavigationStateRef.current) return;
    consumedNavigationStateRef.current = true;
    setEditing(null);
    setForm(formFromNavigationState(state));
    setDialogOpen(true);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  const openCreate = () => {
    setEditing(null);
    setForm(initialForm);
    setDialogOpen(true);
  };

  const openEdit = (appointment) => {
    setEditing(appointment);
    setForm(toForm(appointment));
    setDialogOpen(true);
  };

  const save = async () => {
    try {
      setError('');
      if (editing) {
        await updateAppointment(editing.id, toPayload(form));
        setSuccess('Appointment updated.');
      } else {
        await createAppointment(toPayload(form));
        setSuccess('Appointment created.');
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save appointment.');
    }
  };

  const remove = async (appointment) => {
    if (!window.confirm(`Delete appointment "${appointment.title}"?`)) return;
    await deleteAppointment(appointment.id);
    setSuccess('Appointment deleted.');
    await load();
  };

  const confirm = async (appointment) => {
    const response = await confirmAppointment(appointment.id);
    setNotification(response.data.data.notification);
    setSuccess('Appointment confirmed.');
    await load();
  };

  const cancel = async (appointment) => {
    const reason = window.prompt('Cancellation reason', 'Cancelled from CRM');
    if (reason === null) return;
    await cancelAppointment(appointment.id, reason);
    setSuccess('Appointment cancelled.');
    await load();
  };

  const remind = async (appointment) => {
    const response = await sendAppointmentReminder(appointment.id);
    setNotification(response.data.data.notification);
    setSuccess('Reminder prepared.');
  };

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
      {notification && <Alert severity="info" onClose={() => setNotification(null)}>WhatsApp {notification.mode}: {notification.to} - {notification.text}</Alert>}

      <Grid container spacing={2}>
        {Object.entries(totals).slice(0, 4).map(([key, value]) => (
          <Grid item xs={6} md={3} key={key}>
            <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
              <Typography variant="h4" fontWeight={850}>{value}</Typography>
              <Typography color="text.secondary">{key}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ lg: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>Appointments</Typography>
            <Typography color="text.secondary">Manage booking requests, assigned agents, confirmations, and reminders.</Typography>
          </Box>
          <FormControl sx={{ minWidth: 150 }}><InputLabel>Status</InputLabel><Select label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><MenuItem value="">All</MenuItem>{statuses.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl>
          <FormControl sx={{ minWidth: 150 }}><InputLabel>Visibility</InputLabel><Select label="Visibility" value={filters.visibility} onChange={(e) => setFilters({ ...filters, visibility: e.target.value })}><MenuItem value="">All</MenuItem><MenuItem value="public">Public</MenuItem><MenuItem value="private">Private</MenuItem></Select></FormControl>
          <FormControl sx={{ minWidth: 180 }}><InputLabel>Agent</InputLabel><Select label="Agent" value={filters.assignedAgentId} onChange={(e) => setFilters({ ...filters, assignedAgentId: e.target.value })}><MenuItem value="">All</MenuItem>{agents.map((agent) => <MenuItem key={agent.id} value={agent.id}>{agentName(agent)}</MenuItem>)}</Select></FormControl>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ bgcolor: '#128c7e' }}>Create Appointment</Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead><TableRow><TableCell>Appointment</TableCell><TableCell>Customer</TableCell><TableCell>Date</TableCell><TableCell>Agent</TableCell><TableCell>Status</TableCell><TableCell>Visibility</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {appointments.map((appointment) => (
                <TableRow key={appointment.id} hover>
                  <TableCell><Typography fontWeight={800}>{appointment.title}</Typography><Typography variant="body2" color="text.secondary">{appointment.appointmentType}</Typography></TableCell>
                  <TableCell><Typography>{appointment.customerName}</Typography><Typography variant="body2" color="text.secondary">{appointment.customerPhone}</Typography></TableCell>
                  <TableCell>{formatDate(appointment.appointmentAt)}</TableCell>
                  <TableCell>{agentName(appointment.agent)}</TableCell>
                  <TableCell><Chip size="small" label={appointment.status} color={statusColors[appointment.status] || 'default'} /></TableCell>
                  <TableCell>{appointment.visibility}</TableCell>
                  <TableCell align="right">
                    {appointment.status === 'Pending' && <IconButton title="Confirm" onClick={() => confirm(appointment)}><CheckCircleIcon /></IconButton>}
                    {['Pending', 'Confirmed'].includes(appointment.status) && <IconButton title="Reminder" onClick={() => remind(appointment)}><NotificationsActiveIcon /></IconButton>}
                    {!['Cancelled', 'Completed'].includes(appointment.status) && <IconButton title="Cancel" onClick={() => cancel(appointment)}><CancelIcon /></IconButton>}
                    <IconButton title="Edit" onClick={() => openEdit(appointment)}><EditIcon /></IconButton>
                    <IconButton color="error" title="Delete" onClick={() => remove(appointment)}><DeleteOutlineIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && appointments.length === 0 && <TableRow><TableCell colSpan={7}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No appointments found</Typography><Typography color="text.secondary">Create a booking to begin.</Typography></Box></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Appointment' : 'Create Appointment'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} md={8}><TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} md={4}><TextField label="Appointment Type" value={form.appointmentType} onChange={(e) => setForm({ ...form, appointmentType: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} md={6}><TextField label="Customer Name" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} md={6}><TextField label="Customer Phone" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} md={6}><TextField label="Customer Email" value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} md={3}><TextField label="Date/Time" type="datetime-local" value={form.appointmentAt} onChange={(e) => setForm({ ...form, appointmentAt: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
            <Grid item xs={12} md={3}><TextField label="Duration Minutes" type="number" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} md={4}><FormControl fullWidth><InputLabel>Status</InputLabel><Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{statuses.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid>
            <Grid item xs={12} md={4}><FormControl fullWidth><InputLabel>Visibility</InputLabel><Select label="Visibility" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}><MenuItem value="public">Public</MenuItem><MenuItem value="private">Private</MenuItem></Select></FormControl></Grid>
            <Grid item xs={12} md={4}><FormControl fullWidth><InputLabel>Assigned Agent</InputLabel><Select label="Assigned Agent" value={form.assignedAgentId} onChange={(e) => setForm({ ...form, assignedAgentId: e.target.value })}><MenuItem value="">Unassigned</MenuItem>{agents.map((agent) => <MenuItem key={agent.id} value={agent.id}>{agentName(agent)}</MenuItem>)}</Select></FormControl></Grid>
            <Grid item xs={12} md={6}><TextField label="Reminder Time" type="datetime-local" value={form.reminderAt} onChange={(e) => setForm({ ...form, reminderAt: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
            <Grid item xs={12} md={6}><FormControl fullWidth><InputLabel>Create Booking Request</InputLabel><Select label="Create Booking Request" value={form.createRequest ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, createRequest: e.target.value === 'yes' })}><MenuItem value="yes">Yes</MenuItem><MenuItem value="no">No</MenuItem></Select></FormControl></Grid>
            <Grid item xs={12}><TextField label="Confirmation Message" value={form.confirmationMessage} onChange={(e) => setForm({ ...form, confirmationMessage: e.target.value })} multiline minRows={2} fullWidth /></Grid>
            <Grid item xs={12}><TextField label="Reminder Message" value={form.reminderMessage} onChange={(e) => setForm({ ...form, reminderMessage: e.target.value })} multiline minRows={2} fullWidth /></Grid>
            <Grid item xs={12}><TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} multiline minRows={3} fullWidth /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)}>Cancel</Button><Button variant="contained" disabled={!form.title.trim() || !form.customerName.trim() || !form.customerPhone.trim() || !form.appointmentAt} onClick={save}>Save</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

export default AppointmentsPage;
