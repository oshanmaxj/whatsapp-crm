import React, { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Badge,
  Box,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CampaignIcon from '@mui/icons-material/Campaign';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ContactsIcon from '@mui/icons-material/Contacts';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import GroupsIcon from '@mui/icons-material/Groups';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import MenuIcon from '@mui/icons-material/Menu';
import SchoolIcon from '@mui/icons-material/School';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SettingsIcon from '@mui/icons-material/Settings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import PaymentsIcon from '@mui/icons-material/Payments';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import QueueIcon from '@mui/icons-material/Queue';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AssessmentIcon from '@mui/icons-material/Assessment';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import BusinessIcon from '@mui/icons-material/Business';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EmailIcon from '@mui/icons-material/Email';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import LockIcon from '@mui/icons-material/Lock';
import LogoutIcon from '@mui/icons-material/Logout';
import NotificationsIconBell from '@mui/icons-material/Notifications';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import CakeOutlinedIcon from '@mui/icons-material/CakeOutlined';
import { getAccessPayload } from '../utils/access';
import { getNotifications, getSettings } from '../services/production.service';

const drawerWidth = 260;
const collapsedDrawerWidth = 76;
const appBarHeight = 72;
const sidebarGroupsStorageKey = 'sidebarExpandedGroups';

const navigationGroups = [
  {
    id: 'main',
    label: 'Main',
    icon: <HomeOutlinedIcon />,
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon />, permission: 'dashboard.view' },
      { label: 'Inbox / Chat', path: '/chat', aliases: ['/inbox'], icon: <ChatBubbleOutlineIcon />, permission: 'inbox.view' },
      { label: 'Contacts', path: '/contacts', icon: <ContactsIcon />, permission: 'contacts.view' },
      { label: 'Leads', path: '/leads', icon: <TrendingUpIcon />, permission: 'leads.view' },
      { label: 'Agents', path: '/agents', icon: <GroupsIcon />, permission: 'agents.view' }
    ]
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: <WhatsAppIcon />,
    items: [
      { label: 'Connect WhatsApp', path: '/connect-whatsapp', icon: <WhatsAppIcon />, permission: 'connect-whatsapp.view' },
      { label: 'WA Templates', path: '/whatsapp-templates', icon: <ChatBubbleOutlineIcon />, permission: 'connect-whatsapp.view' },
      { label: 'Compliance', path: '/compliance', icon: <FactCheckIcon />, permission: 'connect-whatsapp.view' },
      { label: 'Campaigns', path: '/campaigns', icon: <CampaignIcon />, permission: 'campaigns.view' },
      { label: 'Auto Replies', path: '/auto-replies', icon: <SmartToyIcon />, permission: 'settings.view' },
      { label: 'Flow Builder', path: '/flow-builder', matchChildren: true, icon: <AccountTreeOutlinedIcon />, permission: 'flow-builder.view' }
    ]
  },
  {
    id: 'education',
    label: 'Education',
    icon: <SchoolIcon />,
    items: [
      { label: 'Courses', path: '/courses', icon: <MenuBookIcon />, permission: 'courses.view' },
      { label: 'Batches', path: '/batches', icon: <SchoolIcon />, permission: 'batches.view' },
      { label: 'Students', childLabel: 'Student 360', path: '/students', matchChildren: true, icon: <GroupsIcon />, permission: 'students.view' },
      { label: 'Fees', path: '/fees', icon: <PaymentsIcon />, permission: 'fees.view' },
      { label: 'Attendance', path: '/attendance', icon: <FactCheckIcon />, permission: 'attendance.view' },
      { label: 'Certificates', path: '/certificates', icon: <WorkspacePremiumIcon />, permission: 'certificates.view' }
    ]
  },
  {
    id: 'automations',
    label: 'Automations',
    icon: <SettingsSuggestIcon />,
    items: [
      { label: 'Automation Center', path: '/automations', icon: <SettingsSuggestIcon />, permission: 'settings.view' },
      { label: 'Fee Reminders', path: '/fee-reminders', icon: <NotificationsIcon />, permission: 'fees.view' },
      { label: 'Class Reminders', path: '/class-reminders', icon: <EventAvailableIcon />, permission: 'attendance.view' },
      { label: 'Attendance Alerts', path: '/attendance-alerts', icon: <NotificationsIcon />, permission: 'attendance.view' },
      { label: 'Birthday Wishes', path: '/birthday-wishes', icon: <CakeOutlinedIcon />, permission: 'students.view' },
      { label: 'Workflows', path: '/workflows', icon: <AccountTreeIcon />, permission: 'workflows.view' },
      { label: 'Appointments', path: '/appointments', icon: <CalendarMonthIcon />, permission: 'appointments.view' }
    ]
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: <AssessmentIcon />,
    items: [
      { label: 'Reports', path: '/reports', icon: <AssessmentIcon />, permission: 'reports.view' },
      { label: 'Queue', path: '/queue', icon: <QueueIcon />, permission: 'settings.view' },
      { label: 'Notifications', path: '/notifications', icon: <NotificationsIcon />, permission: 'settings.view' }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <SettingsIcon />,
    items: [
      { label: 'User Manager', path: '/users', icon: <ManageAccountsIcon />, permission: 'user-manager.view' },
      { label: 'Permissions / Roles', path: '/permissions', icon: <AdminPanelSettingsIcon />, permission: 'user-manager.edit' },
      { label: 'Company Profile', path: '/company-profile', icon: <BusinessIcon />, permission: 'settings.view' },
      { label: 'SMTP Settings', path: '/smtp-settings', icon: <EmailIcon />, permission: 'settings.view' },
      { label: 'Settings', path: '/settings', icon: <SettingsIcon />, permission: 'settings.view' },
      { label: 'Profile', path: '/profile', icon: <AccountCircleIcon /> },
      { label: 'Change Password', path: '/change-password', icon: <LockIcon /> }
    ]
  }
];

