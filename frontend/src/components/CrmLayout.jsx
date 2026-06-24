import React, { useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CampaignIcon from '@mui/icons-material/Campaign';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ContactsIcon from '@mui/icons-material/Contacts';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupsIcon from '@mui/icons-material/Groups';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import MenuIcon from '@mui/icons-material/Menu';
import SchoolIcon from '@mui/icons-material/School';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SettingsIcon from '@mui/icons-material/Settings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PaymentsIcon from '@mui/icons-material/Payments';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import QueueIcon from '@mui/icons-material/Queue';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AssessmentIcon from '@mui/icons-material/Assessment';

const drawerWidth = 260;

const menuItems = [
  { label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Contacts', path: '/contacts', icon: <ContactsIcon /> },
  { label: 'Campaigns', path: '/campaigns', icon: <CampaignIcon /> },
  { label: 'Workflows', path: '/workflows', icon: <AccountTreeIcon /> },
  { label: 'Appointments', path: '/appointments', icon: <CalendarMonthIcon /> },
  { label: 'Courses', path: '/courses', icon: <MenuBookIcon /> },
  { label: 'Batches', path: '/batches', icon: <SchoolIcon /> },
  { label: 'Students', path: '/students', icon: <GroupsIcon /> },
  { label: 'Fees', path: '/fees', icon: <PaymentsIcon /> },
  { label: 'Attendance', path: '/attendance', icon: <FactCheckIcon /> },
  { label: 'Certificates', path: '/certificates', icon: <WorkspacePremiumIcon /> },
  { label: 'Queue', path: '/queue', icon: <QueueIcon /> },
  { label: 'Notifications', path: '/notifications', icon: <NotificationsIcon /> },
  { label: 'Reports', path: '/reports', icon: <AssessmentIcon /> },
  { label: 'Leads', path: '/leads', icon: <TrendingUpIcon /> },
  { label: 'Agents', path: '/agents', icon: <GroupsIcon /> },
  { label: 'Inbox', path: '/chat', icon: <ChatBubbleOutlineIcon /> },
  { label: 'Auto Replies', path: '/auto-replies', icon: <SmartToyIcon /> },
  { label: 'Settings', path: '/settings', icon: <SettingsIcon /> }
];

function Sidebar({ onNavigate }) {
  const location = useLocation();

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#0b1f1a', color: '#fff' }}>
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ bgcolor: '#21c063', color: '#08201a', fontWeight: 800 }}>W</Avatar>
          <Box>
            <Typography variant="h6" fontWeight={800} lineHeight={1.1}>
              WhatsApp CRM
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.68)' }}>
              Sales command center
            </Typography>
          </Box>
        </Box>
      </Box>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
      <List sx={{ px: 1.5, py: 2, flex: 1 }}>
        {menuItems.map((item) => {
          const selected = location.pathname === item.path || (item.path === '/chat' && location.pathname === '/inbox');
          return (
            <ListItemButton
              key={item.path}
              component={Link}
              to={item.path}
              onClick={onNavigate}
              selected={selected}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                color: selected ? '#071a15' : 'rgba(255,255,255,0.78)',
                bgcolor: selected ? '#25d366' : 'transparent',
                '&.Mui-selected': { bgcolor: '#25d366' },
                '&.Mui-selected:hover': { bgcolor: '#20bd5a' },
                '&:hover': { bgcolor: selected ? '#20bd5a' : 'rgba(255,255,255,0.08)' }
              }}
            >
              <ListItemIcon sx={{ minWidth: 42, color: 'inherit' }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: selected ? 800 : 600 }} />
            </ListItemButton>
          );
        })}
      </List>
      <Box sx={{ p: 2 }}>
        <Box sx={{ borderRadius: 2, p: 2, bgcolor: 'rgba(37,211,102,0.12)', border: '1px solid rgba(37,211,102,0.24)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <AutoAwesomeIcon fontSize="small" sx={{ color: '#25d366' }} />
            <Typography variant="subtitle2" fontWeight={800}>
              Phase 1
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.66)' }}>
            Dashboard, contacts, inbox, and automations.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function CrmLayout() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const pageTitle = useMemo(() => {
    const item = menuItems.find((entry) => entry.path === location.pathname);
    if (location.pathname === '/inbox') return 'Inbox';
    return item?.label || 'Dashboard';
  }, [location.pathname]);

  const drawer = <Sidebar onNavigate={() => setMobileOpen(false)} />;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          ml: { md: `${drawerWidth}px` },
          width: { md: `calc(100% - ${drawerWidth}px)` },
          bgcolor: 'rgba(246,248,251,0.92)',
          color: '#12211c',
          borderBottom: '1px solid #e6eaef',
          backdropFilter: 'blur(12px)'
        }}
      >
        <Toolbar sx={{ minHeight: 72 }}>
          {!isDesktop && (
            <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={800}>
              {pageTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Manage conversations, contacts, and follow-ups from one workspace.
            </Typography>
          </Box>
          <Chip label="Local PostgreSQL" color="success" variant="outlined" sx={{ display: { xs: 'none', sm: 'inline-flex' } }} />
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box', border: 0 }
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, width: { md: `calc(100% - ${drawerWidth}px)` }, p: { xs: 2, md: 3 }, pt: 12 }}>
        <Outlet />
      </Box>
    </Box>
  );
}

export default CrmLayout;
