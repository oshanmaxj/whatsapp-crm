import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Link,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import LockResetIcon from '@mui/icons-material/LockReset';
import { requestPasswordReset, resetPassword } from '../services/auth.service';

function AuthShell({ children, title, subtitle }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: '#071a15', p: 2 }}>
      <Paper sx={{ width: '100%', maxWidth: 440, p: 4, borderRadius: 3 }} elevation={8}>
        <Stack spacing={2.5}>
          <Stack spacing={1} alignItems="center">
            <Avatar sx={{ bgcolor: '#25d366', color: '#071a15' }}>
              <LockResetIcon />
            </Avatar>
            <Typography variant="h4" fontWeight={850}>{title}</Typography>
            <Typography color="text.secondary" textAlign="center">{subtitle}</Typography>
          </Stack>
          {children}
          <Link component={RouterLink} to="/login" underline="hover" textAlign="center">
            Back to sign in
          </Link>
        </Stack>
      </Paper>
    </Box>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice('');
    setError('');

    try {
      const response = await requestPasswordReset({ email });
      const data = response.data?.data || {};
      if (data.emailDeliveryConfigured === false) {
        setNotice('Password reset email configuration is required. Contact admin to complete setup.');
        return;
      }
      setNotice('If the account exists, a password reset link will be sent.');
    } catch (err) {
      setError(err.response?.data?.message || 'Cannot connect to server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Forgot password" subtitle="Request a secure reset link for your CRM account.">
      {notice && <Alert severity="info">{notice}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Stack component="form" spacing={2} onSubmit={submit}>
        <TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} fullWidth required autoFocus />
        <Button type="submit" variant="contained" size="large" disabled={loading} sx={{ bgcolor: '#128c7e' }}>
          {loading ? 'Sending...' : 'Send reset link'}
        </Button>
      </Stack>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({
    token: searchParams.get('token') || '',
    password: '',
    confirmPassword: ''
  });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setNotice('');
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      await resetPassword({ token: form.token, password: form.password });
      setNotice('Password reset. Redirecting to sign in...');
      setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Reset password" subtitle="Use the reset token from your email to set a new password.">
      {notice && <Alert severity="success">{notice}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Stack component="form" spacing={2} onSubmit={submit}>
        <TextField label="Reset token" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} fullWidth required autoFocus />
        <TextField label="New password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} fullWidth required />
        <TextField label="Confirm new password" type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} fullWidth required />
        <Button type="submit" variant="contained" size="large" disabled={loading} sx={{ bgcolor: '#128c7e' }}>
          {loading ? 'Resetting...' : 'Reset password'}
        </Button>
      </Stack>
    </AuthShell>
  );
}