const menuItems = navigationGroups.flatMap((group) => group.items);

function itemMatchesPath(item, pathname) {
  if (pathname === item.path || item.aliases?.includes(pathname)) return true;
  return item.matchChildren && pathname.startsWith(`${item.path}/`);
}

function itemDisplayLabel(item, pathname) {
  return item.childLabel && pathname !== item.path && pathname.startsWith(`${item.path}/`)
    ? item.childLabel
    : item.label;
}

function initialExpandedGroups() {
  const defaults = Object.fromEntries(navigationGroups.map((group) => [group.id, group.id === 'main']));
  try {
    const saved = JSON.parse(localStorage.getItem(sidebarGroupsStorageKey) || '{}');
    return { ...defaults, ...saved };
  } catch (error) {
    return defaults;
  }
}

const sidebarItemSx = (theme, collapsed = false) => ({
  alignItems: 'center',
  borderRadius: 1.5,
  minHeight: 38,
  mb: 0.25,
  pl: collapsed ? 1 : 2.25,
  pr: collapsed ? 1 : 1.25,
  justifyContent: collapsed ? 'center' : 'flex-start',
  color: alpha(theme.palette.common.white, 0.78),
  '& .MuiListItemIcon-root': {
    color: 'inherit',
    justifyContent: 'center',
    minWidth: collapsed ? 36 : 34,
    width: collapsed ? 36 : 34,
    '& .MuiSvgIcon-root': { fontSize: 20 }
  },
  '& .MuiListItemText-root': {
    my: 0
  },
  '& .MuiListItemText-primary': {
    fontSize: '0.84rem',
    fontWeight: 600,
    lineHeight: 1.2
  },
  '&:hover': {
    bgcolor: alpha(theme.palette.common.white, 0.08)
  },
  '&.Mui-selected': {
    bgcolor: theme.palette.success.main,
    color: theme.palette.success.contrastText,
    '& .MuiListItemText-primary': {
      fontWeight: 800
    }
  },
  '&.Mui-selected:hover': {
    bgcolor: theme.palette.success.dark
  }
});

