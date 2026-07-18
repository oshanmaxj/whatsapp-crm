import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { clearAuthState, restoreAuthentication } from '../services/api';

function ProtectedRoute() {
  const location = useLocation();
  const [state, setState] = useState('loading');
  useEffect(() => {
    let active = true;
    restoreAuthentication().then(() => { if (active) setState('authenticated'); }).catch(() => {
      clearAuthState();
      if (active) setState('anonymous');
    });
    return () => { active = false; };
  }, []);

  if (state === 'loading') return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  if (state === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
