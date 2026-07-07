import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Box, Card, CardActionArea, CardContent, Stack, Tab, Tabs, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { getAccessPayload } from '../utils/access';
import { canAccessItem, itemIsActive, modules, pathBelongsToModule } from './moduleNavigationConfig';

export function useActiveModule() {
  const { pathname } = useLocation();
  return modules.find((module) => pathBelongsToModule(module, pathname));
}

export function ModuleTabs() {
  const location = useLocation();
  const module = modules.find((entry) => pathBelongsToModule(entry, location.pathname));
  const access = getAccessPayload();
  const items = module?.items?.filter((item) => canAccessItem(item, access)) || [];

  if (!module || items.length === 0 || location.pathname === '/whatsapp' || location.pathname === '/education') return null;

  const activeItem = items.find((item) => itemIsActive(item, location.pathname, location.search));

  return (
    <Box sx={{ mb: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Tabs value={activeItem?.path || false} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        {items.map((item) => (
          <Tab
            key={item.path}
            component={Link}
            to={item.path}
            value={item.path}
            icon={item.icon}
            iconPosition="start"
            label={item.label}
            sx={{ minHeight: 50, whiteSpace: 'nowrap' }}
          />
        ))}
      </Tabs>
    </Box>
  );
}

export function ModuleLandingPage({ moduleId }) {
  const theme = useTheme();
  const module = modules.find((entry) => entry.id === moduleId);
  const access = getAccessPayload();
  const items = module?.items?.filter((item) => canAccessItem(item, access)) || [];

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" fontWeight={850}>{module?.label}</Typography>
        <Typography color="text.secondary">Choose an area to continue.</Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
        {items.map((item) => (
          <Card key={item.path} variant="outlined" sx={{ height: '100%' }}>
            <CardActionArea component={Link} to={item.path} sx={{ height: '100%' }}>
              <CardContent>
                <Box sx={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 1.5, mb: 1.5, color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                  {item.icon}
                </Box>
                <Typography fontWeight={800}>{item.label}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Open {item.label.toLowerCase()}</Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </Stack>
  );
}
