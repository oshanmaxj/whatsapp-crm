import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Badge,
  Box,
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
import MenuIcon from '@mui/icons-material/Menu';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LockIcon from '@mui/icons-material/Lock';
import LogoutIcon from '@mui/icons-material/Logout';
import NotificationsIconBell from '@mui/icons-material/Notifications';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { getAccessPayload } from '../utils/access';
import { useSocket } from '../hooks/useSocket';
import { getNotifications, getSettings } from '../services/production.service';
import { logoutSession } from '../services/api';
import { ModuleTabs } from './ModuleNavigationView';
import {
  canAccessItem,
  canAccessModule,
  itemIsActive,
  modules,
  pathBelongsToModule
} from './moduleNavigationConfig';

const drawerWidth = 260;
const collapsedDrawerWidth = 76;
const appBarHeight = 72;
const chatSoundMutedStorageKey = 'crmChatSoundMuted';
const selectedConversationStorageKey = 'crmSelectedConversationId';

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
  const access = getAccessPayload();
  const visibleModules = modules.filter((module) => canAccessModule(module, access));
  const moduleDestination = (module) => {
    if (['whatsapp', 'education'].includes(module.id) || !module.items) return module.path;
    const landingItem = module.items.find((item) => item.path.split('?')[0] === module.path && canAccessItem(item, access));
    return landingItem?.path || module.items.find((item) => canAccessItem(item, access))?.path || module.path;
  };

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
        {visibleModules.map((module) => (
          <Tooltip key={module.id} title={collapsed ? module.label : ''} placement="right">
            <ListItemButton
              component={Link}
              to={moduleDestination(module)}
              onClick={onNavigate}
              selected={pathBelongsToModule(module, location.pathname)}
              sx={sidebarItemSx(theme, collapsed)}
            >
              <ListItemIcon>{module.icon}</ListItemIcon>
              {!collapsed && <ListItemText primary={module.label} />}
            </ListItemButton>
          </Tooltip>
        ))}
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
  const [soundMuted, setSoundMuted] = useState(() => localStorage.getItem(chatSoundMutedStorageKey) === 'true');
  const recentMessageIdsRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const token = localStorage.getItem('accessToken');
  const { socket, connected } = useSocket(token);
  const location = useLocation();
  const currentDrawerWidth = isDesktop && sidebarCollapsed ? collapsedDrawerWidth : drawerWidth;

  const pageTitle = useMemo(() => {
    const module = modules.find((entry) => pathBelongsToModule(entry, location.pathname));
    const item = module?.items?.find((entry) => itemIsActive(entry, location.pathname, location.search));
    return item?.label || module?.label || 'Dashboard';
  }, [location.pathname, location.search]);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      localStorage.setItem('sidebarCollapsed', String(!current));
      return !current;
    });
  };

  const logout = async () => {
    setUserAnchor(null);
    await logoutSession().catch(() => null);
    navigate('/login', { replace: true });
  };

  const toggleSound = () => {
    setSoundMuted((current) => {
      localStorage.setItem(chatSoundMutedStorageKey, String(!current));
      return !current;
    });
  };

  const playMessageBeep = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = audioContextRef.current || new AudioContext();
      audioContextRef.current = context;
      if (context.state === 'suspended') {
        context.resume().catch(() => {});
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(720, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.2);
    } catch (error) {
      // Browsers can block audio before user interaction; notifications should keep working silently.
    }
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

  useEffect(() => {
    if (!socket) return undefined;

    const shouldSkipDuplicate = (payload) => {
      const key = payload.id == null
        ? `${payload.conversationId}-${payload.createdAt || payload.text || ''}`
        : String(payload.id);
      const now = Date.now();
      for (const [messageKey, timestamp] of recentMessageIdsRef.current.entries()) {
        if (now - timestamp > 10000) recentMessageIdsRef.current.delete(messageKey);
      }
      if (recentMessageIdsRef.current.has(key)) return true;
      recentMessageIdsRef.current.set(key, now);
      return false;
    };

    const handleInboundMessage = (payload) => {
      if (!payload || typeof payload !== 'object' || payload.conversationId == null) return;
      if (payload.direction !== 'inbound' && payload.status !== 'received') return;
      if (soundMuted || shouldSkipDuplicate(payload)) return;

      const selectedConversationId = localStorage.getItem(selectedConversationStorageKey);
      const sameOpenChat = location.pathname === '/chat'
        && String(selectedConversationId || '') === String(payload.conversationId);
      const tabFocused = document.visibilityState === 'visible' && document.hasFocus();
      if (sameOpenChat && tabFocused) return;

      playMessageBeep();
    };

    socket.on('chat:message', handleInboundMessage);
    socket.on('whatsapp.message.received', handleInboundMessage);
    return () => {
      socket.off('chat:message', handleInboundMessage);
      socket.off('whatsapp.message.received', handleInboundMessage);
    };
  }, [socket, soundMuted, location.pathname]);

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
          <Tooltip title={soundMuted ? 'Muted' : 'Sound On'}>
            <IconButton onClick={toggleSound} color="inherit" aria-label={soundMuted ? 'Muted' : 'Sound On'}>
              {soundMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
            </IconButton>
          </Tooltip>
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
          <ModuleTabs />
          <Outlet context={{ socket, connected }} />
        </Box>
      </Box>
    </Box>
  );
}

export default CrmLayout;
