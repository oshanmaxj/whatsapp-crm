import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  Grid, Paper, Stack, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { createRole, getPermissions, getRoles, setRolePermissions, updateRole } from '../services/userManagement.service';

const permissionGroups = [
  'Dashboard', 'Contacts', 'Leads', 'Agents', 'Inbox', 'Campaigns', 'Workflows', 'Appointments',
  'Courses', 'Batches', 'Students', 'Fees', 'Attendance', 'Certificates', 'Reports', 'Settings',
  'Connect WhatsApp', 'Flow Builder', 'User Manager'
];
const permissionActions = ['View', 'Create', 'Edit', 'Delete', 'Export', 'Send', 'Publish', 'Test'];
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

function actionLabel(permission) {
  return permissionActions.find((action) => permission.name.endsWith(` ${action}`)) || permission.name;
}

function PermissionManagementPage() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [editingRole, setEditingRole] = useState(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const [rolesRes, permissionsRes] = await Promise.all([getRoles(), getPermissions()]);
    setRoles(rolesRes.data.data || []);
    setPermissions(permissionsRes.data.data || []);
  };

  useEffect(() => { load().catch((err) => setError(err.response?.data?.message || 'Unable to load permissions.')); }, []);

  const grouped = permissions.reduce((acc, permission) => {
    const group = permission.name.replace(/\s+(View|Create|Edit|Delete|Export|Send)$/i, '');
    acc[group] = acc[group] || [];
    acc[group].push(permission);
    return acc;
  }, {});

  const orderedGroups = permissionGroups.filter((group) => grouped[group]);

  const togglePermission = async (role, permissionId) => {
    const current = new Set((role.permissions || []).map((permission) => permission.id));
    if (current.has(permissionId)) current.delete(permissionId);
    else current.add(permissionId);
    await setRolePermissions(role.id, Array.from(current));
    await load();
  };

  const saveRole = async () => {
    if (editingRole) await updateRole(editingRole.id, { name: roleName });
    else await createRole({ name: roleName });
    setNotice('Role saved.');
    setEditingRole(null);
    setRoleDialogOpen(false);
    setRoleName('');
    await load();
  };

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={850}>Permission Management</Typography>
            <Typography color="text.secondary">Create roles and assign module permissions for this institute.</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditingRole(null); setRoleName(''); setRoleDialogOpen(true); }}>Create Role</Button>
        </Stack>
      </Paper>

      <Grid container spacing={2.5}>
        {roles.map((role) => {
          const selected = new Set((role.permissions || []).map((permission) => permission.id));
          return (
            <Grid item xs={12} key={role.id}>
              <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h6" fontWeight={850}>{roleLabel(role.name)}</Typography>
                    <Typography variant="body2" color="text.secondary">{role.description || 'Custom role'}</Typography>
                  </Box>
                  <Button onClick={() => { setEditingRole(role); setRoleName(role.name); setRoleDialogOpen(true); }}>Edit Role</Button>
                </Stack>
                <Grid container spacing={1.5}>
                  {orderedGroups.map((group) => (
                    <Grid item xs={12} md={6} lg={4} key={`${role.id}-${group}`}>
                      <Paper variant="outlined" sx={{ p: 1.5 }}>
                        <Typography fontWeight={800} sx={{ mb: 1 }}>{group}</Typography>
                        <Grid container>
                          {[...grouped[group]].sort((a, b) => permissionActions.indexOf(actionLabel(a)) - permissionActions.indexOf(actionLabel(b))).map((permission) => (
                            <Grid item xs={6} key={permission.id}>
                              <FormControlLabel
                                control={<Checkbox size="small" checked={selected.has(permission.id)} onChange={() => togglePermission(role, permission.id)} />}
                                label={actionLabel(permission)}
                              />
                            </Grid>
                          ))}
                        </Grid>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            </Grid>
          );
        })}
      </Grid>

      <Dialog open={roleDialogOpen} onClose={() => { setEditingRole(null); setRoleName(''); setRoleDialogOpen(false); }} maxWidth="xs" fullWidth>
        <DialogTitle>{editingRole ? 'Edit Role' : 'Create Role'}</DialogTitle>
        <DialogContent><TextField sx={{ mt: 1 }} label="Role Name" value={roleName} onChange={(e) => setRoleName(e.target.value)} fullWidth /></DialogContent>
        <DialogActions><Button onClick={() => { setEditingRole(null); setRoleName(''); setRoleDialogOpen(false); }}>Cancel</Button><Button variant="contained" onClick={saveRole} disabled={!roleName.trim()}>Save</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

export default PermissionManagementPage;
