import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { login } from '../services/auth.service';

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: 'admin@test.com', password: '123456' });
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
      const tokens = response.data.data.tokens;

      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Check your email and password.');
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

          <Alert severity="info" icon={false}>
            Local admin: admin@test.com / 123456
          </Alert>
        </Stack>
      </Paper>
    </Box>
  );
}

export default LoginPage;
