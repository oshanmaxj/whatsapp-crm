import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem,
  FormControlLabel, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import LockResetIcon from '@mui/icons-material/LockReset';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import { createUser, deactivateUser, getRoles, getUsers, resetUserPassword, updateUser } from '../services/userManagement.service';

const blankForm = () => ({
  name: '',
  email: '',
  phone: '',
  password: '',
  roleId: '',
  receiveAssignmentNotifications: true,
  status: 'active'
});
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

function displayName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}

function primaryRole(user) {
  return user.roles?.[0] || null;
}

function requestErrorMessage(error, fallback) {
  const details = error.response?.data?.details;
  if (Array.isArray(details) && details.length > 0) {
    return details.map((detail) => detail?.message || String(detail)).filter(Boolean).join('. ');
  }
  return error.response?.data?.message || fallback;
}

function UserManagerPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [editing, setEditing] = useState(undefined);
  const [form, setForm] = useState(blankForm);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const roleOptions = useMemo(() => roles, [roles]);

  const load = async () => {
    const [usersRes, rolesRes] = await Promise.all([getUsers(), getRoles()]);
    setUsers(usersRes.data.data || []);
    setRoles(rolesRes.data.data || []);
  };

  useEffect(() => { load().catch((err) => setError(err.response?.data?.message || 'Unable to load users.')); }, []);

  const openCreate = () => {
    setError('');
    setNotice('');
    setEditing(null);
    setForm(blankForm());
  };
  const openEdit = (user) => {
    const role = primaryRole(user);
    setError('');
    setEditing(user);
    setForm({
      name: displayName(user),
      email: user.email,
      phone: user.phone || '',
      password: '',
      roleId: role?.id || '',
      receiveAssignmentNotifications: user.receiveAssignmentNotifications !== false,
      status: user.status || 'active'
    });
  };

  const save = async (event) => {
    event?.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name) return setError('Name is required.');
    if (!email) return setError('Email is required.');
    if (!editing && !form.password) return setError('Password is required.');
    if (!editing && form.password.length < 6) return setError('Password must be at least 6 characters.');
    if (!form.roleId) return setError('Department is required.');

    try {
      setSaving(true);
      setError('');
      if (editing) {
        await updateUser(editing.id, form);
        setNotice('User updated successfully');
      } else {
        await createUser(form);
        setNotice('User created successfully');
      }
      setEditing(undefined);
      await load();
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to save user.'));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (user) => {
    try {
      setError('');
      await deactivateUser(user.id);
      setNotice('User deactivated.');
      await load();
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to deactivate user.'));
    }
  };

  const resetPassword = async () => {
    try {
      setError('');
      await resetUserPassword(resetTarget.id, newPassword);
      setNotice('Password reset.');
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to reset password.'));
    }
  };

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>User Manager</Typography>
            <Typography color="text.secondary">Create agents and staff, assign departments, and manage active access.</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Add User / Agent</Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid #e8edf2', overflow: 'hidden' }} elevation={0}>
        <TableContainer>
          <Table>
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Phone</TableCell><TableCell>Department</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell><Typography fontWeight={800}>{displayName(user)}</Typography></TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.phone || '-'}</TableCell>
                  <TableCell>{user.roles?.map((role) => roleLabel(role.name)).join(', ') || '-'}</TableCell>
                  <TableCell><Chip size="small" label={user.status} color={user.status === 'active' ? 'success' : 'default'} /></TableCell>
                  <TableCell align="right">
                    <Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(user)}>Edit</Button>
                    <Button size="small" startIcon={<LockResetIcon />} onClick={() => setResetTarget(user)}>Reset</Button>
                    <Button size="small" color="warning" startIcon={<PersonOffIcon />} onClick={() => deactivate(user)}>Deactivate</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={editing !== undefined} onClose={() => setEditing(undefined)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit User' : 'Add User / Agent'}</DialogTitle>
        <Box component="form" autoComplete="off" onSubmit={save}>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              {error && <Grid item xs={12}><Alert severity="error" onClose={() => setError('')}>{error}</Alert></Grid>}
              <Grid item xs={12}><TextField name="user_agent_name" autoComplete="off" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth /></Grid>
              <Grid item xs={12}><TextField name="user_agent_email" autoComplete="new-password" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth /></Grid>
              <Grid item xs={12}><TextField name="user_agent_phone" autoComplete="new-password" label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} fullWidth /></Grid>
              {!editing && <Grid item xs={12}><TextField name="user_agent_new_password" autoComplete="new-password" label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} fullWidth /></Grid>}
              <Grid item xs={12} md={6}><TextField select label="Department" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} fullWidth>{roleOptions.map((role) => <MenuItem key={role.id} value={role.id}>{roleLabel(role.name)}</MenuItem>)}</TextField></Grid>
              <Grid item xs={12} md={6}><TextField select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} fullWidth>{['active', 'inactive', 'suspended', 'pending'].map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}</TextField></Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Switch checked={form.receiveAssignmentNotifications} onChange={(e) => setForm({ ...form, receiveAssignmentNotifications: e.target.checked })} />}
                  label="Receive WhatsApp assignment notifications"
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions><Button onClick={() => setEditing(undefined)}>Cancel</Button><Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></DialogActions>
        </Box>
      </Dialog>

      <Dialog open={!!resetTarget} onClose={() => setResetTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Reset Password</DialogTitle>
        <DialogContent><TextField name="user_reset_new_password" autoComplete="new-password" sx={{ mt: 1 }} label="New Password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} fullWidth /></DialogContent>
        <DialogActions><Button onClick={() => setResetTarget(null)}>Cancel</Button><Button variant="contained" onClick={resetPassword}>Reset</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

export default UserManagerPage;
