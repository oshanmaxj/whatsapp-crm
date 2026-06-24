import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Box } from '@mui/material';
import AutoReplyManagement from './pages/AutoReplyManagement';
import AppointmentsPage from './pages/AppointmentsPage';
import ChatPage from './pages/ChatPage';
import ContactsPage from './pages/ContactsPage';
import CampaignsPage from './pages/CampaignsPage';
import DashboardPage from './pages/DashboardPage';
import { AttendancePage, BatchesPage, CertificatesPage, CoursesPage, FeesPage, StudentsPage } from './pages/EducationPages';
import CrmLayout from './components/CrmLayout';
import AgentsPage from './pages/AgentsPage';
import LeadsPage from './pages/LeadsPage';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import { NotificationsPage, ProductionSettingsPage, QueuePage, ReportsPage } from './pages/ProductionPages';
import WorkflowsPage from './pages/WorkflowsPage';

function App() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f6f8fb' }}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<CrmLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/courses" element={<CoursesPage />} />
            <Route path="/batches" element={<BatchesPage />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/fees" element={<FeesPage />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/certificates" element={<CertificatesPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/inbox" element={<Navigate to="/chat" replace />} />
            <Route path="/auto-replies" element={<AutoReplyManagement />} />
            <Route path="/settings" element={<ProductionSettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </Box>
  );
}

export default App;
