import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { login } from '../services/auth.service';
import { storeAuthResponse } from '../services/api';

function extractAuthPayload(response) {
  const body = response?.data || {};
  const data = body.data || {};
  const token = body.token || data.token || data.accessToken || data.tokens?.accessToken;
  const refreshToken = body.refreshToken || data.refreshToken || data.tokens?.refreshToken;
  const user = body.user || data.user || null;

  return { token, refreshToken, user };
}

function getLoginErrorMessage(err) {
  if (!err.response) {
    return 'Cannot connect to server. Please try again.';
  }

  const status = err.response.status;
  const message = String(err.response.data?.message || '').toLowerCase();
  const code = String(err.response.data?.code || '').toLowerCase();

  if (status === 403 || code.includes('inactive') || code.includes('disabled') || /inactive|disabled|suspended/.test(message)) {
    return 'Account disabled. Contact admin.';
  }

  if (status === 401 || /invalid.*email|invalid.*password|invalid credentials/.test(message)) {
    return 'Invalid email or password.';
  }

  return err.response.data?.message || 'Login failed. Please try again.';
}

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const redirectTo = location.state?.from?.pathname || '/dashboard';

  const handleChange = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await login(form);
      const { token } = extractAuthPayload(response);

      if (!token) {
        throw Object.assign(new Error('Login response did not include an access token.'), {
          response: { data: { message: 'Login failed. Please try again.' } }
        });
      }

      storeAuthResponse(response);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Login failed', err);
      }
      setError(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: '#071a15',
        p: 2
      }}
    >
      <Paper
        component="form"
        onSubmit={handleSubmit}
        sx={{
          width: '100%',
          maxWidth: 420,
          p: 4,
          borderRadius: 3
        }}
        elevation={8}
      >
        <Stack spacing={2.5} alignItems="stretch">
          <Stack spacing={1} alignItems="center">
            <Avatar sx={{ bgcolor: '#25d366', color: '#071a15' }}>
              <LockOutlinedIcon />
            </Avatar>
            <Typography variant="h4" fontWeight={850}>
              Sign in
            </Typography>
            <Typography color="text.secondary" textAlign="center">
              Access your local WhatsApp CRM workspace.
            </Typography>
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={handleChange('email')}
            fullWidth
            required
            autoFocus
          />
          <TextField
            label="Password"
            type="password"
            value={form.password}
            onChange={handleChange('password')}
            fullWidth
            required
          />
          <Button type="submit" variant="contained" size="large" disabled={loading} sx={{ bgcolor: '#128c7e' }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
          <Link component={RouterLink} to="/forgot-password" underline="hover" textAlign="center">
            Forgot password?
          </Link>
        </Stack>
      </Paper>
    </Box>
  );
}

export default LoginPage;
