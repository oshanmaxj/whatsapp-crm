import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ContactsIcon from '@mui/icons-material/Contacts';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import ForumIcon from '@mui/icons-material/Forum';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import PersonAddAltIcon from '@mui/icons-material/PersonAddAlt';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import { getDashboardSummary } from '../services/dashboard.service';

const defaultSummary = {
  totals: {
    contacts: 0,
    leads: 0,
    activeChats: 0,
    messagesToday: 0,
    newContactsToday: 0,
    pendingFollowups: 0
  },
  recentConversations: [],
  recentLeads: [],
  dailyMessageActivity: [],
  leadsByStatus: [],
  leadsBySource: [],
  topAgents: []
};

function formatName(contact) {
  if (!contact) return 'Unknown contact';
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.phone || 'Unnamed contact';
}

function MetricCard({ label, value, icon, tone }) {
  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', height: '100%', position: 'relative', overflow: 'hidden' }} elevation={0}>
      <Box sx={{ position: 'absolute', inset: 'auto -20px -28px auto', width: 110, height: 110, borderRadius: '50%', bgcolor: tone, opacity: 0.55 }} />
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box sx={{ position: 'relative' }}>
          <Typography variant="body2" color="text.secondary" fontWeight={700}>
            {label}
          </Typography>
          <Typography variant="h4" fontWeight={850} sx={{ mt: 1 }}>
            {value}
          </Typography>
        </Box>
        <Box sx={{ width: 44, height: 44, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: tone }}>
          {icon}
        </Box>
      </Stack>
    </Paper>
  );
}

function BarChart({ items, labelKey = 'date', valueKey = 'total' }) {
  const max = Math.max(1, ...items.map((item) => Number(item[valueKey] || item.count || 0)));
  return (
    <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ height: 180, pt: 2 }}>
      {items.map((item) => {
        const value = Number(item[valueKey] || item.count || 0);
        return (
          <Box key={item[labelKey] || item.status || item.source} sx={{ flex: 1, minWidth: 24, textAlign: 'center' }}>
            <Box sx={{ height: `${Math.max(8, (value / max) * 150)}px`, borderRadius: '8px 8px 2px 2px', bgcolor: 'success.main', opacity: 0.86 }} />
            <Typography variant="caption" color="text.secondary" noWrap>{String(item[labelKey] || item.status || item.source).slice(5)}</Typography>
          </Box>
        );
      })}
    </Stack>
  );
}

function RankedList({ title, items, nameKey }) {
  const max = Math.max(1, ...items.map((item) => Number(item.count || item.assignedLeadCount || 0)));
  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', height: '100%' }} elevation={0}>
      <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>{title}</Typography>
      <Stack spacing={1.25}>
        {items.map((item) => {
          const label = nameKey === 'agent' ? item.agent?.name : item[nameKey];
          const value = Number(item.count || item.assignedLeadCount || 0);
          return (
            <Box key={label || item.agent?.id}>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography color="text.secondary" noWrap>{label || '-'}</Typography>
                <Typography fontWeight={800}>{value}</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={(value / max) * 100} sx={{ height: 7, borderRadius: 999 }} />
            </Box>
          );
        })}
        {items.length === 0 && <Typography color="text.secondary">No data yet.</Typography>}
      </Stack>
    </Paper>
  );
}

function DashboardPage() {
  const [summary, setSummary] = useState(defaultSummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSummary = async () => {
    try {
      setError('');
      setLoading(true);
      const response = await getDashboardSummary();
      setSummary(response.data.data || defaultSummary);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load dashboard summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const metrics = [
    { label: 'Total Contacts', value: summary.totals.contacts, icon: <ContactsIcon sx={{ color: '#0f6b43' }} />, tone: '#e7f7ee' },
    { label: 'Total Leads', value: summary.totals.leads, icon: <TrendingUpIcon sx={{ color: '#1769aa' }} />, tone: '#e8f2fb' },
    { label: 'Active Chats', value: summary.totals.activeChats, icon: <ForumIcon sx={{ color: '#7a4bd8' }} />, tone: '#f1ecff' },
    { label: 'Messages Today', value: summary.totals.messagesToday, icon: <ChatBubbleOutlineIcon sx={{ color: '#0f8b8d' }} />, tone: '#e7f8f8' },
    { label: 'New Contacts Today', value: summary.totals.newContactsToday, icon: <PersonAddAltIcon sx={{ color: '#b25a00' }} />, tone: '#fff3e2' },
    { label: 'Pending Follow-ups', value: summary.totals.pendingFollowups, icon: <EventAvailableIcon sx={{ color: '#ba1a1a' }} />, tone: '#feecec' },
    { label: 'New Leads', value: summary.totals.newLeads || 0, icon: <LeaderboardIcon sx={{ color: '#175cd3' }} />, tone: '#eaf1ff' },
    { label: 'Converted Leads', value: summary.totals.convertedLeads || 0, icon: <CheckCircleOutlineIcon sx={{ color: '#0f8a4b' }} />, tone: '#e7f7ee' }
  ];

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <LinearProgress />}

      <Grid container spacing={2}>
        {metrics.map((metric) => (
          <Grid item xs={12} sm={6} lg={4} key={metric.label}>
            <MetricCard {...metric} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={7}>
          <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }} elevation={0}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6" fontWeight={800}>
                Recent Conversations
              </Typography>
              <MarkChatUnreadIcon color="success" />
            </Stack>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Contact</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Last Message</TableCell>
                    <TableCell>Summary</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.recentConversations.map((conversation) => (
                    <TableRow key={conversation.id} hover>
                      <TableCell>{formatName(conversation.contact)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={conversation.status} color={conversation.status === 'open' ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell>{conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString() : '-'}</TableCell>
                      <TableCell>{conversation.summary || '-'}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && summary.recentConversations.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography color="text.secondary">No conversations yet.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', height: '100%' }} elevation={0}>
            <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>
              Daily Message Activity
            </Typography>
            <Stack spacing={1.5}>
              <BarChart items={summary.dailyMessageActivity} />
              {summary.dailyMessageActivity.map((item) => (
                <Stack key={item.date} direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">{item.date}</Typography>
                  <Typography variant="body2" fontWeight={800}>{item.total}</Typography>
                </Stack>
              ))}
              {loading && (
                <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
                  <CircularProgress size={28} />
                </Box>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <RankedList title="Leads by Status" items={summary.leadsByStatus || []} nameKey="status" />
        </Grid>
        <Grid item xs={12} md={4}>
          <RankedList title="Leads by Source" items={summary.leadsBySource || []} nameKey="source" />
        </Grid>
        <Grid item xs={12} md={4}>
          <RankedList title="Top Agents" items={summary.topAgents || []} nameKey="agent" />
        </Grid>
      </Grid>

      <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }} elevation={0}>
        <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>
          Recent Leads
        </Typography>
        <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Contact</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Stage</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.recentLeads.map((lead) => (
                <TableRow key={lead.id} hover>
                  <TableCell>{formatName(lead.contact)}</TableCell>
                  <TableCell>{lead.status?.name || '-'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={lead.priority} />
                  </TableCell>
                  <TableCell>{lead.stage}</TableCell>
                  <TableCell>{lead.createdAt ? new Date(lead.createdAt).toLocaleString() : '-'}</TableCell>
                </TableRow>
              ))}
              {!loading && summary.recentLeads.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography color="text.secondary">No leads yet.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}

export default DashboardPage;
