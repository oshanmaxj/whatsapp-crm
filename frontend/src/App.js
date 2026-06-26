import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Box, CssBaseline } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { CompanyProfilePage, SmtpSettingsPage } from './pages/AdminSettingsPages';
import AutoReplyManagement from './pages/AutoReplyManagement';
import AppointmentsPage from './pages/AppointmentsPage';
import ChatPage from './pages/ChatPage';
import ClassRemindersPage from './pages/ClassRemindersPage';
import ComplianceCenterPage from './pages/ComplianceCenterPage';
import ContactsPage from './pages/ContactsPage';
import ConnectWhatsAppPage from './pages/ConnectWhatsAppPage';
import CampaignsPage from './pages/CampaignsPage';
import DashboardPage from './pages/DashboardPage';
import FlowBuilderEditorPage from './pages/FlowBuilderEditorPage';
import FlowBuilderListPage from './pages/FlowBuilderListPage';
import { AttendancePage, BatchesPage, CertificatesPage, CoursesPage, FeesPage, StudentsPage } from './pages/EducationPages';
import StudentProfilePage from './pages/students/StudentProfilePage';
import FeeRemindersPage from './pages/FeeRemindersPage';
import CrmLayout from './components/CrmLayout';
import AgentsPage from './pages/AgentsPage';
import LeadsPage from './pages/LeadsPage';
import LoginPage from './pages/LoginPage';
import PermissionManagementPage from './pages/PermissionManagementPage';
import PermissionRoute from './components/PermissionRoute';
import ProtectedRoute from './components/ProtectedRoute';
import { NotificationsPage, ProductionSettingsPage, QueuePage, ReportsPage } from './pages/ProductionPages';
import WorkflowsPage from './pages/WorkflowsPage';
import UserManagerPage from './pages/UserManagerPage';
import { ChangePasswordPage, UserProfilePage } from './pages/AccountPages';
import WhatsAppTemplatesPage from './pages/WhatsAppTemplatesPage';
import AutomationCenterPage from './pages/AutomationCenterPage';
import AttendanceAlertsPage from './pages/AttendanceAlertsPage';
import BirthdayWishesPage from './pages/BirthdayWishesPage';

function App() {
  const [darkMode, setDarkMode] = React.useState(() => localStorage.getItem('darkMode') === 'true');
  const theme = React.useMemo(() => createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: { main: '#128c7e' },
      success: { main: '#25d366' },
      background: {
        default: darkMode ? '#07110f' : '#f6f8fb',
        paper: darkMode ? '#101c19' : '#ffffff'
      }
    },
    shape: { borderRadius: 8 }
  }), [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode((current) => {
      localStorage.setItem('darkMode', String(!current));
      return !current;
    });
  };
  const permit = (permission, element) => <PermissionRoute permission={permission}>{element}</PermissionRoute>;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
          <Route element={<CrmLayout darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={permit('dashboard.view', <DashboardPage />)} />
            <Route path="/contacts" element={permit('contacts.view', <ContactsPage />)} />
            <Route path="/campaigns" element={permit('campaigns.view', <CampaignsPage />)} />
            <Route path="/connect-whatsapp" element={permit('connect-whatsapp.view', <ConnectWhatsAppPage />)} />
            <Route path="/whatsapp-templates" element={permit('connect-whatsapp.view', <WhatsAppTemplatesPage />)} />
            <Route path="/compliance" element={permit('connect-whatsapp.view', <ComplianceCenterPage />)} />
            <Route path="/workflows" element={permit('workflows.view', <WorkflowsPage />)} />
            <Route path="/flow-builder" element={permit('flow-builder.view', <FlowBuilderListPage />)} />
            <Route path="/flow-builder/:id" element={permit('flow-builder.edit', <FlowBuilderEditorPage />)} />
            <Route path="/appointments" element={permit('appointments.view', <AppointmentsPage />)} />
            <Route path="/courses" element={permit('courses.view', <CoursesPage />)} />
            <Route path="/batches" element={permit('batches.view', <BatchesPage />)} />
            <Route path="/students" element={permit('students.view', <StudentsPage />)} />
            <Route path="/students/:id" element={permit('students.view', <StudentProfilePage />)} />
            <Route path="/fees" element={permit('fees.view', <FeesPage />)} />
            <Route path="/fee-reminders" element={permit('fees.view', <FeeRemindersPage />)} />
            <Route path="/class-reminders" element={permit('attendance.view', <ClassRemindersPage />)} />
            <Route path="/automations" element={permit('settings.view', <AutomationCenterPage />)} />
            <Route path="/attendance-alerts" element={permit('attendance.view', <AttendanceAlertsPage />)} />
            <Route path="/birthday-wishes" element={permit('students.view', <BirthdayWishesPage />)} />
            <Route path="/attendance" element={permit('attendance.view', <AttendancePage />)} />
            <Route path="/certificates" element={permit('certificates.view', <CertificatesPage />)} />
            <Route path="/queue" element={permit('settings.view', <QueuePage />)} />
            <Route path="/notifications" element={permit('settings.view', <NotificationsPage />)} />
            <Route path="/reports" element={permit('reports.view', <ReportsPage />)} />
            <Route path="/leads" element={permit('leads.view', <LeadsPage />)} />
            <Route path="/agents" element={permit('agents.view', <AgentsPage />)} />
            <Route path="/chat" element={permit('inbox.view', <ChatPage />)} />
            <Route path="/inbox" element={<Navigate to="/chat" replace />} />
            <Route path="/auto-replies" element={permit('settings.view', <AutoReplyManagement />)} />
            <Route path="/settings" element={permit('settings.view', <ProductionSettingsPage />)} />
            <Route path="/company-profile" element={permit('settings.view', <CompanyProfilePage />)} />
            <Route path="/smtp-settings" element={permit('settings.view', <SmtpSettingsPage />)} />
            <Route path="/users" element={permit('user-manager.view', <UserManagerPage />)} />
            <Route path="/permissions" element={permit('user-manager.edit', <PermissionManagementPage />)} />
            <Route path="/profile" element={<UserProfilePage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
      </Box>
    </ThemeProvider>
  );
}

export default App;
