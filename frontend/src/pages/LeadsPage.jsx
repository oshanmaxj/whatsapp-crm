import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer,
  FormControl, Grid, IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import PersonAddAltIcon from '@mui/icons-material/PersonAddAlt';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { getAgents } from '../services/agent.service';
import { assignLead, autoAssignLeads, createLead, deleteLead, getLeads, updateLead } from '../services/lead.service';

const statuses = ['New', 'Contacted', 'Interested', 'Not Interested', 'Converted', 'Lost'];
const sources = ['Facebook Ads', 'WhatsApp Ads', 'Website', 'Instagram', 'TikTok', 'Google Search', 'Referral', 'Organic', 'Manual Entry'];
const priorities = ['low', 'medium', 'high'];
const courses = ['Forex', 'Crypto', 'Stock Market', 'Home Decoration', 'Other'];
const studentTypes = ['New Student', 'Existing Student', 'Returning Student'];

const initialForm = {
  name: '', phone: '', email: '', source: 'Manual Entry', status: 'New', priority: 'medium',
  assignedAgentId: '', courseInterested: 'Forex', batchInterested: '', budget: '',
  studentType: 'New Student', notes: '', followUpDate: ''
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

function toForm(lead) {
  return {
    name: lead?.name || '',
    phone: lead?.phone || '',
    email: lead?.email || '',
    source: lead?.source || 'Manual Entry',
    status: lead?.status || 'New',
    priority: lead?.priority || 'medium',
    assignedAgentId: lead?.assignedAgent?.id || '',
    courseInterested: lead?.courseInterested || 'Forex',
    batchInterested: lead?.batchInterested || '',
    budget: lead?.budget || '',
    studentType: lead?.studentType || 'New Student',
    notes: lead?.notes || '',
    followUpDate: toInputDate(lead?.followUpDate)
  };
}

function toPayload(form) {
  return {
    ...form,
    assignedAgentId: form.assignedAgentId || null,
    budget: form.budget === '' ? null : Number(form.budget),
    followUpDate: form.followUpDate ? new Date(form.followUpDate).toISOString() : null
  };
}

function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [agents, setAgents] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [filters, setFilters] = useState({ search: '', status: '', source: '', assignedAgentId: '', courseInterested: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(initialForm);

  const query = useMemo(() => ({
    page: pagination.page,
    limit: pagination.limit,
    search: filters.search || undefined,
    status: filters.status || undefined,
    source: filters.source || undefined,
    assignedAgentId: filters.assignedAgentId || undefined,
    courseInterested: filters.courseInterested || undefined
  }), [filters, pagination.page, pagination.limit]);

  const loadLeads = async () => {
    try {
      setLoading(true); setError('');
      const response = await getLeads(query);
      setLeads(response.data.data.leads || []);
      setPagination(response.data.data.pagination || pagination);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load leads.');
    } finally {
      setLoading(false);
    }
  };

  const loadAgents = async () => {
    const response = await getAgents();
    setAgents(response.data.data || []);
  };

  useEffect(() => { loadAgents(); }, []);
  useEffect(() => { loadLeads(); }, [query]);

  const setFilter = (field) => (event) => {
    setFilters((current) => ({ ...current, [field]: event.target.value }));
    setPagination((current) => ({ ...current, page: 1 }));
  };

  const openCreate = () => { setEditing(null); setForm(initialForm); setDialogOpen(true); };
  const openEdit = (lead) => { setEditing(lead); setForm(toForm(lead)); setDialogOpen(true); };

  const saveLead = async () => {
    try {
      setError('');
      if (editing) {
        await updateLead(editing.id, toPayload(form));
        setSuccess('Lead updated.');
      } else {
        await createLead(toPayload(form));
        setSuccess('Lead added.');
      }
      setDialogOpen(false);
      await loadLeads();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save lead.');
    }
  };

  const removeLead = async (lead) => {
    if (!window.confirm(`Delete ${lead.name || lead.phone}?`)) return;
    await deleteLead(lead.id);
    setSuccess('Lead deleted.');
    if (profile?.id === lead.id) setProfile(null);
    await loadLeads();
  };

  const reassignLead = async (lead, agentId) => {
    if (!agentId) return;
    await assignLead(lead.id, { assignedAgentId: Number(agentId), note: 'Manual reassignment from CRM UI' });
    setSuccess('Lead assigned.');
    await loadLeads();
  };

  const runAutoAssign = async () => {
    try {
      const response = await autoAssignLeads({ limit: 25 });
      setSuccess(`Round-robin assigned ${response.data.data.assignedCount} lead(s).`);
      await loadLeads();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to auto-assign leads.');
    }
  };

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
          <TextField label="Search name, phone, email" value={filters.search} onChange={setFilter('search')} fullWidth />
          <FormControl sx={{ minWidth: 150 }}><InputLabel>Status</InputLabel><Select label="Status" value={filters.status} onChange={setFilter('status')}><MenuItem value="">All</MenuItem>{statuses.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl>
          <FormControl sx={{ minWidth: 160 }}><InputLabel>Source</InputLabel><Select label="Source" value={filters.source} onChange={setFilter('source')}><MenuItem value="">All</MenuItem>{sources.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl>
          <FormControl sx={{ minWidth: 170 }}><InputLabel>Agent</InputLabel><Select label="Agent" value={filters.assignedAgentId} onChange={setFilter('assignedAgentId')}><MenuItem value="">All</MenuItem>{agents.map((agent) => <MenuItem key={agent.id} value={agent.id}>{agentName(agent)}</MenuItem>)}</Select></FormControl>
          <FormControl sx={{ minWidth: 170 }}><InputLabel>Course</InputLabel><Select label="Course" value={filters.courseInterested} onChange={setFilter('courseInterested')}><MenuItem value="">All</MenuItem>{courses.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl>
          <Button variant="outlined" startIcon={<AutoFixHighIcon />} onClick={runAutoAssign}>Auto Assign</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ bgcolor: '#128c7e' }}>Add Lead</Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead><TableRow><TableCell>Lead</TableCell><TableCell>Status</TableCell><TableCell>Source</TableCell><TableCell>Course</TableCell><TableCell>Agent</TableCell><TableCell>Follow-up</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id} hover>
                  <TableCell><Typography fontWeight={800}>{lead.name || 'Unnamed lead'}</Typography><Typography variant="body2" color="text.secondary">{lead.phone} {lead.email ? `• ${lead.email}` : ''}</Typography></TableCell>
                  <TableCell><Chip size="small" label={lead.status || '-'} color={lead.status === 'Converted' ? 'success' : 'default'} /></TableCell>
                  <TableCell>{lead.source || '-'}</TableCell>
                  <TableCell>{lead.courseInterested || '-'}</TableCell>
                  <TableCell>
                    <FormControl size="small" fullWidth sx={{ minWidth: 160 }}>
                      <Select value={lead.assignedAgent?.id || ''} displayEmpty onChange={(event) => reassignLead(lead, event.target.value)}>
                        <MenuItem value="">Unassigned</MenuItem>
                        {agents.map((agent) => <MenuItem key={agent.id} value={agent.id}>{agentName(agent)}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell>{lead.followUpDate ? new Date(lead.followUpDate).toLocaleDateString() : '-'}</TableCell>
                  <TableCell align="right">
                    <IconButton onClick={() => setProfile(lead)}><VisibilityIcon /></IconButton>
                    <IconButton onClick={() => openEdit(lead)}><EditIcon /></IconButton>
                    <IconButton color="error" onClick={() => removeLead(lead)}><DeleteOutlineIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && leads.length === 0 && <TableRow><TableCell colSpan={7}><Box sx={{ py: 5, textAlign: 'center' }}><Typography fontWeight={800}>No leads found</Typography><Typography color="text.secondary">Add a lead or adjust filters.</Typography></Box></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={pagination.total} page={Math.max(pagination.page - 1, 0)} rowsPerPage={pagination.limit} onPageChange={(event, page) => setPagination((current) => ({ ...current, page: page + 1 }))} onRowsPerPageChange={(event) => setPagination({ ...pagination, page: 1, limit: Number(event.target.value) })} rowsPerPageOptions={[10, 20, 50, 100]} />
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Lead' : 'Add Lead'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}><TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} sm={6}><TextField label="Phone" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} sm={6}><TextField label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} sm={6}><TextField label="Batch Interested" value={form.batchInterested} onChange={(e) => setForm({ ...form, batchInterested: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} sm={4}><FormControl fullWidth><InputLabel>Source</InputLabel><Select label="Source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>{sources.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid>
            <Grid item xs={12} sm={4}><FormControl fullWidth><InputLabel>Status</InputLabel><Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{statuses.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid>
            <Grid item xs={12} sm={4}><FormControl fullWidth><InputLabel>Priority</InputLabel><Select label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{priorities.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid>
            <Grid item xs={12} sm={4}><FormControl fullWidth><InputLabel>Course</InputLabel><Select label="Course" value={form.courseInterested} onChange={(e) => setForm({ ...form, courseInterested: e.target.value })}>{courses.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid>
            <Grid item xs={12} sm={4}><FormControl fullWidth><InputLabel>Student Type</InputLabel><Select label="Student Type" value={form.studentType} onChange={(e) => setForm({ ...form, studentType: e.target.value })}>{studentTypes.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl></Grid>
            <Grid item xs={12} sm={4}><TextField label="Budget" type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} fullWidth /></Grid>
            <Grid item xs={12} sm={6}><FormControl fullWidth><InputLabel>Assigned Agent</InputLabel><Select label="Assigned Agent" value={form.assignedAgentId} onChange={(e) => setForm({ ...form, assignedAgentId: e.target.value })}><MenuItem value="">Unassigned</MenuItem>{agents.map((agent) => <MenuItem key={agent.id} value={agent.id}>{agentName(agent)}</MenuItem>)}</Select></FormControl></Grid>
            <Grid item xs={12} sm={6}><TextField label="Follow-up Date" type="datetime-local" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth /></Grid>
            <Grid item xs={12}><TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} multiline minRows={4} fullWidth /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)}>Cancel</Button><Button variant="contained" disabled={!form.phone.trim()} onClick={saveLead}>Save</Button></DialogActions>
      </Dialog>

      <Drawer anchor="right" open={!!profile} onClose={() => setProfile(null)} PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 3 } }}>
        {profile && <Stack spacing={2}>
          <Box><Typography variant="h5" fontWeight={850}>{profile.name || 'Unnamed lead'}</Typography><Typography color="text.secondary">{profile.phone} {profile.email ? `• ${profile.email}` : ''}</Typography></Box>
          <Divider />
          <Stack direction="row" gap={1} flexWrap="wrap"><Chip label={profile.status || '-'} /><Chip label={profile.priority || '-'} /><Chip label={profile.source || '-'} /></Stack>
          <Box><Typography variant="subtitle2" color="text.secondary">Assigned Agent</Typography><Typography>{agentName(profile.assignedAgent)}</Typography></Box>
          <Box><Typography variant="subtitle2" color="text.secondary">Course and Batch</Typography><Typography>{profile.courseInterested || '-'} / {profile.batchInterested || '-'}</Typography></Box>
          <Box><Typography variant="subtitle2" color="text.secondary">Budget and Student Type</Typography><Typography>{profile.budget || '-'} / {profile.studentType || '-'}</Typography></Box>
          <Box><Typography variant="subtitle2" color="text.secondary">Follow-up Date</Typography><Typography>{profile.followUpDate ? new Date(profile.followUpDate).toLocaleString() : '-'}</Typography></Box>
          <Box><Typography variant="subtitle2" color="text.secondary">Notes</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{profile.notes || 'No notes yet.'}</Typography></Box>
          <Stack direction="row" spacing={1}><Button variant="outlined" startIcon={<EditIcon />} onClick={() => openEdit(profile)}>Edit</Button><Button variant="outlined" startIcon={<PersonAddAltIcon />} onClick={() => openEdit(profile)}>Reassign</Button></Stack>
        </Stack>}
      </Drawer>
    </Stack>
  );
}

export default LeadsPage;
