import React, { useEffect, useState } from 'react';
import { Alert, Avatar, Button, Grid, Paper, Stack, TextField, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import PersonIcon from '@mui/icons-material/Person';
import SaveIcon from '@mui/icons-material/Save';
import { changePassword, getMe, updateMe } from '../services/auth.service';

export function UserProfilePage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getMe()
      .then((res) => {
        const user = res.data.data || {};
        setForm({
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          email: user.email || '',
          phone: user.phone || ''
        });
      })
      .catch((err) => setError(err.response?.data?.message || 'Unable to load profile.'));
  }, []);

  const save = async () => {
    try {
      await updateMe({ firstName: form.firstName, lastName: form.lastName, phone: form.phone });
      setNotice('Profile updated.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to update profile.');
    }
  };

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar sx={{ width: 64, height: 64, bgcolor: 'success.light' }}><PersonIcon /></Avatar>
          <Stack>
            <Typography variant="h5" fontWeight={850}>User Profile</Typography>
            <Typography color="text.secondary">Manage your personal contact details.</Typography>
          </Stack>
        </Stack>
      </Paper>
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}><TextField label="First Name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="Last Name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} fullWidth /></Grid>
          <Grid item xs={12} md={6}><TextField label="Email" value={form.email} fullWidth disabled /></Grid>
          <Grid item xs={12} md={6}><TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} fullWidth /></Grid>
        </Grid>
        <Button variant="contained" startIcon={<SaveIcon />} sx={{ mt: 2.5 }} onClick={save}>Save Profile</Button>
      </Paper>
    </Stack>
  );
}

export function ChangePasswordPage() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const save = async () => {
    if (form.newPassword !== form.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    try {
      await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setNotice('Password changed.');
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to change password.');
    }
  };

  return (
    <Stack spacing={2.5}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2' }} elevation={0}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar sx={{ width: 64, height: 64, bgcolor: 'warning.light' }}><LockIcon /></Avatar>
          <Stack>
            <Typography variant="h5" fontWeight={850}>Change Password</Typography>
            <Typography color="text.secondary">Update your password using your current password.</Typography>
          </Stack>
        </Stack>
      </Paper>
      <Paper sx={{ p: 2.5, border: '1px solid #e8edf2', maxWidth: 640 }} elevation={0}>
        <Stack spacing={2}>
          <TextField label="Current Password" type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} fullWidth />
          <TextField label="New Password" type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} fullWidth />
          <TextField label="Confirm New Password" type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} fullWidth />
          <Button variant="contained" startIcon={<LockIcon />} onClick={save}>Change Password</Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