function Sidebar({ collapsed, onNavigate }) {
  const theme = useTheme();
  const location = useLocation();
  const [branding, setBranding] = useState({ name: 'WhatsApp CRM', logoUrl: '' });
  const [expandedGroups, setExpandedGroups] = useState(initialExpandedGroups);
  const access = getAccessPayload();
  const visibleGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: access.isSystemAdmin
        ? group.items
        : group.items.filter((item) => !item.permission || access.permissions?.includes(item.permission))
    }))
    .filter((group) => group.items.length > 0);
  const activeGroupId = visibleGroups.find((group) => group.items.some((item) => itemMatchesPath(item, location.pathname)))?.id;

  const setGroupExpanded = (groupId, expanded) => {
    setExpandedGroups((current) => {
      const next = { ...current, [groupId]: expanded };
      localStorage.setItem(sidebarGroupsStorageKey, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    if (activeGroupId && !expandedGroups[activeGroupId]) {
      setGroupExpanded(activeGroupId, true);
    }
  }, [activeGroupId, expandedGroups]);

  useEffect(() => {
    getSettings()
      .then((res) => {
        const rows = res.data.data || [];
        const company = rows.find((row) => row.namespace === 'company' && row.key === 'profile')?.value || {};
        const themeSetting = rows.find((row) => row.namespace === 'branding' && row.key === 'theme')?.value || {};
        setBranding({
          name: company.name || 'WhatsApp CRM',
          logoUrl: themeSetting.logoUrl || ''
        });
      })
      .catch(() => null);
  }, []);

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: '#0b1f1a', color: '#fff' }}>
      <Box sx={{ p: collapsed ? 1.5 : 3, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar src={branding.logoUrl} sx={{ bgcolor: '#21c063', color: '#08201a', fontWeight: 800 }}>
            {branding.name.charAt(0)}
          </Avatar>
          {!collapsed && <Box>
            <Typography variant="h6" fontWeight={800} lineHeight={1.1}>
              {branding.name}
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.68)' }}>
              Sales command center
            </Typography>
          </Box>}
        </Box>
      </Box>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
      <List sx={{ px: collapsed ? 1 : 1.25, py: 1, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {visibleGroups.map((group, index) => {
          const expanded = Boolean(expandedGroups[group.id]);
          const groupActive = activeGroupId === group.id;
          return (
            <Box key={group.id}>
              {index > 0 && <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.07)' }} />}
              <Tooltip title={collapsed ? group.label : ''} placement="right">
                <ListItemButton
                  onClick={() => setGroupExpanded(group.id, !expanded)}
                  aria-expanded={expanded}
                  aria-controls={`sidebar-group-${group.id}`}
                  sx={{
                    minHeight: 36,
                    borderRadius: 1.5,
                    px: collapsed ? 1 : 1.25,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    color: groupActive ? '#7ee2aa' : 'rgba(255,255,255,0.58)',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.07)', color: '#fff' },
                    '& .MuiListItemIcon-root': {
                      minWidth: collapsed ? 36 : 34,
                      width: collapsed ? 36 : 34,
                      justifyContent: 'center',
                      color: 'inherit'
                    }
                  }}
                >
                  <ListItemIcon>{group.icon}</ListItemIcon>
                  {!collapsed && (
                    <>
                      <ListItemText
                        primary={group.label}
                        primaryTypographyProps={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0 }}
                      />
                      {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </>
                  )}
                </ListItemButton>
              </Tooltip>
              <Collapse in={expanded} timeout="auto" unmountOnExit>
                <List id={`sidebar-group-${group.id}`} disablePadding sx={{ mt: 0.25 }}>
                  {group.items.map((item) => {
                    const selected = itemMatchesPath(item, location.pathname);
                    return (
                      <Tooltip key={item.path} title={collapsed ? itemDisplayLabel(item, location.pathname) : ''} placement="right">
                        <ListItemButton
                          component={Link}
                          to={item.path}
                          onClick={onNavigate}
                          selected={selected}
                          sx={sidebarItemSx(theme, collapsed)}
                        >
                          <ListItemIcon>{item.icon}</ListItemIcon>
                          {!collapsed && <ListItemText primary={itemDisplayLabel(item, location.pathname)} />}
                        </ListItemButton>
                      </Tooltip>
                    );
                  })}
                </List>
              </Collapse>
            </Box>
          );
        })}
      </List>
    </Box>
  );
}

