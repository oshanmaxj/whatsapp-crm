import React from 'react';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import AddCardIcon from '@mui/icons-material/AddCard';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BackupIcon from '@mui/icons-material/Backup';
import BusinessIcon from '@mui/icons-material/Business';
import CakeOutlinedIcon from '@mui/icons-material/CakeOutlined';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CampaignIcon from '@mui/icons-material/Campaign';
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ContactsIcon from '@mui/icons-material/Contacts';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EmailIcon from '@mui/icons-material/Email';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import GroupsIcon from '@mui/icons-material/Groups';
import LockIcon from '@mui/icons-material/Lock';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import MoneyOffIcon from '@mui/icons-material/MoneyOff';
import NotificationsIcon from '@mui/icons-material/Notifications';
import PaymentsIcon from '@mui/icons-material/Payments';
import SchoolIcon from '@mui/icons-material/School';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsIcon from '@mui/icons-material/Settings';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import StorageIcon from '@mui/icons-material/Storage';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';

export const modules = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon />, permission: 'dashboard.view', routes: ['/dashboard'] },
  { id: 'chat', label: 'Inbox / Chat', path: '/chat', icon: <ChatBubbleOutlineIcon />, permission: 'inbox.view', routes: ['/chat', '/inbox'] },
  { id: 'contacts', label: 'Contacts', path: '/contacts', icon: <ContactsIcon />, permission: 'contacts.view', routes: ['/contacts'] },
  { id: 'leads', label: 'Leads', path: '/leads', icon: <TrendingUpIcon />, permission: 'leads.view', routes: ['/leads'] },
  { id: 'appointments', label: 'Appointments', path: '/appointments', icon: <CalendarMonthIcon />, permission: 'appointments.view', routes: ['/appointments'] },
  { id: 'commissions', label: 'Commissions', path: '/commissions', icon: <PaymentsIcon />, permission: 'commission.view_own', routes: ['/commissions'] },
  {
    id: 'whatsapp', label: 'WhatsApp', path: '/whatsapp', icon: <WhatsAppIcon />,
    routes: ['/whatsapp', '/whatsapp-dashboard', '/connect-whatsapp', '/whatsapp-accounts', '/whatsapp-templates', '/campaigns', '/compliance', '/auto-replies', '/flow-builder'],
    items: [
      { label: 'Connect WhatsApp', path: '/connect-whatsapp', icon: <WhatsAppIcon />, permission: 'connect-whatsapp.view' },
      { label: 'WhatsApp Numbers', path: '/whatsapp-accounts', icon: <WhatsAppIcon />, permission: 'connect-whatsapp.view' },
      { label: 'WA Templates', path: '/whatsapp-templates', icon: <ChatBubbleOutlineIcon />, permission: 'connect-whatsapp.view' },
      { label: 'Broadcasting / Campaigns', path: '/campaigns', icon: <CampaignIcon />, permission: 'campaigns.view' },
      { label: 'Compliance', path: '/compliance', icon: <FactCheckIcon />, permission: 'connect-whatsapp.view' },
      { label: 'Auto Replies', path: '/auto-replies', icon: <SmartToyIcon />, permission: 'settings.view' },
      { label: 'Flow Builder', path: '/flow-builder', icon: <AccountTreeOutlinedIcon />, permission: 'flow-builder.view' }
    ]
  },
  {
    id: 'education', label: 'Education', path: '/education', icon: <SchoolIcon />,
    routes: ['/education', '/courses', '/batches', '/students', '/fees', '/attendance', '/certificates', '/course-scheduler', '/lms/courses'],
    items: [
      { label: 'Courses', path: '/courses', icon: <MenuBookIcon />, permission: 'courses.view' },
      { label: 'Batches', path: '/batches', icon: <SchoolIcon />, permission: 'batches.view' },
      { label: 'Students', path: '/students', icon: <GroupsIcon />, permission: 'students.view' },
      { label: 'Fees', path: '/fees', icon: <PaymentsIcon />, permission: 'fees.view' },
      { label: 'Attendance', path: '/attendance', icon: <FactCheckIcon />, permission: 'attendance.view' },
      { label: 'Certificates', path: '/certificates', icon: <WorkspacePremiumIcon />, permission: 'certificates.view' },
      { label: 'Scheduler', path: '/course-scheduler', icon: <CalendarMonthIcon />, permission: 'courses.view' },
      { label: 'LMS Courses', path: '/lms/courses', icon: <MenuBookIcon />, permission: 'courses.view' }
    ]
  },
  {
    id: 'accounting', label: 'Accounting', path: '/accounting', icon: <AccountBalanceIcon />, permission: 'accounting.view', routes: ['/accounting'],
    items: [
      { label: 'Dashboard', path: '/accounting', icon: <DashboardIcon />, permission: 'accounting.view', exact: true },
      { label: 'Income', path: '/accounting/income', icon: <AddCardIcon />, permission: 'accounting.view' },
      { label: 'Expenses', path: '/accounting/expenses', icon: <MoneyOffIcon />, permission: 'accounting.view' },
      { label: 'Categories', path: '/accounting/categories', icon: <CategoryOutlinedIcon />, permission: 'accounting.view' },
      { label: 'Reports', path: '/accounting/reports', icon: <AssessmentIcon />, permission: 'accounting.view' }
    ]
  },
  {
    id: 'automations', label: 'Automations', path: '/automations', icon: <SettingsSuggestIcon />,
    routes: ['/automations', '/fee-reminders', '/class-reminders', '/attendance-alerts', '/birthday-wishes'],
    items: [
      { label: 'Automation Center', path: '/automations', icon: <SettingsSuggestIcon />, permission: 'settings.view' },
      { label: 'Fee Reminders', path: '/fee-reminders', icon: <NotificationsIcon />, permission: 'fees.view' },
      { label: 'Class Reminders', path: '/class-reminders', icon: <EventAvailableIcon />, permission: 'attendance.view' },
      { label: 'Attendance Alerts', path: '/attendance-alerts', icon: <NotificationsIcon />, permission: 'attendance.view' },
      { label: 'Birthday Wishes', path: '/birthday-wishes', icon: <CakeOutlinedIcon />, permission: 'students.view' }
    ]
  },
  { id: 'reports', label: 'Reports', path: '/reports', icon: <AssessmentIcon />, permission: 'reports.view', routes: ['/reports'] },
  {
    id: 'settings', label: 'Settings', path: '/settings', icon: <SettingsIcon />,
    routes: ['/settings', '/company-profile', '/smtp-settings', '/users', '/permissions', '/profile', '/change-password'],
    items: [
      { label: 'Company Profile', path: '/settings?tab=company', icon: <BusinessIcon />, permission: 'settings.view', tab: 'company' },
      { label: 'Branding', path: '/settings?tab=branding', icon: <SettingsIcon />, permission: 'settings.view', tab: 'branding' },
      { label: 'WhatsApp API', path: '/settings?tab=whatsapp', icon: <WhatsAppIcon />, permission: 'settings.view', tab: 'whatsapp' },
      { label: 'SMTP Email', path: '/settings?tab=smtp', icon: <EmailIcon />, permission: 'settings.view', tab: 'smtp' },
      { label: 'Security & Session', path: '/settings?tab=security', icon: <SecurityIcon />, permission: 'settings.view', tab: 'security' },
      { label: 'Backup', path: '/settings?tab=backup', icon: <BackupIcon />, permission: 'settings.view', tab: 'backup' },
      { label: 'System Info', path: '/settings?tab=system', icon: <StorageIcon />, permission: 'settings.view', tab: 'system' },
      { label: 'Zoom Integration', path: '/settings/integrations/zoom', icon: <VideoLibraryIcon />, permission: 'settings.view' },
      { label: 'User Manager', path: '/users', icon: <ManageAccountsIcon />, permission: 'user-manager.view' },
      { label: 'Departments & Permissions', path: '/permissions', icon: <AdminPanelSettingsIcon />, permission: 'user-manager.edit' },
      { label: 'Message Templates', path: '/settings/message-templates', icon: <ChatBubbleOutlineIcon />, permission: 'settings.view' },
      { label: 'Profile', path: '/profile', icon: <AccountCircleIcon /> },
      { label: 'Change Password', path: '/change-password', icon: <LockIcon /> }
    ]
  }
];

export function pathBelongsToModule(module, pathname) {
  return module.routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function itemIsActive(item, pathname, search = '') {
  const [itemPath] = item.path.split('?');
  if (item.tab) {
    const currentTab = new URLSearchParams(search).get('tab') || 'company';
    return pathname === itemPath && currentTab === item.tab;
  }
  return item.exact ? pathname === itemPath : pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

export function canAccessItem(item, access) {
  return access.isSystemAdmin || !item.permission || access.permissions?.includes(item.permission);
}

export function canAccessModule(module, access) {
  if (access.isSystemAdmin) return true;
  if (module.permission) return access.permissions?.includes(module.permission);
  return module.items?.some((item) => canAccessItem(item, access)) ?? true;
}
