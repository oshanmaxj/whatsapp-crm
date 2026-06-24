import React from 'react';
import { Alert, Box } from '@mui/material';
import { hasPermission } from '../utils/access';

function PermissionRoute({ permission, children }) {
  if (!hasPermission(permission)) {
    return (
      <Box sx={{ maxWidth: 720 }}>
        <Alert severity="warning">You do not have permission to access this page.</Alert>
      </Box>
    );
  }

  return children;
}

export default PermissionRoute;