function CrmLayout({ darkMode, onToggleDarkMode }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationAnchor, setNotificationAnchor] = useState(null);
  const [userAnchor, setUserAnchor] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const location = useLocation();
  const currentDrawerWidth = isDesktop && sidebarCollapsed ? collapsedDrawerWidth : drawerWidth;

  const pageTitle = useMemo(() => {
    const item = menuItems.find((entry) => itemMatchesPath(entry, location.pathname));
    return item ? itemDisplayLabel(item, location.pathname) : 'Dashboard';
  }, [location.pathname]);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      localStorage.setItem('sidebarCollapsed', String(!current));
      return !current;
    });
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUserAnchor(null);
    navigate('/login', { replace: true });
  };

  const drawer = <Sidebar collapsed={isDesktop && sidebarCollapsed} onNavigate={() => setMobileOpen(false)} />;

  useEffect(() => {
    getNotifications({ unreadOnly: true })
      .then((res) => {
        const rows = res.data.data || [];
        setNotifications(rows.slice(0, 5));
        setUnreadCount(rows.length);
      })
      .catch(() => null);
  }, [location.pathname]);

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          ml: { md: `${currentDrawerWidth}px` },
          width: { md: `calc(100% - ${currentDrawerWidth}px)` },
          bgcolor: alpha(theme.palette.background.paper, 0.92),
          color: 'text.primary',
          borderBottom: `1px solid ${theme.palette.divider}`,
          backdropFilter: 'blur(12px)'
        }}
      >
        <Toolbar sx={{ minHeight: appBarHeight, gap: 1 }}>
          {!isDesktop && (
            <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          {isDesktop && (
            <Tooltip title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <IconButton onClick={toggleSidebar} color="inherit" aria-label="Toggle sidebar">
                {sidebarCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </IconButton>
            </Tooltip>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant={isDesktop ? 'h5' : 'h6'} fontWeight={800} noWrap>
              {pageTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>
              Manage conversations, contacts, and follow-ups from one workspace.
            </Typography>
          </Box>
          <IconButton onClick={onToggleDarkMode} color="inherit" aria-label="Toggle dark mode">
            {darkMode ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
          <IconButton color="inherit" aria-label="Notifications" onClick={(event) => setNotificationAnchor(event.currentTarget)}>
            <Badge badgeContent={unreadCount} color="error">
              <NotificationsIconBell />
            </Badge>
          </IconButton>
          <IconButton onClick={(event) => setUserAnchor(event.currentTarget)} color="inherit" aria-label="Profile menu">
            <AccountCircleIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Menu anchorEl={notificationAnchor} open={Boolean(notificationAnchor)} onClose={() => setNotificationAnchor(null)}>
        {notifications.length === 0 && <MenuItem>No unread notifications</MenuItem>}
        {notifications.map((notification) => (
          <MenuItem key={notification.id} component={Link} to="/notifications" onClick={() => setNotificationAnchor(null)}>
            <Box sx={{ maxWidth: 320 }}>
              <Typography variant="body2" fontWeight={800} noWrap>{notification.title}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>{notification.message || notification.type}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={userAnchor} open={Boolean(userAnchor)} onClose={() => setUserAnchor(null)}>
        <MenuItem component={Link} to="/profile" onClick={() => setUserAnchor(null)}>
          <AccountCircleIcon fontSize="small" style={{ marginRight: 8 }} /> Profile
        </MenuItem>
        <MenuItem component={Link} to="/change-password" onClick={() => setUserAnchor(null)}>
          <LockIcon fontSize="small" style={{ marginRight: 8 }} /> Change Password
        </MenuItem>
        <MenuItem onClick={logout}>
          <LogoutIcon fontSize="small" style={{ marginRight: 8 }} /> Logout
        </MenuItem>
      </Menu>

      <Box component="nav" sx={{ width: { md: currentDrawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              maxWidth: '100vw',
              height: '100vh',
              overflow: 'hidden'
            }
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': {
              width: currentDrawerWidth,
              boxSizing: 'border-box',
              border: 0,
              height: '100vh',
              overflow: 'hidden'
            }
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          width: { xs: '100%', md: `calc(100% - ${currentDrawerWidth}px)` },
          height: '100vh',
          overflowY: 'auto',
          overflowX: 'hidden'
        }}
      >
        <Toolbar sx={{ minHeight: appBarHeight }} />
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: '100%', overflowX: 'hidden' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}

export default CrmLayout;
