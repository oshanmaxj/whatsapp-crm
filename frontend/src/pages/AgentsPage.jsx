import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, LinearProgress, MenuItem,
  Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import GroupsIcon from '@mui/icons-material/Groups';
import LockResetIcon from '@mui/icons-material/LockReset';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import { getAgentPerformance } from '../services/agent.service';
import { createUser, deactivateUser, getRoles, resetUserPassword, updateUser } from '../services/userManagement.service';

const departments = ['Management', 'Financial', 'Customer Care', 'Technical', 'Lecturer', 'Marketing'];
const blankForm = { name: '', email: '', phone: '', password: '', role: 'agent', department: 'Customer Care', status: 'active' };
const roleLabels = {
  admin: 'Admin',
  manager: 'Manager',
  agent: 'Agent',
  marketing: 'Marketing',
  accountant: 'Accountant',
  lecturer: 'Lecturer'
};

function roleLabel(role) {
  return roleLabels[String(role).toLowerCase()] || role;
}

function permissionsFor(agent) {
  return Array.from(new Set((agent.roles || []).flatMap((role) => (role.permissions || []).map((permission) => permission.code))));
}

function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(undefined);
  const [form, setForm] = useState(blankForm);
  const [permissionTarget, setPermissionTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const load = async () => {
    setLoading(true);
    await Promise.all([
      getAgentPerformance()
      .then((response) => setAgents(response.data.data || []))
        .catch((err) => setError(err.response?.data?.message || 'Unable to load agents.')),
      getRoles().then((response) => setRoles(response.data.data || [])).catch(() => null)
    ]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totalAssigned = agents.reduce((sum, agent) => sum + Number(agent.assignedLeadCount || 0), 0);
  const openCreate = () => { setEditing(null); setForm(blankForm); };
  const openEdit = (agent) => {
    setEditing(agent);
    setForm({
      name: agent.name,
      email: agent.email,
      phone: agent.phone || '',
      password: '',
      role: agent.roles?.[0]?.name || 'agent',
      department: agent.department || '',
      status: agent.status || 'active'
    });
  };

  const save = async () => {
    if (editing) {
      await updateUser(editing.id, form);
      setNotice('Agent updated.');
    } else {
      await createUser({ ...form, role: form.role || 'agent' });
      setNotice('Agent created.');
    }
    setEditing(undefined);
    await load();
  };

  const deactivate = async (agent) => {
    await deactivateUser(agent.id);
    setNotice('Agent deactivated.');
    await load();
  };

  const resetPassword = async () => {
    await resetUserPassword(resetTarget.id, newPassword);
    setNotice('Password reset.');
    setResetTarget(null);
    setNewPassword('');
  };

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <LinearProgress />}
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Typography variant="h5" fontWeight={850} sx={{ flex: 1 }}>Agents</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Add Agent</Button>
        </Stack>
      </Paper>
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
            <GroupsIcon color="success" />
            <Typography variant="h4" fontWeight={850}>{agents.length}</Typography>
            <Typography color="text.secondary">Active Agents</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
            <Typography variant="h4" fontWeight={850}>{totalAssigned}</Typography>
            <Typography color="text.secondary">Assigned Leads</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        <TableContainer>
          <Table>
            <TableHead><TableRow><TableCell>Agent</TableCell><TableCell>Email</TableCell><TableCell>Phone</TableCell><TableCell>Department</TableCell><TableCell>Role</TableCell><TableCell>Status</TableCell><TableCell>Assigned Leads</TableCell><TableCell>Assignment History</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id} hover>
                  <TableCell><Typography fontWeight={800}>{agent.name}</Typography></TableCell>
                  <TableCell>{agent.email}</TableCell>
                  <TableCell>{agent.phone || '-'}</TableCell>
                  <TableCell>{agent.department || '-'}</TableCell>
                  <TableCell>{agent.roles?.map((role) => roleLabel(role.name)).join(', ') || 'Agent'}</TableCell>
                  <TableCell><Chip size="small" label={agent.status} color={agent.status === 'active' ? 'success' : 'default'} /></TableCell>
                  <TableCell>{agent.assignedLeadCount}</TableCell>
                  <TableCell>{agent.assignmentCount}</TableCell>
                  <TableCell align="right">
                    <Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(agent)}>Edit</Button>
                    <Button size="small" onClick={() => setPermissionTarget(agent)}>Permissions</Button>
                    <Button size="small" startIcon={<LockResetIcon />} onClick={() => setResetTarget(agent)}>Reset</Button>
                    <Button size="small" color="warning" startIcon={<PersonOffIcon />} onClick={() => deactivate(agent)}>Deactivate</Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && agents.length === 0 && <TableRow><TableCell colSpan={9}><Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No active agents found.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={editing !== undefined} onClose={() => setEditing(undefined)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Agent' : 'Add Agent'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth />
            <TextField label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth />
            <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} fullWidth />
            {!editing && <TextField label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} fullWidth />}
            <TextField select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} fullWidth>{roles.map((role) => <MenuItem key={role.id} value={role.name}>{roleLabel(role.name)}</MenuItem>)}</TextField>
            <TextField select label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} fullWidth>{departments.map((department) => <MenuItem key={department} value={department}>{department}</MenuItem>)}</TextField>
            <TextField select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} fullWidth>{['active', 'inactive', 'suspended', 'pending'].map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}</TextField>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setEditing(undefined)}>Cancel</Button><Button variant="contained" onClick={save}>Save</Button></DialogActions>
      </Dialog>

      <Dialog open={!!permissionTarget} onClose={() => setPermissionTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Permissions: {permissionTarget?.name}</DialogTitle>
        <DialogContent>
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
            {permissionsFor(permissionTarget || {}).map((permission) => <Chip key={permission} label={permission} />)}
            {permissionsFor(permissionTarget || {}).length === 0 && <Typography color="text.secondary">No permissions assigned.</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setPermissionTarget(null)}>Close</Button></DialogActions>
      </Dialog>

      <Dialog open={!!resetTarget} onClose={() => setResetTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Reset Password</DialogTitle>
        <DialogContent><TextField sx={{ mt: 1 }} label="New Password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} fullWidth /></DialogContent>
        <DialogActions><Button onClick={() => setResetTarget(null)}>Cancel</Button><Button variant="contained" onClick={resetPassword}>Reset</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

export default AgentsPage;
