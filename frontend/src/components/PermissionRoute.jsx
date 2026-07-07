import React from 'react';
import { Alert, Box } from '@mui/material';
import { hasAnyPermission, hasPermission } from '../utils/access';

function PermissionRoute({ permission, children }) {
  const allowed = Array.isArray(permission)
    ? hasAnyPermission(permission)
    : hasPermission(permission);

  if (!allowed) {
    return (
      <Box sx={{ maxWidth: 720 }}>
        <Alert severity="warning">You do not have permission to access this page.</Alert>
      </Box>
    );
  }

  return children;
}

export default PermissionRoute;
